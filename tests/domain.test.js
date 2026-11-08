import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Order, OrderStatus, PaymentMethod } from '../src/domain/entities/Order.js';
import { Product } from '../src/domain/entities/Product.js';
import { Coupon } from '../src/domain/entities/Coupon.js';
import { ThermalPrinterService } from '../src/infrastructure/printing/ThermalPrinterService.js';

describe('Explosão Açaí - Testes de Domínio e Regras de Negócio', () => {

  test('Deve calcular troco em dinheiro com exatidão', () => {
    const order = new Order({
      orderNo: '123456',
      customer: { name: 'João Silva', phone: '16999998888' },
      items: [{ name: 'Açaí 500 ml', unitPrice: 20.0, quantity: 2, subtotal: 40.0 }],
      payment: {
        method: PaymentMethod.MONEY,
        changeFor: '50,00'
      },
      subtotal: 40.0,
      freight: 5.0,
      total: 45.0
    });

    const change = order.calculateChange();
    assert.strictEqual(change, 5.0);
  });

  test('Não deve gerar troco se o valor fornecido for menor ou igual ao total', () => {
    const order = new Order({
      orderNo: '123457',
      customer: { name: 'Maria Souza', phone: '16999997777' },
      items: [{ name: 'Combo Família', unitPrice: 99.0, quantity: 1, subtotal: 99.0 }],
      payment: {
        method: PaymentMethod.MONEY,
        changeFor: '99,00'
      },
      subtotal: 99.0,
      freight: 0,
      total: 99.0
    });

    const change = order.calculateChange();
    assert.strictEqual(change, 0);
  });

  test('Validação de cupom percentual com teto de desconto', () => {
    const coupon = new Coupon({
      code: 'EXPLOSAO10',
      type: 'percent',
      value: 10, // 10%
      minOrder: 30.0,
      maxDiscount: 5.0,
      active: true
    });

    // Subtotal de R$ 80 -> 10% seria R$ 8, mas o teto é R$ 5
    const discount = coupon.calculateDiscount(80.0);
    assert.strictEqual(discount, 5.0);

    // Se o subtotal for menor que o minOrder (R$ 30)
    const invalidCheck = coupon.isValid(20.0);
    assert.strictEqual(invalidCheck.valid, false);
  });

  test('Validação de cupom de valor fixo', () => {
    const coupon = new Coupon({
      code: 'PRIMEIRACOMPRA',
      type: 'fixed',
      value: 8.0,
      minOrder: 40.0,
      active: true
    });

    const discount = coupon.calculateDiscount(50.0);
    assert.strictEqual(discount, 8.0);
  });

  test('Geração de comanda para cozinha vs balcão destaca informações corretas', () => {
    const printerService = new ThermalPrinterService();
    const order = new Order({
      orderNo: '888999',
      customer: { name: 'Carlos Lima', phone: '16991234567' },
      delivery: {
        type: 'delivery',
        street: 'Rua das Flores',
        number: '123',
        bairro: 'Centro',
        city: 'Franca',
        state: 'SP',
        km: 3.5,
        freight: 6.0
      },
      items: [
        {
          name: 'Monte seu açaí 500 ml',
          quantity: 1,
          unitPrice: 25.80,
          subtotal: 25.80,
          accompaniments: ['Morango', 'Ninho', 'Granola'],
          extras: ['Nutella'],
          note: 'Caprichar na Nutella'
        }
      ],
      payment: {
        method: PaymentMethod.MONEY,
        changeFor: '50,00'
      },
      subtotal: 25.80,
      discount: 0,
      freight: 6.0,
      total: 31.80
    });

    const kitchenTicket = printerService.generateTicket(order, 'kitchen', 80);
    assert.ok(kitchenTicket.includes('VIA DE PRODUÇÃO / COZINHA'));
    assert.ok(kitchenTicket.includes('CAPRICHAR NA NUTELLA'));
    assert.ok(!kitchenTicket.includes('LEVAR TROCO')); // cozinha não deve ter troco

    const counterTicket = printerService.generateTicket(order, 'counter', 80);
    assert.ok(counterTicket.includes('VIA CLIENTE / ENTREGA'));
    assert.ok(counterTicket.includes('LEVAR TROCO: R$ 18,20'));
    assert.ok(counterTicket.includes('Rua das Flores, 123'));
  });

  test('Regra de Impressão Rígida: Só libera impressão após pagamento confirmado no Pix/Cartão, ou de imediato em Dinheiro', () => {
    // Pedido no dinheiro: liberado imediatamente
    const moneyOrder = new Order({
      orderNo: '111222',
      customer: { name: 'Teste Dinheiro', phone: '16999990000' },
      payment: { method: PaymentMethod.MONEY, status: 'pending' },
      total: 30.0
    });
    assert.strictEqual(moneyOrder.canPrint().allowed, true);

    // Pedido no Pix pendente: BLOQUEADO
    const pendingPixOrder = new Order({
      orderNo: '111223',
      customer: { name: 'Teste Pix', phone: '16999990001' },
      payment: { method: PaymentMethod.PIX, status: 'pending' },
      total: 30.0
    });
    assert.strictEqual(pendingPixOrder.canPrint().allowed, false);
    assert.ok(pendingPixOrder.canPrint().reason.includes('Aguardando confirmação'));

    // Pedido no Pix aprovado pelo banco: LIBERADO
    const approvedPixOrder = new Order({
      orderNo: '111224',
      customer: { name: 'Teste Pix Aprovado', phone: '16999990002' },
      payment: { method: PaymentMethod.PIX, status: 'approved' },
      total: 30.0
    });
    assert.strictEqual(approvedPixOrder.canPrint().allowed, true);

    // Pedido no Cartão na Entrega (Maquininha com motoboy): LIBERADO de imediato
    const cardOnDeliveryOrder = new Order({
      orderNo: '111225',
      customer: { name: 'Teste Cartão Entrega', phone: '16999990003' },
      payment: { method: PaymentMethod.CREDIT_CARD, timing: 'delivery', status: 'pay_on_delivery' },
      total: 45.0
    });
    assert.strictEqual(cardOnDeliveryOrder.canPrint().allowed, true);
  });

  test('Ficha Técnica e Alerta de Prejuízo no Domínio', () => {
    const profitableProduct = new Product({
      name: 'Açaí 500ml',
      category: 'prontos',
      prices: [
        { size: 500, price: 20.0, costPrice: 9.0 }
      ]
    });
    assert.strictEqual(profitableProduct.prices[0].isLoss, false);

    const lossProduct = new Product({
      name: 'Combo com Prejuízo',
      category: 'combos',
      prices: [
        { size: 500, price: 15.0, costPrice: 18.5 }
      ]
    });
    assert.strictEqual(lossProduct.prices[0].isLoss, true);
    assert.strictEqual(lossProduct.prices[0].lossAmount, 3.5);
  });

});
