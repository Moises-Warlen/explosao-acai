/**
 * Bateria Completa de Testes de Integridade Ponta a Ponta
 * Sistema: Explosão Açaí Gestor Pro & Cardápio Digital
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

process.env.NODE_ENV = 'test';
process.env.PORT = '3099';
process.env.ADMIN_PASSWORD = 'ExplosaoMaster#2026';
process.env.MOTOBOY_TOKEN = 'moto123';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../data/database.json');
const DB_BACKUP_PATH = path.resolve(__dirname, '../data/database.json.bak_test');

// Importa app e server após definir variáveis de ambiente
const { app, server } = await import('../src/server.js');
const { db } = await import('../src/infrastructure/database/JsonDatabase.js');
const { chatService } = await import('../src/application/services/ChatService.js');

const BASE_URL = 'http://127.0.0.1:3099';
const WS_URL = 'ws://127.0.0.1:3099/ws';

const results = [];

function recordTest(suite, name, passed, detail = '') {
  const symbol = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${symbol} [${suite}] ${name} ${detail ? `(${detail})` : ''}`);
  results.push({ suite, name, passed, detail });
}

async function request(urlPath, options = {}) {
  const url = `${BASE_URL}${urlPath}`;
  const res = await fetch(url, options);
  let json = null;
  let text = '';
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      json = await res.json();
    } catch (e) {}
  } else {
    text = await res.text();
  }
  return { status: res.status, headers: res.headers, json, text };
}

async function runAllTests() {
  console.log('======================================================================');
  console.log('  🚀 INICIANDO BATERIA COMPLETA DE TESTES DE INTEGRIDADE (E2E)');
  console.log('======================================================================\n');

  // Backup seguro e isolado do banco
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, DB_BACKUP_PATH);
  }

  // Inicializa servidor de teste na porta 3099
  await new Promise((resolve) => server.listen(3099, resolve));
  console.log(`Servidor de testes rodando em: ${BASE_URL}\n`);

  let adminToken = null;
  let createdOrderId = null;
  let createdOrderNo = null;

  try {
    // -------------------------------------------------------------------------
    // 0. AUTENTICAÇÃO INICIAL VÁLIDA (Para obter token antes do rate-limit)
    // -------------------------------------------------------------------------
    console.log('👉 [FASE 0] Autenticação Inicial para Operações Administrativas');
    const authRes = await request('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'ExplosaoMaster#2026' })
    });
    const authOk = authRes.status === 200 && authRes.json?.ok === true && !!authRes.json?.token;
    adminToken = authRes.json?.token;
    recordTest('Auth Admin', 'Login com senha correta retorna 200 e Token JWT/HMAC', authOk, `Token: ${adminToken ? adminToken.substring(0, 20) + '...' : 'null'}`);

    // -------------------------------------------------------------------------
    // 1. INTEGRIDADE DE PÁGINAS E ASSETS (HTTP 200)
    // -------------------------------------------------------------------------
    console.log('\n👉 [FASE 1] Integridade de Páginas e Assets WebP');

    // 1.1 Páginas principais
    const p1 = await request('/');
    recordTest('Páginas', 'Carregamento do Cardápio Digital (/)', p1.status === 200 && p1.text.includes('Explosão Açaí'));

    const p2 = await request('/admin');
    recordTest('Páginas', 'Carregamento do Painel Gestor Pro (/admin)', p2.status === 200 && p2.text.toLowerCase().includes('gestor pro'));

    const p3 = await request('/motoboy');
    recordTest('Páginas', 'Carregamento do Portal do Motoboy (/motoboy)', p3.status === 200 && p3.text.includes('Entregador'));

    // 1.2 Varrer 100% dos produtos do cardápio e testar as fotos WebP
    const catRes = await request('/api/catalog');
    const products = catRes.json?.products || [];
    let imagesChecked = 0;
    let imagesFailed = 0;

    for (const prod of products) {
      if (prod.image) {
        imagesChecked++;
        const imgPath = prod.image.startsWith('/') ? prod.image : `/${prod.image}`;
        const imgRes = await fetch(`${BASE_URL}${imgPath}`);
        const buf = await imgRes.arrayBuffer();
        if (imgRes.status !== 200 || buf.byteLength === 0) {
          imagesFailed++;
          console.error(`    Falha no carregamento da imagem: ${imgPath}`);
        }
      }
    }
    const allImagesOk = imagesChecked > 0 && imagesFailed === 0;
    recordTest('Assets WebP', `100% das imagens de produtos (.webp) retornam HTTP 200 OK`, allImagesOk, `${imagesChecked}/${imagesChecked} imagens validadas com sucesso`);

    // -------------------------------------------------------------------------
    // 2. FLUXO DO CLIENTE (Cardápio -> Frete -> Pedido -> Rastreio com Máscara)
    // -------------------------------------------------------------------------
    console.log('\n👉 [FASE 2] Fluxo do Cliente & Proteção de Dados LGPD');

    // 2.1 Cálculo de Frete
    const freightRes = await request('/api/store/calculate-freight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ street: 'Rua Carlos Gomes', bairro: 'Centro', city: 'Franca', state: 'SP' })
    });
    recordTest('Frete', 'Cálculo dinâmico de frete por endereço em Franca/SP', freightRes.status === 200 && freightRes.json?.ok === true && typeof freightRes.json?.freight === 'number');

    // 2.2 Criação de Pedido Completo
    const orderPayload = {
      customer: {
        name: 'Carlos Silva Teste',
        phone: '16991112233'
      },
      delivery: {
        type: 'delivery',
        street: 'Avenida Brasil',
        number: '500',
        bairro: 'Centro',
        city: 'Franca',
        state: 'SP',
        cep: '14400-000',
        reference: 'Ao lado da farmácia',
        freight: 5.0,
        km: 4.5
      },
      items: [
        {
          name: 'Clássico 500ml',
          size: 500,
          quantity: 1,
          unitPrice: 19.90,
          costPrice: 9.40,
          subtotal: 19.90,
          accompaniments: ['Morango', 'Ninho'],
          extras: ['Nutella'],
          fruits: []
        }
      ],
      payment: {
        method: 'Dinheiro',
        timing: 'delivery',
        changeFor: '50,00'
      }
    };

    const createRes = await request('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });
    const orderCreated = (createRes.status === 201 || createRes.status === 200) && createRes.json?.ok === true && createRes.json?.order?.id;
    createdOrderId = createRes.json?.order?.id;
    createdOrderNo = createRes.json?.order?.orderNo;
    recordTest('Pedidos', 'Criação de novo pedido pelo cliente (POST /api/orders)', orderCreated, `ID: ${createdOrderId} | Pedido #${createdOrderNo}`);

    // 2.3 Rastreamento Anônimo com Mascaramento Defensivo (LGPD)
    const trackRes = await request(`/api/orders/${createdOrderId}`);
    const trackedOrder = trackRes.json?.order;
    const isNameMasked = trackedOrder?.customer?.name === 'Carlos';
    const isPhoneMasked = trackedOrder?.customer?.phone && trackedOrder.customer.phone.includes('****');
    const isAddressMasked = trackedOrder?.delivery?.number === '***' && trackedOrder?.delivery?.reference === '***';
    const isMaskingWorking = trackRes.status === 200 && isNameMasked && isPhoneMasked && isAddressMasked;

    recordTest('LGPD Mascaramento', 'Consulta pública de pedido mascara Nome, Telefone e Endereço residencial', isMaskingWorking, `Nome: "${trackedOrder?.customer?.name}", Tel: "${trackedOrder?.customer?.phone}", Num: "${trackedOrder?.delivery?.number}"`);

    // 2.4 Consulta de histórico por telefone também mascara dados sensíveis
    const phoneHistoryRes = await request(`/api/orders?phone=16991112233`);
    const historyOrder = phoneHistoryRes.json?.orders?.[0];
    const isHistoryMasked = phoneHistoryRes.status === 200 && historyOrder?.delivery?.number === '***';
    recordTest('LGPD Histórico', 'Histórico de pedidos por telefone retorna dados mascarados para consultas anônimas', isHistoryMasked);

    // -------------------------------------------------------------------------
    // 3. SEGURANÇA E BLOQUEIOS (401 / 403 / 429)
    // -------------------------------------------------------------------------
    console.log('\n👉 [FASE 3] Segurança Defensiva e Bloqueios (401 / 429)');

    // 3.1 Bloqueio de motoboy sem token
    const motoboyBlock = await request('/api/orders?motoboy=pending');
    recordTest('Segurança Motoboy', 'Acesso a entregas pendentes sem token é bloqueado com 401', motoboyBlock.status === 401);

    // 3.2 Bloqueio de confirmação de entrega sem token
    const confirmBlock = await request(`/api/orders/${createdOrderId}/confirm-delivery`, { method: 'POST' });
    recordTest('Segurança Entregas', 'Confirmação de entrega sem token de motoboy/admin é bloqueada com 401', confirmBlock.status === 401);

    // 3.3 Bloqueio de senhas antigas removidas
    const oldPass1 = await request('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'explosao123' })
    });
    recordTest('Segurança Senhas', 'Senha antiga removida (explosao123) é rejeitada com 401', oldPass1.status === 401);

    const oldPass2 = await request('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'RafaeLL@2' })
    });
    recordTest('Segurança Senhas', 'Senha antiga de último recurso (RafaeLL@2) é rejeitada com 401', oldPass2.status === 401);

    // 3.4 Rejeição de login via URL (?t=)
    const urlTokenRes = await request(`/api/orders?t=ExplosaoMaster#2026`);
    recordTest('Segurança QueryString', 'Tentativa de autenticação via parâmetro de URL (?t=) é bloqueada com 401', urlTokenRes.status === 401);

    // 3.5 Teste de Rate Limiting (5 tentativas permitidas, 6ª tentativa bloqueada com 429)
    console.log('   Testando Rate Limiter de força bruta em /api/admin/auth...');
    // Já fizemos 2 tentativas erradas acima (oldPass1 e oldPass2). Faremos mais 3 para atingir 5, e a 6ª deve retornar 429.
    await request('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'errada1' }) });
    await request('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'errada2' }) });
    await request('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'errada3' }) });
    
    const rateLimitedRes = await request('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'errada6' })
    });
    recordTest('Rate Limiting', 'A 6ª tentativa incorreta consecutiva de login é bloqueada com HTTP 429 (Too Many Requests)', rateLimitedRes.status === 429, `Status retornado: ${rateLimitedRes.status}`);

    // -------------------------------------------------------------------------
    // 4. PAINEL ADMIN, KANBAN E ANONIMIZAÇÃO LGPD
    // -------------------------------------------------------------------------
    console.log('\n👉 [FASE 4] Operação do Painel Admin, Kanban & Anonimização LGPD');

    // 4.1 Consulta autenticada de pedidos como Admin: dados completos sem máscara
    const adminOrdersRes = await request('/api/orders', {
      headers: { 'x-admin-token': adminToken }
    });
    const foundAdminOrder = adminOrdersRes.json?.orders?.find(o => o.id === createdOrderId);
    const isAdminDataUnmasked = foundAdminOrder && foundAdminOrder.customer.name === 'Carlos Silva Teste' && foundAdminOrder.customer.phone === '16991112233' && foundAdminOrder.delivery.number === '500';
    recordTest('Admin Kanban', 'Admin autenticado visualiza dados completos e desmascarados para expedição', isAdminDataUnmasked);

    // 4.2 Avanço de status do Kanban (Preparo -> Saiu para entrega)
    const prepRes = await request(`/api/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ status: 'preparing' })
    });
    recordTest('Kanban Fluxo', 'Avanço do pedido para "Em Preparo" (Cozinha)', prepRes.status === 200 && prepRes.json?.order?.status === 'preparing');

    const outRes = await request(`/api/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ status: 'out_for_delivery' })
    });
    recordTest('Kanban Fluxo', 'Avanço do pedido para "Saiu para Entrega"', outRes.status === 200 && outRes.json?.order?.status === 'out_for_delivery');

    // 4.3 Anonimização de Titular (LGPD)
    const anonRes = await request('/api/admin/customers/anonymize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ orderId: createdOrderId })
    });
    recordTest('LGPD Anonimização', 'Endpoint de anonimização (POST /api/admin/customers/anonymize) executado com sucesso', anonRes.status === 200 && anonRes.json?.ok === true);

    // Verifica que o pedido foi anonimizado preservando o total financeiro
    const checkAnonRes = await request(`/api/orders/${createdOrderId}`, {
      headers: { 'x-admin-token': adminToken }
    });
    const anonOrder = checkAnonRes.json?.order;
    const originalTotal = createRes.json?.order?.total;
    const isAnonSuccess = anonOrder?.customer?.name === 'Cliente Anonimizado (LGPD)' && anonOrder?.delivery?.number === '***' && anonOrder?.total === originalTotal;
    recordTest('LGPD Integridade', 'Dados pessoais do titular foram anonimizados no banco mantendo o valor financeiro intacto', isAnonSuccess, `Nome: "${anonOrder?.customer?.name}", Total Preservado: R$ ${anonOrder?.total}`);

    // -------------------------------------------------------------------------
    // 5. PORTAL DO MOTOBOY COM TOKEN LOGÍSTICO
    // -------------------------------------------------------------------------
    console.log('\n👉 [FASE 5] Portal do Entregador com Token Logístico');

    // 5.1 Listagem de pedidos com token de motoboy
    const motoboyPending = await request('/api/orders?motoboy=pending', {
      headers: { 'x-motoboy-token': 'moto123' }
    });
    const hasOrderInMotoboy = motoboyPending.status === 200 && Array.isArray(motoboyPending.json?.orders) && motoboyPending.json.orders.some(o => o.id === createdOrderId);
    recordTest('Motoboy Autenticado', 'Entregador autenticado lista pedidos em rota com sucesso (x-motoboy-token)', hasOrderInMotoboy);

    // 5.2 Confirmação de entrega pelo motoboy
    const deliverRes = await request(`/api/orders/${createdOrderId}/confirm-delivery`, {
      method: 'POST',
      headers: { 'x-motoboy-token': 'moto123' }
    });
    recordTest('Motoboy Entrega', 'Entregador confirma entrega do pedido no destino com sucesso', deliverRes.status === 200 && deliverRes.json?.order?.status === 'delivered');

    // -------------------------------------------------------------------------
    // 6. WEBSOCKET E PRIVACIDADE NO CHAT
    // -------------------------------------------------------------------------
    console.log('\n👉 [FASE 6] WebSocket e Privacidade no Chat (Anti-Vazamento)');

    await new Promise((resolve) => {
      const wsAdmin = new WebSocket(WS_URL);
      const wsClient = new WebSocket(WS_URL);

      let adminReceivedPhone = false;
      let clientReceivedLeak = false;
      let readyCount = 0;

      function onReady() {
        readyCount++;
        if (readyCount === 2) {
          // Autentica o Admin no WebSocket
          wsAdmin.send(JSON.stringify({ type: 'AUTHENTICATE_ADMIN', token: adminToken }));
          // Registra o cliente com outro telefone
          wsClient.send(JSON.stringify({ type: 'REGISTER_CUSTOMER', phone: '16988880001' }));

          setTimeout(() => {
            // Dispara encerramento de chat para um cliente confidencial
            chatService.closeConversation('16977779999');

            setTimeout(() => {
              wsAdmin.close();
              wsClient.close();

              recordTest('WebSocket Admin', 'Admin recebe evento CHAT_CLOSED com telefone do cliente para gestão', adminReceivedPhone);
              recordTest('WebSocket Privacidade', 'Cliente conectado NÃO recebe vazamento de telefone de terceiros no broadcast', !clientReceivedLeak);

              resolve();
            }, 600);
          }, 300);
        }
      }

      wsAdmin.on('open', onReady);
      wsClient.on('open', onReady);

      wsAdmin.on('message', (msgStr) => {
        try {
          const data = JSON.parse(msgStr);
          if (data.event === 'CHAT_CLOSED' && data.payload?.customerPhone === '16977779999') {
            adminReceivedPhone = true;
          }
        } catch (e) {}
      });

      wsClient.on('message', (msgStr) => {
        try {
          const data = JSON.parse(msgStr);
          if (data.event === 'CHAT_CLOSED' && data.payload?.customerPhone) {
            clientReceivedLeak = true;
          }
        } catch (e) {}
      });
    });

  } finally {
    // -------------------------------------------------------------------------
    // 7. LIMPEZA E RESTAURAÇÃO DO BANCO ORIGINAL
    // -------------------------------------------------------------------------
    console.log('\n👉 [FASE 7] Limpeza e Restauração de Dados');
    server.close();

    if (fs.existsSync(DB_BACKUP_PATH)) {
      fs.copyFileSync(DB_BACKUP_PATH, DB_PATH);
      fs.unlinkSync(DB_BACKUP_PATH);
      console.log('  ✅ Banco original restaurado com sucesso! Zero poluição de dados.');
    }
  }

  // ---------------------------------------------------------------------------
  // RESUMO FINAL
  // ---------------------------------------------------------------------------
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n======================================================================');
  console.log(`  📊 RESULTADO FINAL DA BATERIA: ${passed}/${total} TESTES PASSANDO (${((passed/total)*100).toFixed(0)}%)`);
  if (failed === 0) {
    console.log('  🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
  } else {
    console.log(`  ⚠️ ATENÇÃO: ${failed} TESTES FALHARAM.`);
  }
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
