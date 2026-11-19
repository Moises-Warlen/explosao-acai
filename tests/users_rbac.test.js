process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { server } from '../src/server.js';
import { userService } from '../src/application/services/UserService.js';
import { orderService } from '../src/application/services/OrderService.js';
import { hashPassword, verifyPasswordHash } from '../src/presentation/middlewares/authMiddleware.js';
import { db } from '../src/infrastructure/database/JsonDatabase.js';

process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'senha-teste-automatizado';
const TEST_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

describe('Explosão Açaí — Gestão de Usuários, RBAC & Segurança LGPD', () => {
  let baseUrl = '';
  let adminToken = '';

  before(async () => {
    if (db && db.data && Array.isArray(db.data.users)) {
      db.data.users = db.data.users.filter(u => u.id === 'usr_admin_default');
      db.save();
    }
    return new Promise((resolve) => {
      if (server.listening) {
        const addr = server.address();
        baseUrl = `http://localhost:${addr.port}`;
        adminToken = TEST_ADMIN_PASSWORD;
        return resolve();
      }
      server.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://localhost:${addr.port}`;
        adminToken = TEST_ADMIN_PASSWORD;
        resolve();
      });
    });
  });

  after(async () => {
    if (db && db.data && Array.isArray(db.data.users)) {
      db.data.users = db.data.users.filter(u => u.id === 'usr_admin_default');
      db.save();
    }
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('1. Default Admin: Usuário Administrador padrão existe e não expõe hash de senha', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { 'x-admin-token': adminToken }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(Array.isArray(data.users));
    assert.ok(data.users.length >= 1);

    const admin = data.users.find(u => u.role === 'admin');
    assert.ok(admin, 'Deve conter pelo menos um Administrador');
    assert.strictEqual(admin.passwordHash, undefined, 'Hash de senha NUNCA deve ser retornado na API (LGPD)');
    assert.strictEqual(admin.active, true);
  });

  test('2. Cadastro de Operador: Cria operador com permissões granulares e senha criptografada', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        name: 'Carlos Atendente',
        email: 'carlos.operador@explosao.com',
        password: 'senhaSegura#2026',
        role: 'operator',
        permissions: ['orders', 'chat'],
        active: true
      })
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.user.id);
    assert.strictEqual(data.user.name, 'Carlos Atendente');
    assert.strictEqual(data.user.email, 'carlos.operador@explosao.com');
    assert.strictEqual(data.user.role, 'operator');
    assert.deepStrictEqual(data.user.permissions, ['orders', 'chat']);
    assert.strictEqual(data.user.passwordHash, undefined, 'Hash de senha não pode ser retornado');

    // Validação no banco: senha foi armazenada como hash scrypt seguro
    const rawUser = db.get().users.find(u => u.id === data.user.id);
    assert.ok(rawUser);
    assert.ok(rawUser.passwordHash.startsWith('$scrypt$'), 'Senha deve ser hash scrypt');
    assert.strictEqual(rawUser.passwordHash.includes('senhaSegura#2026'), false, 'Senha nunca em texto plano');
    assert.strictEqual(verifyPasswordHash('senhaSegura#2026', rawUser.passwordHash), true);
  });

  test('3. Login de Operador & Token JWT assinado com perfil e permissões', async () => {
    // 1. Login com credenciais válidas do operador
    const authRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'carlos.operador@explosao.com',
        password: 'senhaSegura#2026'
      })
    });

    assert.strictEqual(authRes.status, 200);
    const authData = await authRes.json();
    assert.strictEqual(authData.ok, true);
    assert.ok(authData.token);
    assert.strictEqual(authData.user.name, 'Carlos Atendente');
    assert.strictEqual(authData.user.role, 'operator');
    assert.deepStrictEqual(authData.user.permissions, ['orders', 'chat']);

    // 2. Consulta a /api/auth/me usando o token gerado
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'x-admin-token': authData.token }
    });
    assert.strictEqual(meRes.status, 200);
    const meData = await meRes.json();
    assert.strictEqual(meData.ok, true);
    assert.strictEqual(meData.user.role, 'operator');
    assert.deepStrictEqual(meData.user.permissions, ['orders', 'chat']);
  });

  test('4. Controle de Acesso (RBAC): Operador é bloqueado de acessar a rota /api/users (Admin Only)', async () => {
    // 1. Obtém token do operador
    const authRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'carlos.operador@explosao.com',
        password: 'senhaSegura#2026'
      })
    });
    const { token: operatorToken } = await authRes.json();

    // 2. Operador tenta listar usuários -> deve receber 403 Forbidden
    const listRes = await fetch(`${baseUrl}/api/users`, {
      headers: { 'x-admin-token': operatorToken }
    });
    assert.strictEqual(listRes.status, 403, 'Operador não pode acessar gestão de usuários');
    const listData = await listRes.json();
    assert.strictEqual(listData.ok, false);
    assert.ok(listData.error.includes('apenas Administradores'));
  });

  test('5. Validação de Duplicidade de E-mail / Login', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        name: 'Outro Carlos',
        email: 'carlos.operador@explosao.com',
        password: 'outraSenha123',
        role: 'operator'
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.ok, false);
    assert.ok(data.error.includes('já está em uso'));
  });

  test('6. Edição de Usuário: Altera nome, permissões e senha opcional', async () => {
    const listRes = await fetch(`${baseUrl}/api/users`, { headers: { 'x-admin-token': adminToken } });
    const { users } = await listRes.json();
    const op = users.find(u => u.email === 'carlos.operador@explosao.com');

    // Atualiza nome e adiciona permissão de catalog sem alterar senha
    const updateRes = await fetch(`${baseUrl}/api/users/${op.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        name: 'Carlos Líder de Atendimento',
        email: 'carlos.operador@explosao.com',
        role: 'operator',
        permissions: ['orders', 'chat', 'catalog']
      })
    });

    assert.strictEqual(updateRes.status, 200);
    const updatedData = await updateRes.json();
    assert.strictEqual(updatedData.user.name, 'Carlos Líder de Atendimento');
    assert.deepStrictEqual(updatedData.user.permissions, ['orders', 'chat', 'catalog']);

    // A senha antiga continua funcionando
    const loginTest = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'carlos.operador@explosao.com',
        password: 'senhaSegura#2026'
      })
    });
    assert.strictEqual(loginTest.status, 200);
  });

  test('7. Desativação Rápida (Toggle Status) & Bloqueio de Login para Usuário Inativo', async () => {
    const listRes = await fetch(`${baseUrl}/api/users`, { headers: { 'x-admin-token': adminToken } });
    const { users } = await listRes.json();
    const op = users.find(u => u.email === 'carlos.operador@explosao.com');

    // Desativa o usuário
    const toggleRes = await fetch(`${baseUrl}/api/users/${op.id}/toggle-status`, {
      method: 'PATCH',
      headers: { 'x-admin-token': adminToken }
    });
    assert.strictEqual(toggleRes.status, 200);
    const toggleData = await toggleRes.json();
    assert.strictEqual(toggleData.user.active, false);

    // Tentativa de login do usuário inativo -> 403 Forbidden
    const loginRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'carlos.operador@explosao.com',
        password: 'senhaSegura#2026'
      })
    });
    assert.strictEqual(loginRes.status, 403);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.ok, false);
    assert.ok(loginData.error.includes('inativo'));

    // Reativa o usuário
    const reativarRes = await fetch(`${baseUrl}/api/users/${op.id}/toggle-status`, {
      method: 'PATCH',
      headers: { 'x-admin-token': adminToken }
    });
    assert.strictEqual(reativarRes.status, 200);
    const reativarData = await reativarRes.json();
    assert.strictEqual(reativarData.user.active, true);
  });

  test('8. Trava de Segurança: Bloqueia desativação ou remoção do único Administrador ativo', async () => {
    const listRes = await fetch(`${baseUrl}/api/users`, { headers: { 'x-admin-token': adminToken } });
    const { users } = await listRes.json();
    const admins = users.filter(u => u.role === 'admin' && u.active);
    assert.ok(admins.length >= 1);
    const mainAdmin = admins[0];

    // Se houver apenas 1 admin, tenta desativá-lo
    if (admins.length === 1) {
      const toggleRes = await fetch(`${baseUrl}/api/users/${mainAdmin.id}/toggle-status`, {
        method: 'PATCH',
        headers: { 'x-admin-token': adminToken }
      });
      assert.strictEqual(toggleRes.status, 400);
      const toggleData = await toggleRes.json();
      assert.strictEqual(toggleData.ok, false);
      assert.ok(toggleData.error.includes('único Administrador ativo'));

      // Tenta remover o único admin
      const delRes = await fetch(`${baseUrl}/api/users/${mainAdmin.id}`, {
        method: 'DELETE',
        headers: { 'x-admin-token': adminToken }
      });
      assert.strictEqual(delRes.status, 400);
      const delData = await delRes.json();
      assert.strictEqual(delData.ok, false);
      assert.ok(delData.error.includes('único Administrador ativo'));
    }
  });

  test('9. Remoção Segura (Soft Delete & LGPD): Não deleta fisicamente mantendo integridade referencial', async () => {
    // Cria operador temporário para remoção
    const createRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        name: 'Operador Temporario',
        email: 'temp.operador@explosao.com',
        password: 'senhaTemp123',
        role: 'operator'
      })
    });
    const { user: tempUser } = await createRes.json();

    // Remove o usuário
    const delRes = await fetch(`${baseUrl}/api/users/${tempUser.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
    assert.strictEqual(delRes.status, 200);
    const delData = await delRes.json();
    assert.strictEqual(delData.ok, true);

    // Não aparece mais na listagem de usuários ativos
    const listRes = await fetch(`${baseUrl}/api/users`, { headers: { 'x-admin-token': adminToken } });
    const { users } = await listRes.json();
    const found = users.find(u => u.id === tempUser.id);
    assert.strictEqual(found, undefined, 'Usuário removido não deve constar na listagem');

    // Registro no banco foi marcado como isDeleted (Soft delete LGPD)
    const rawUser = db.get().users.find(u => u.id === tempUser.id);
    assert.ok(rawUser);
    assert.strictEqual(rawUser.isDeleted, true);
    assert.strictEqual(rawUser.active, false);
  });

  test('10. Login de Novo Usuário: Autentica com sucesso por Nome, Login/E-mail ou Senha única', async () => {
    // 1. Criar novo atendente com nome e login específicos
    const createRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        name: 'Mariana Atendente',
        email: 'mariana.atendimento@explosao.com',
        password: 'MarianaSuperSenha#2026',
        role: 'operator',
        permissions: ['chat.view', 'chat.reply', 'chat.edit_customer'],
        active: true
      })
    });
    const { user: mariana } = await createRes.json();
    assert.ok(mariana.id);

    // 2. Login pelo e-mail
    const loginEmailRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'mariana.atendimento@explosao.com',
        password: 'MarianaSuperSenha#2026'
      })
    });
    const emailData = await loginEmailRes.json();
    assert.strictEqual(loginEmailRes.status, 200);
    assert.strictEqual(emailData.ok, true);
    assert.strictEqual(emailData.user.name, 'Mariana Atendente');

    // 3. Login pelo Nome (case-insensitive)
    const loginNameRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'mariana atendente',
        password: 'MarianaSuperSenha#2026'
      })
    });
    const nameData = await loginNameRes.json();
    assert.strictEqual(loginNameRes.status, 200);
    assert.strictEqual(nameData.ok, true);
    assert.ok(nameData.token);

    // 4. Limpeza
    await fetch(`${baseUrl}/api/users/${mariana.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
  });

  test('11. RBAC Granular: Operador restrito a Chat é bloqueado em Rotas Operacionais não autorizadas (403)', async () => {
    // 1. Criar operador exclusivo de chat
    const createRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        name: 'Lucas Chat Only',
        email: 'lucas.chat@explosao.com',
        password: 'senhaChatLucas#2026',
        role: 'operator',
        permissions: ['chat.view', 'chat.reply'],
        active: true
      })
    });
    const { user: lucas } = await createRes.json();

    // 2. Obter token do Lucas
    const authRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'lucas.chat@explosao.com',
        password: 'senhaChatLucas#2026'
      })
    });
    const { token: lucasToken } = await authRes.json();

    // 3. Lucas tenta consultar relatórios financeiros -> deve receber 403 Forbidden
    const reportRes = await fetch(`${baseUrl}/api/reports/sales?period=today`, {
      headers: { 'x-admin-token': lucasToken }
    });
    assert.strictEqual(reportRes.status, 403);
    const reportErr = await reportRes.json();
    assert.strictEqual(reportErr.ok, false);
    assert.ok(reportErr.error.includes('Acesso negado'));

    // 4. Lucas tenta alterar status da loja (Abrir/Fechar) -> deve receber 403 Forbidden
    const toggleRes = await fetch(`${baseUrl}/api/store/toggle-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': lucasToken
      },
      body: JSON.stringify({ isOpen: false })
    });
    assert.strictEqual(toggleRes.status, 403);

    // 5. Lucas acessa lista de conversas de chat -> autorizado (200 OK)
    const chatRes = await fetch(`${baseUrl}/api/chat/conversations`, {
      headers: { 'x-admin-token': lucasToken }
    });
    assert.strictEqual(chatRes.status, 200);

    // 6. Limpeza
    await fetch(`${baseUrl}/api/users/${lucas.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
  });

  test('12. Hierarquia e Wildcard: Operador com "orders" acessa ações granulares de pedidos', async () => {
    // 1. Criar operador com permissão macro "orders"
    const createRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
        name: 'Roberto Cozinha',
        email: 'roberto.cozinha@explosao.com',
        password: 'senhaRoberto#2026',
        role: 'operator',
        permissions: ['orders'],
        active: true
      })
    });
    const { user: roberto } = await createRes.json();

    // 2. Autentica Roberto
    const authRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'roberto.cozinha@explosao.com',
        password: 'senhaRoberto#2026'
      })
    });
    const { token: robertoToken } = await authRes.json();

    // 3. Cria um pedido para teste de alteração de status (Pagamento na entrega)
    const order = await orderService.createOrder({
      customer: { name: 'Cliente Teste Roberto', phone: '16999991111' },
      delivery: { type: 'pickup' },
      payment: { method: 'Dinheiro', timing: 'delivery' },
      bypassStoreClosed: true,
      items: [
        { productId: 'prod_classico', name: 'Clássico 500 ml', size: 500, quantity: 1, unitPrice: 26.90, accompaniments: ['Banana'], extras: [] }
      ]
    });

    // 4. Roberto altera status do pedido para "preparing" -> autorizado (herança hierárquica)
    const statusRes = await fetch(`${baseUrl}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': robertoToken
      },
      body: JSON.stringify({ status: 'preparing' })
    });
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.order.status, 'preparing');

    // 5. Roberto tenta acessar cupons -> bloqueado (403 Forbidden)
    const couponRes = await fetch(`${baseUrl}/api/coupons`, {
      headers: { 'x-admin-token': robertoToken }
    });
    assert.strictEqual(couponRes.status, 403);

    // 6. Limpeza
    await fetch(`${baseUrl}/api/users/${roberto.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
  });
});
