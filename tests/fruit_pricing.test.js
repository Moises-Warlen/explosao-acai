process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { server } from '../src/server.js';

function req(options, body = null) {
  return new Promise((resolve, reject) => {
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

describe('Controle de Preço Individual de Frutas Adicionais', () => {
  let port;
  let token;

  before(async () => {
    if (!server.listening) {
      await new Promise(resolve => server.listen(0, resolve));
    }
    port = server.address().port;

    // Login admin com a senha oficial
    const loginRes = await req({
      hostname: 'localhost',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { password: 'RafaeLL@2' });

    assert.strictEqual(loginRes.status, 200);
    token = loginRes.body.token;
  });

  test('1. GET /api/catalog/fruits - Retorna lista de frutas com preços individuais', async () => {
    const res = await req({
      hostname: 'localhost',
      port,
      path: '/api/catalog/fruits',
      method: 'GET'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(Array.isArray(res.body.fruits));
    assert.ok(res.body.fruits.length >= 5);

    const banana = res.body.fruits.find(f => f.name.toLowerCase() === 'banana');
    assert.ok(banana);
    assert.strictEqual(typeof banana.price, 'number');
    assert.strictEqual(typeof banana.costPrice, 'number');
  });

  test('2. CRUD de Frutas: Criar, Atualizar preço individual e Excluir fruta', async () => {
    // Criar Fruta
    const createRes = await req({
      hostname: 'localhost',
      port,
      path: '/api/catalog/fruits',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {
      name: 'Abacaxi Pérola',
      price: 4.50,
      costPrice: 1.20,
      active: true
    });

    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.ok, true);
    const createdFruit = createRes.body.fruit;
    assert.strictEqual(createdFruit.name, 'Abacaxi Pérola');
    assert.strictEqual(createdFruit.price, 4.50);

    // Atualizar Preço da Fruta
    const updateRes = await req({
      hostname: 'localhost',
      port,
      path: `/api/catalog/fruits/${createdFruit.id}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {
      price: 5.00,
      costPrice: 1.50
    });

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.ok, true);
    assert.strictEqual(updateRes.body.fruit.price, 5.00);

    // Excluir Fruta
    const delRes = await req({
      hostname: 'localhost',
      port,
      path: `/api/catalog/fruits/${createdFruit.id}`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.body.ok, true);
  });

  test('3. Criação de Pedido: Preço de frutas adicionais calculado com base no valor individual de cada uma', async () => {
    // Obter cardápio para pegar um produto base
    const catRes = await req({
      hostname: 'localhost',
      port,
      path: '/api/catalog',
      method: 'GET'
    });
    const catalog = catRes.body;
    const acaiTrad = catalog.products.find(p => p.id === 'acai_tradicional' || p.name.includes('Açaí Tradicional'));
    assert.ok(acaiTrad);
    const size300 = acaiTrad.prices.find(pr => Number(pr.size) === 300) || acaiTrad.prices[0];
    const basePrice = size300.promoPrice != null ? size300.promoPrice : size300.price;

    // Atualiza temporariamente os preços das frutas Banana e Morango para valores distintos
    const banana = catalog.fruits.find(f => f.name.toLowerCase() === 'banana');
    const morango = catalog.fruits.find(f => f.name.toLowerCase() === 'morango');
    assert.ok(banana && morango);

    await req({
      hostname: 'localhost',
      port,
      path: `/api/catalog/fruits/${banana.id}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { price: 2.50 });

    await req({
      hostname: 'localhost',
      port,
      path: `/api/catalog/fruits/${morango.id}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { price: 4.50 });

    // Cria pedido com 1 copo contendo Banana e Morango como frutas adicionais
    const orderPayload = {
      customer: {
        name: 'Cliente Teste Frutas',
        phone: '16999998888',
        address: 'Rua Teste, 100',
        neighborhood: 'Centro',
        city: 'Franca',
        state: 'SP',
        distanceKm: 1
      },
      items: [
        {
          id: acaiTrad.id,
          name: acaiTrad.name,
          size: size300.size,
          quantity: 1,
          accompaniments: ['Granola'],
          extras: ['Frutas: Banana (+R$ 2,50), Morango (+R$ 4,50)'],
          fruits: ['Banana', 'Morango'],
          note: ''
        }
      ],
      payment: {
        method: 'Dinheiro',
        changeFor: 50
      },
      deliveryType: 'delivery'
    };

    const orderRes = await req({
      hostname: 'localhost',
      port,
      path: '/api/orders',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, orderPayload);

    assert.strictEqual(orderRes.status, 201);
    assert.strictEqual(orderRes.body.ok, true);
    const createdOrder = orderRes.body.order;

    // O preço do item deve ser: basePrice + 2.50 (Banana) + 4.50 (Morango) = basePrice + 7.00
    const expectedUnitPrice = Number((basePrice + 2.50 + 4.50).toFixed(2));
    assert.strictEqual(createdOrder.items[0].unitPrice, expectedUnitPrice);
    assert.strictEqual(createdOrder.subtotal, expectedUnitPrice);

    // Restaura preços padrões
    await req({
      hostname: 'localhost',
      port,
      path: `/api/catalog/fruits/${banana.id}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { price: 3.90 });

    await req({
      hostname: 'localhost',
      port,
      path: `/api/catalog/fruits/${morango.id}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { price: 3.90 });
  });
});
