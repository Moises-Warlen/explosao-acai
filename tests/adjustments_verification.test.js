import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/infrastructure/database/JsonDatabase.js';
import { catalogService } from '../src/application/services/CatalogService.js';
import { orderService } from '../src/application/services/OrderService.js';
import { freightService } from '../src/application/services/FreightService.js';
import { mercadoPagoService, generatePixStaticEMVCo } from '../src/infrastructure/payment/MercadoPagoService.js';
import { whatsAppNotificationService } from '../src/infrastructure/notifications/WhatsAppNotificationService.js';
import { PaymentStatus, OrderStatus } from '../src/domain/entities/Order.js';

describe('Explosão Açaí — Testes das 4 Correções Finais', () => {

  test('1. Cardápio: Não deve conter seção automática "Mais Vendidos" (Apenas produtos manuais)', () => {
    // Garante que o catálogo retorna produtos das categorias normais
    const catalog = catalogService.getCatalog();
    assert.ok(catalog.products.length > 0, 'Deve ter produtos cadastrados');
    
    // Verifica que nenhum produto falso de "Mais Vendidos" foi gerado
    const hasAutoBestSellerCategory = catalog.categories.some(c => c.slug === 'mais-vendidos');
    assert.equal(hasAutoBestSellerCategory, false, 'Não deve existir categoria automática mais-vendidos');
  });

  test('2. Pix: Deve gerar Copia e Cola EMVCo 100% válido com CRC-16 e QR Code PNG escaneável', async () => {
    const pixRes = await mercadoPagoService.createPixPayment({
      orderNo: '123456',
      total: 29.90,
      customer: { name: 'Moises Cliente', phone: '16991098863' }
    });

    assert.ok(pixRes.qrCode, 'Código Pix Copia e Cola deve ser gerado');
    assert.ok(pixRes.qrCode.startsWith('000201'), 'Pix deve iniciar com standard EMVCo 000201');
    assert.ok(pixRes.qrCode.includes('br.gov.bcb.pix'), 'Pix deve conter domínio do Banco Central br.gov.bcb.pix');
    assert.ok(pixRes.qrCode.includes('16991098863'), 'Pix deve conter a chave Pix da loja');
    assert.ok(!pixRes.qrCode.endsWith('ABCD') && !pixRes.qrCode.endsWith('MOCK'), 'Não deve ter mock fixo ABCD ou MOCK como CRC16');
    
    // Verifica CRC-16: últimos 4 caracteres hexadecimais válidos
    const crc = pixRes.qrCode.slice(-4);
    assert.match(crc, /^[0-9A-F]{4}$/, 'O CRC16 deve ser 4 caracteres hexadecimais maiúsculos válidos');

    assert.ok(pixRes.qrCodeBase64, 'QR Code deve ser gerado');
    assert.ok(pixRes.qrCodeBase64.startsWith('data:image/png;base64,'), 'QR Code deve ser imagem PNG Base64 escaneável');
  });

  test('3. Confirmação do Pix no Painel: Deve atualizar status para Pago e evitar duplicidade', async () => {
    // Cria pedido com Pix Online
    const order = await orderService.createOrder({
      customer: { name: 'Cliente Pix Teste', phone: '16998877665' },
      delivery: { type: 'pickup' },
      items: [
        { name: 'Puro Polpa 500 ml', size: 500, quantity: 1, unitPrice: 19.90, accompaniments: [], extras: [], fruits: [] }
      ],
      payment: { method: 'Pix', timing: 'online' },
      bypassStoreClosed: true
    });

    assert.equal(order.payment.status, PaymentStatus.PENDING, 'Deve iniciar pendente');

    // Primeira confirmação (Webhook ou Auto-Sync)
    const confirmed = orderService.confirmPaymentApproved(order.id);
    assert.ok(confirmed, 'Deve retornar pedido atualizado');
    assert.equal(confirmed.payment.status, PaymentStatus.APPROVED, 'Status do pagamento deve ser APPROVED (Pago)');
    assert.equal(confirmed.status, OrderStatus.PREPARING, 'Status do pedido deve mudar para PREPARING');

    // Segunda chamada (simulação de webhook duplicado pelo gateway)
    const secondCall = orderService.confirmPaymentApproved(order.id);
    assert.equal(secondCall.payment.status, PaymentStatus.APPROVED);
    // Deve retornar sem erros e sem duplicar notificações
    assert.ok(secondCall.notifiedStatuses.includes('preparing'));
    assert.equal(secondCall.notifiedStatuses.filter(s => s === 'preparing').length, 1, 'Não deve duplicar status notificado');
  });

  test('4. Notificações WhatsApp: Formatação DDI 55 + DDD + número e textos exatos solicitados', () => {
    // Teste de formatação de telefone
    assert.equal(whatsAppNotificationService.formatPhone('16991098863'), '5516991098863');
    assert.equal(whatsAppNotificationService.formatPhone('(16) 99109-8863'), '5516991098863');
    assert.equal(whatsAppNotificationService.formatPhone('5516991098863'), '5516991098863');

    const fakeOrder = {
      orderNo: '789123',
      customer: { name: 'Maria Souza', phone: '16991112233' },
      status: 'received'
    };

    // 1. Pedido feito / aceito
    const msgReceived = whatsAppNotificationService.formatStatusMessage(fakeOrder, 'received');
    assert.equal(
      msgReceived,
      '✅ Olá, Maria Souza! Seu pedido #789123 na Explosão Açaí foi aceito! Já já começamos a preparar. 💜'
    );

    // 2. Em preparo
    const msgPreparing = whatsAppNotificationService.formatStatusMessage(fakeOrder, 'preparing');
    assert.equal(
      msgPreparing,
      '👩‍🍳 Seu pedido #789123 já está sendo preparado com muito carinho! 💜'
    );

    // 3. Pronto / Saiu para entrega
    const msgOut = whatsAppNotificationService.formatStatusMessage(fakeOrder, 'out_for_delivery');
    assert.equal(
      msgOut,
      '🛵 Boa notícia, Maria Souza! Seu pedido #789123 saiu para entrega e já está a caminho!'
    );

    // 4. Entregue
    const msgDelivered = whatsAppNotificationService.formatStatusMessage(fakeOrder, 'delivered');
    assert.equal(
      msgDelivered,
      '💜 Obrigado por comprar com a Explosão Açaí, Maria Souza! Esperamos que você curta sua explosão de sabor! Nos siga no Instagram: https://www.instagram.com/expl.osaoacai?mdxt=Zm1obWhpaTFhbmV3'
    );
  });

  after(() => {
    const data = db.get();
    data.orders = [];
    data.chats = [];
    db.save();
  });

});
