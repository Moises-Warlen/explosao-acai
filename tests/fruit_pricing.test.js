import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { catalogService } from '../src/application/services/CatalogService.js';
import { orderService } from '../src/application/services/OrderService.js';
import { db } from '../src/infrastructure/database/JsonDatabase.js';

describe('Controle de Preço Individual de Frutas Adicionais', () => {

  test('1. getCatalog() e getFruits() retornam lista com preços e custos individuais', () => {
    const catalog = catalogService.getCatalog();
    assert.ok(Array.isArray(catalog.fruits), 'Catalog deve ter array de frutas');
    assert.ok(catalog.fruits.length >= 5, 'Deve ter pelo menos 5 frutas cadastradas');

    const banana = catalog.fruits.find(f => f.name.toLowerCase() === 'banana');
    assert.ok(banana, 'Banana deve estar cadastrada');
    assert.strictEqual(typeof banana.price, 'number');
    assert.strictEqual(typeof banana.costPrice, 'number');
    assert.strictEqual(typeof banana.active, 'boolean');
  });

  test('2. CRUD de Frutas: Criar, Atualizar preço individual e Excluir fruta', () => {
    // 1. Criar Fruta
    const novaFruta = catalogService.createFruit({
      name: 'Abacaxi Pérola Teste',
      price: 4.50,
      costPrice: 1.20,
      active: true
    });

    assert.ok(novaFruta.id);
    assert.strictEqual(novaFruta.name, 'Abacaxi Pérola Teste');
    assert.strictEqual(novaFruta.price, 4.50);

    // 2. Atualizar Preço da Fruta
    const atualizada = catalogService.updateFruit(novaFruta.id, {
      price: 5.50,
      costPrice: 1.80
    });
    assert.strictEqual(atualizada.price, 5.50);
    assert.strictEqual(atualizada.costPrice, 1.80);

    // 3. Excluir Fruta
    const removida = catalogService.deleteFruit(novaFruta.id);
    assert.strictEqual(removida.id, novaFruta.id);
  });

  test('3. Criação de Pedido: Preço de frutas adicionais calculado com base no valor individual de cada uma', async () => {
    const catalog = catalogService.getCatalog();
    const acaiTrad = catalog.products[0];
    assert.ok(acaiTrad);
    const size300 = acaiTrad.prices[0];
    const basePrice = size300.promoPrice != null ? size300.promoPrice : size300.price;

    const banana = catalog.fruits.find(f => f.name.toLowerCase() === 'banana');
    const morango = catalog.fruits.find(f => f.name.toLowerCase() === 'morango');
    assert.ok(banana && morango);

    // Configura preços individuais temporários para teste
    catalogService.updateFruit(banana.id, { price: 2.50 });
    catalogService.updateFruit(morango.id, { price: 4.50 });

    const order = await orderService.createOrder({
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
    });

    const expectedUnitPrice = Number((basePrice + 2.50 + 4.50).toFixed(2));
    assert.strictEqual(order.items[0].unitPrice, expectedUnitPrice);
    assert.strictEqual(order.subtotal, expectedUnitPrice);

    // Restaura preços oficiais da Ficha Técnica
    catalogService.updateFruit(banana.id, { price: 2.50 });
    catalogService.updateFruit(morango.id, { price: 4.00 });
  });

  test('4. Navegação do Menu: Aba Frutas (#nav-tab-fruits) deve abrir a subvisão de Frutas sem bloqueio', async () => {
    const fs = await import('node:fs');
    const adminHtml = fs.readFileSync('public/admin.html', 'utf-8');
    const adminJs = fs.readFileSync('public/js/admin.js', 'utf-8');

    // Garante que o botão Frutas existe no menu superior com id e data-tab
    assert.ok(adminHtml.includes('id="nav-tab-fruits"'), 'Deve existir o botão #nav-tab-fruits');
    assert.ok(adminHtml.includes('openFruitsAdminTab(event)'), 'Deve conter chamada openFruitsAdminTab no botão Frutas');

    // Garante que bindNavigation() não bloqueia Frutas com return vazio
    assert.ok(!adminJs.includes("if (tab.id === 'nav-tab-fruits') return;"), 'bindNavigation não pode ter return vazio para nav-tab-fruits');
    assert.ok(adminJs.includes("window.openFruitsAdminTab(e)"), 'bindNavigation deve delegar para openFruitsAdminTab');
    assert.ok(adminJs.includes("tabId === 'tab-fruits' || tabId === 'nav-tab-fruits'"), 'switchAdminTab deve suportar frutas');
  });

});
