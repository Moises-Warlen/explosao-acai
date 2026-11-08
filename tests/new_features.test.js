process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { server } from '../src/server.js';

describe('Explosão Açaí - Testes das Novas Funcionalidades', () => {
  let baseUrl = '';

  before(() => new Promise((resolve) => {
    if (server.listening) {
      const addr = server.address();
      baseUrl = `http://localhost:${addr.port}`;
      return resolve();
    }
    server.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  }));

  after(() => new Promise((resolve) => {
    server.close(resolve);
  }));

  test('Frete Grátis até 2 km: Pedido com km <= 2 deve ter taxa de entrega zerada (R$ 0,00)', async () => {
    const payload = {
      customer: { name: 'Cliente Frete Grátis', phone: '16999990001' },
      delivery: {
        type: 'delivery',
        street: 'Rua das Flores',
        number: '123',
        bairro: 'Centro',
        city: 'Franca - SP',
        km: 1.5 // menor que 2.0 km
      },
      payment: { method: 'Dinheiro', timing: 'delivery', paidAt: null, trocoFor: 50.0 },
      items: [
        {
          productId: 'prod-trad-01',
          name: 'Açaí Tradicional',
          size: 300,
          quantity: 1,
          unitPrice: 18.90,
          accompaniments: ['Granola', 'Leite condensado', 'Ninho'],
          extras: []
        }
      ]
    };

    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.order.delivery.freight, 0, 'O frete para <= 2km deve ser 0');
    assert.strictEqual(data.order.total, 18.90, 'O total deve ser apenas o item, sem acréscimo de frete');
  });

  test('Frete Normal acima de 2 km: Pedido com km > 2 deve calcular frete padrão', async () => {
    const payload = {
      customer: { name: 'Cliente Frete Pago', phone: '16999990002' },
      delivery: {
        type: 'delivery',
        street: 'Av Brasil',
        number: '500',
        bairro: 'Jardim Paulista',
        city: 'Franca - SP',
        km: 6.0 // maior que 2.0 km
      },
      payment: { method: 'Dinheiro', timing: 'delivery', paidAt: null },
      items: [
        {
          productId: 'prod-trad-01',
          name: 'Açaí Tradicional',
          size: 300,
          quantity: 1,
          unitPrice: 18.90,
          accompaniments: ['Granola', 'Leite condensado', 'Ninho'],
          extras: []
        }
      ]
    };

    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.ok, true);
    assert.ok(data.order.delivery.freight > 0, 'O frete para > 2km deve ser maior que zero');
  });

  test('Cancelamento de Pedido e Contabilização nos Relatórios', async () => {
    // 1. Criar um pedido para cancelar
    const createRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Cliente a Cancelar', phone: '16999990003' },
        delivery: { type: 'pickup' },
        payment: { method: 'Pix', timing: 'online', status: 'approved' },
        items: [
          {
            productId: 'prod-trad-01',
            name: 'Açaí Tradicional',
            size: 500,
            quantity: 1,
            unitPrice: 24.90,
            accompaniments: ['Granola', 'Ninho'],
            extras: []
          }
        ]
      })
    });
    const createData = await createRes.json();
    const orderId = createData.order.id;

    // 2. Cancelar o pedido informando o motivo
    const cancelRes = await fetch(`${baseUrl}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer RafaeLL@2'
      },
      body: JSON.stringify({
        status: 'cancelled',
        reason: 'Desistência do cliente antes do preparo'
      })
    });
    const cancelData = await cancelRes.json();

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelData.order.status, 'cancelled');
    assert.strictEqual(cancelData.order.cancellationReason, 'Desistência do cliente antes do preparo');

    // 3. Consultar relatório e verificar se o pedido cancelado é contabilizado
    const reportRes = await fetch(`${baseUrl}/api/reports/sales?period=today`, {
      headers: { 'Authorization': 'Bearer RafaeLL@2' }
    });
    const reportData = await reportRes.json();

    assert.strictEqual(reportRes.status, 200);
    assert.ok(reportData.report.summary.cancelledOrdersCount >= 1, 'Deve conter pelo menos 1 pedido cancelado');
    assert.ok(reportData.report.summary.cancelledTotal >= 24.90, 'Deve conter o valor cancelado no resumo');

    const foundCancelled = reportData.report.orders.find(o => o.orderNo === cancelData.order.orderNo);
    assert.ok(foundCancelled, 'O pedido cancelado deve constar no relatório detalhado');
    assert.strictEqual(foundCancelled.isCancelled, true);
    assert.strictEqual(foundCancelled.cancellationReason, 'Desistência do cliente antes do preparo');
  });

  test('Autenticação com a nova senha RafaeLL@2 e rota de alteração de senha', async () => {
    // 1. Tentar autenticar com senha incorreta
    const failRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'senhaErrada123' })
    });
    assert.strictEqual(failRes.status, 401);

    // 2. Autenticar com a nova senha oficial RafaeLL@2
    const okRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'RafaeLL@2' })
    });
    const okData = await okRes.json();
    assert.strictEqual(okRes.status, 200);
    assert.strictEqual(okData.ok, true);
  });
});
