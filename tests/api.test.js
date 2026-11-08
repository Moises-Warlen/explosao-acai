process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { server } from '../src/server.js';

describe('Explosão Açaí - Testes de Integração da API', () => {
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

  test('GET /api/catalog - Deve retornar os produtos originais do cardápio e categorias', async () => {
    const res = await fetch(`${baseUrl}/api/catalog`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(Array.isArray(data.products));
    assert.ok(Array.isArray(data.categories));
    assert.ok(data.products.length >= 10);

    const docetentacao = data.products.find(p => p.name === 'Doce Tentação');
    assert.ok(docetentacao);
  });

  test('POST /api/coupons/validate - Deve validar cupom existente', async () => {
    const res = await fetch(`${baseUrl}/api/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'EXPLOSAO10', subtotal: 50.0 })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.coupon.code, 'EXPLOSAO10');
    assert.strictEqual(data.coupon.discount, 5.0); // 10% de 50
  });

  test('POST /api/orders - Deve criar pedido com cálculo de troco em dinheiro', async () => {
    const payload = {
      customer: { name: 'Lucas Delivery', phone: '16998887766' },
      delivery: {
        type: 'delivery',
        street: 'Avenida Brasil',
        number: '500',
        bairro: 'Centro',
        city: 'Franca',
        state: 'SP',
        km: 4.0,
        freight: 5.0
      },
      items: [
        {
          name: 'Ninho com Morango 500 ml',
          size: 500,
          quantity: 1,
          unitPrice: 30.90,
          accompaniments: ['Morango', 'Ninho'],
          extras: ['Nutella'],
          note: 'Colher separada'
        }
      ],
      payment: {
        method: 'Dinheiro',
        changeFor: '50,00'
      },
      couponCode: 'PRIMEIRACOMPRA'
    };

    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.order.orderNo);
    assert.strictEqual(data.order.discount, 5.0);

    // Subtotal: 30.90 - 5.00 + 5.00 frete = 30.90 total
    // Troco para R$ 50,00: 50 - 30.90 = 19.10
    assert.strictEqual(data.order.payment.trocoValue, 19.10);
  });

  test('Regra de Impressão Rígida: Bloqueia impressão de Pix pendente e libera após confirmação bancária', async () => {
    // 1. Cria pedido Pix
    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Ana Beatriz', phone: '16991112233' },
        delivery: { type: 'pickup' },
        items: [{ name: 'Combo Casal 500 ml', quantity: 1, unitPrice: 64.90 }],
        payment: { method: 'Pix' }
      })
    });
    const { order } = await orderRes.json();

    // 2. Tenta imprimir com status pendente -> DEVE BLOQUEAR (HTTP 400)
    const blockRes = await fetch(`${baseUrl}/api/orders/${order.id}/print`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'explosao123'
      },
      body: JSON.stringify({ target: 'kitchen' })
    });
    assert.strictEqual(blockRes.status, 400);
    const blockData = await blockRes.json();
    assert.ok(blockData.error.includes('Aguardando confirmação'));

    // 3. Simula confirmação do banco / Webhook
    const approveRes = await fetch(`${baseUrl}/api/test/simulate-payment/${order.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'explosao123'
      }
    });
    assert.strictEqual(approveRes.status, 200);

    // 4. Agora que o banco aprovou, a impressão DEVE SER LIBERADA (HTTP 200)
    const printKitchenRes = await fetch(`${baseUrl}/api/orders/${order.id}/print`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'explosao123'
      },
      body: JSON.stringify({ target: 'kitchen' })
    });
    assert.strictEqual(printKitchenRes.status, 200);
    const kitchenData = await printKitchenRes.json();
    assert.ok(kitchenData.printJob.ticketText.includes('PRODUÇÃO / COZINHA'));
  });

  test('POST /api/chat - Envio e recebimento de mensagens em tempo real', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'customer',
        customerPhone: '16998887766',
        customerName: 'Lucas Delivery',
        message: 'Olá, meu açaí já saiu para entrega?'
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.message.customerPhone, '16998887766');

    // Consulta mensagens do cliente
    const getRes = await fetch(`${baseUrl}/api/chat?phone=16998887766`);
    const getData = await getRes.json();
    assert.ok(getData.messages.some(m => m.message.includes('meu açaí já saiu')));
  });

  test('GET /api/reports/sales - Deve retornar consolidação financeira de vendas', async () => {
    const res = await fetch(`${baseUrl}/api/reports/sales?period=all`, {
      headers: {
        'x-admin-token': 'explosao123'
      }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.report.summary);
    assert.ok(data.report.summary.totalNetSales > 0);
    assert.ok(data.report.paymentBreakdown['Dinheiro'].count >= 1);
    assert.ok(Array.isArray(data.report.bestSellers));
    assert.ok(Array.isArray(data.report.worstSellers));
    assert.strictEqual(typeof data.report.summary.averagePreparationTimeMinutes, 'number');
    assert.strictEqual(typeof data.report.summary.averageDeliveryTimeMinutes, 'number');
  });

  test('CRUD de Acompanhamentos e Regras de Limites', async () => {
    // 1. Lista acompanhamentos
    const listRes = await fetch(`${baseUrl}/api/catalog/accompaniments`, {
      headers: { 'x-admin-token': 'explosao123' }
    });
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.strictEqual(listData.ok, true);
    assert.ok(listData.accompaniments.length >= 15);

    // 2. Cria novo acompanhamento
    const createRes = await fetch(`${baseUrl}/api/catalog/accompaniments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'explosao123'
      },
      body: JSON.stringify({
        name: 'Castanha de Caju',
        costPrice: 0.90,
        active: true
      })
    });
    assert.strictEqual(createRes.status, 201);
    const createData = await createRes.json();
    assert.strictEqual(createData.accompaniment.name, 'Castanha de Caju');

    // 3. Deleta o acompanhamento criado
    const delRes = await fetch(`${baseUrl}/api/catalog/accompaniments/${createData.accompaniment.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': 'explosao123' }
    });
    assert.strictEqual(delRes.status, 200);
  });

  test('POST /api/orders com Cartão na Entrega (timing: delivery) libera impressão imediata', async () => {
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Mariana Costa', phone: '16993334455' },
        delivery: {
          type: 'delivery',
          street: 'Rua das Palmeiras',
          number: '450',
          bairro: 'Jardim Primavera',
          freight: 5.5,
          km: 4.0
        },
        items: [{ name: 'Ninho com Morango 500 ml', size: 500, quantity: 1, unitPrice: 30.90 }],
        payment: {
          method: 'Cartão de crédito',
          timing: 'delivery'
        }
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.order.payment.timing, 'delivery');

    // Tenta imprimir de imediato -> DEVE SER PERMITIDO porque o cliente paga na maquininha com o motoboy
    const printRes = await fetch(`${baseUrl}/api/orders/${data.order.id}/print`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'explosao123'
      },
      body: JSON.stringify({ target: 'counter' })
    });
    assert.strictEqual(printRes.status, 200);
    const printData = await printRes.json();
    assert.ok(printData.printJob.ticketText.includes('LEVAR MAQUININHA DE CARTÃO'));
  });

});
