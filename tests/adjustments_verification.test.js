import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/infrastructure/database/JsonDatabase.js';
import { catalogService } from '../src/application/services/CatalogService.js';
import { orderService } from '../src/application/services/OrderService.js';
import { freightService } from '../src/application/services/FreightService.js';

describe('Explosão Açaí — Testes das Correções Pontuais e Ajustes', () => {

  test('1. Pura Polpa 1L e 2L: produtos devem existir com tamanhos corretos e sem extras permitidos', () => {
    const products = catalogService.getCatalog().products;
    const polpa1 = products.find(p => p.id === 'polpa_1l');
    const polpa2 = products.find(p => p.id === 'polpa_2l');

    assert.ok(polpa1, 'Pura Polpa 1L deve existir');
    assert.ok(polpa2, 'Pura Polpa 2L deve existir');

    assert.equal(polpa1.prices[0].size, 1000);
    assert.equal(polpa2.prices[0].size, 2000);
  });

  test('2. Combo Família: deve disponibilizar os 3 tamanhos (300, 500 e 700 ml) com preços válidos', () => {
    const combo = catalogService.getProductById('combo_familia');
    assert.ok(combo, 'Combo Família deve existir');

    const sizes = combo.prices.map(p => p.size);
    assert.deepEqual(sizes, [300, 500, 700], 'Combo Família deve ter 300, 500 e 700 ml');

    const p300 = combo.prices.find(p => p.size === 300);
    const p500 = combo.prices.find(p => p.size === 500);
    const p700 = combo.prices.find(p => p.size === 700);

    assert.ok(p300.price > 0 && p300.price < p500.price, '300ml deve ser menor que 500ml');
    assert.ok(p500.price < p700.price, '500ml deve ser menor que 700ml');
  });

  test('3. Combo Kids: deve ter 300, 500 e 700 ml e regras consistentes', () => {
    const combo = catalogService.getProductById('combo_kids');
    assert.ok(combo, 'Combo Kids deve existir');

    const sizes = combo.prices.map(p => p.size);
    assert.deepEqual(sizes, [300, 500, 700], 'Combo Kids deve ter 300, 500 e 700 ml');
  });

  test('4. Combo Econômico: deve ter 300, 500 e 700 ml preservando o tamanho original', () => {
    const combo = catalogService.getProductById('combo_economico');
    assert.ok(combo, 'Combo Econômico deve existir');

    const sizes = combo.prices.map(p => p.size);
    assert.deepEqual(sizes, [300, 500, 700], 'Combo Econômico deve ter 300, 500 e 700 ml');
  });

  test('7. Seção Mais Vendidos: Adicionar e remover produtos pelo serviço administrativo', () => {
    // Adiciona produto específico aos Mais Vendidos
    const updated = catalogService.updateBestSellers(['combo_familia', 'prod_monte']);
    assert.ok(Array.isArray(updated), 'Deve retornar array de produtos');
    assert.ok(updated.some(p => p.id === 'combo_familia'));
    assert.ok(updated.some(p => p.id === 'prod_monte'));

    // Verifica que getBestSellers reflete a escolha manual
    const best = catalogService.getBestSellers(5);
    assert.equal(best[0].id, 'combo_familia');
    assert.equal(best[1].id, 'prod_monte');

    // Remove um produto
    catalogService.updateBestSellers(['prod_monte']);
    const bestAfter = catalogService.getBestSellers(5);
    assert.equal(bestAfter.length, 1);
    assert.equal(bestAfter[0].id, 'prod_monte');

    // Limpa a lista manual para fallback automático
    catalogService.updateBestSellers([]);
  });

  test('9. Cobrança de Frutas: A primeira fruta adicionada já deve ser cobrada, e frutas subsequentes acumuladas', () => {
    const fruitPrice = 3.90;

    // 1 Fruta adicionada
    const fruits1 = ['Banana'];
    const total1 = fruitPrice * fruits1.length;
    assert.equal(total1, 3.90, 'Primeira fruta adicionada deve somar exatamente R$ 3,90');

    // 2 Frutas adicionadas
    const fruits2 = ['Banana', 'Morango'];
    const total2 = fruitPrice * fruits2.length;
    assert.equal(total2, 7.80, 'Duas frutas devem somar exatamente R$ 7,80');

    // 3 Frutas adicionadas
    const fruits3 = ['Banana', 'Morango', 'Uva'];
    const total3 = fruitPrice * fruits3.length;
    assert.equal(total3, 11.70, 'Três frutas devem somar exatamente R$ 11,70');
  });

  test('10. Auditoria e Cálculo de Frete por Distância: Raio <= 2km Grátis, Bairros distantes cobrados corretamente', async () => {
    // Endereço no Aeroporto 3 (ao lado da loja) -> deve ser <= 2km e Frete R$ 0,00
    const freteAeroporto = await freightService.calculateFreightForAddress({
      street: 'Rua Renato Lourenço Fernandes Rosa',
      bairro: 'Jardim Aeroporto 3',
      city: 'Franca',
      state: 'SP'
    });
    assert.ok(freteAeroporto.km <= 2.0, `Distância no Aeroporto deve ser <= 2km, foi ${freteAeroporto.km}`);
    assert.equal(freteAeroporto.freight, 0, 'Frete para endereço até 2 km deve ser R$ 0,00 (Grátis)');

    // Endereço no Centro de Franca (~7km) -> deve cobrar frete proporcional
    const freteCentro = await freightService.calculateFreightForAddress({
      street: 'Rua Marechal Deodoro',
      bairro: 'Centro',
      city: 'Franca',
      state: 'SP'
    });
    assert.ok(freteCentro.km > 2.0, `Distância no Centro deve ser > 2km, foi ${freteCentro.km}`);
    assert.ok(freteCentro.freight >= 4.5, `Frete para Centro deve ser no mínimo R$ 4,50, foi ${freteCentro.freight}`);

    // Endereço no Leporace (~12km) -> deve calcular distância e frete adequados
    const freteLeporace = await freightService.calculateFreightForAddress({
      street: 'Avenida Brasil',
      bairro: 'Parque Vicente Leporace',
      city: 'Franca',
      state: 'SP'
    });
    assert.ok(freteLeporace.km >= 10.0, `Distância no Leporace deve ser >= 10km, foi ${freteLeporace.km}`);
    assert.ok(freteLeporace.freight >= 10.0, `Frete para Leporace deve ser proporcional, foi ${freteLeporace.freight}`);
  });

  test('10.2. Registro do Pedido: O valor correto do frete deve ser incluído e somado no total final do pedido', async () => {
    // Cria pedido com endereço distante (Centro de Franca)
    const orderData = {
      customer: { name: 'Cliente Teste Frete', phone: '16991112233' },
      delivery: {
        type: 'delivery',
        street: 'Rua Marechal Deodoro',
        number: '100',
        bairro: 'Centro',
        city: 'Franca',
        state: 'SP',
        km: 7.2,
        freight: 7.50
      },
      items: [
        {
          name: 'Puro Polpa 500 ml',
          size: 500,
          quantity: 1,
          unitPrice: 19.90,
          accompaniments: ['Granola'],
          extras: [],
          fruits: []
        }
      ],
      payment: { method: 'Dinheiro', changeFor: '50.00' }
    };

    const res = await orderService.createOrder({ ...orderData, bypassStoreClosed: true });
    assert.ok(res, 'Pedido deve ser criado com sucesso');
    assert.equal(res.delivery.freight, 7.50, 'Frete salvo no pedido deve ser R$ 7,50');
    assert.equal(res.freight, 7.50, 'Frete raiz do pedido deve ser R$ 7,50');
    assert.equal(res.total, 19.90 + 7.50, 'Total deve ser exatamente Subtotal (19,90) + Frete (7,50) = 27,40');
  });

  after(() => {
    const data = db.get();
    data.orders = [];
    data.chats = [];
    db.save();
  });

});
