import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { db } from '../src/infrastructure/database/JsonDatabase.js';
import { orderService, getBrasiliaDateString } from '../src/application/services/OrderService.js';
import { OrderStatus, PaymentStatus } from '../src/domain/entities/Order.js';

function createAdminVm(extraOrders = [], expandedSet = new Set()) {
  const adminJsCode = fs.readFileSync(path.resolve('public/js/admin.js'), 'utf-8');
  const toasts = [];
  const toastElement = {
    set innerHTML(val) { toasts.push(val); },
    get innerHTML() { return toasts[toasts.length - 1] || ''; },
    className: ''
  };

  const context = {
    window: {},
    setTimeout,
    clearTimeout,
    location: { host: 'localhost:10000', protocol: 'http:' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      querySelector: (sel) => sel === '#admin-toast' ? toastElement : null,
      querySelectorAll: () => [],
      getElementById: (id) => id === 'admin-toast' ? toastElement : null,
      addEventListener: () => {}
    },
    addEventListener: () => {},
    $: (sel) => sel === '#admin-toast' ? toastElement : null,
    esc: (str) => String(str || ''),
    R: (val) => `R$ ${Number(val).toFixed(2).replace('.', ',')}`,
    EXPANDED_ORDERS: expandedSet,
    ORDERS: extraOrders,
    KANBAN_PAGE: {},
    authHeaders: () => ({}),
    API_URL: '/api'
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(adminJsCode, context);

  return { context, toasts };
}

describe('Explosão Açaí — Automação do Histórico Diário e Regras de UI', () => {

  test('1, 2, 3, 4, 5: Fluxo de conclusão de pedido, exibição em Entregues Hoje, virada do dia e histórico permanente', async () => {
    // 1. Criar pedido de teste e concluir entrega
    const order = await orderService.createOrder({
      customer: { name: 'Cliente Teste Histórico', phone: '16999998888' },
      delivery: { type: 'pickup' },
      items: [
        { name: 'Copo Açaí 500 ml', size: 500, quantity: 2, unitPrice: 19.90, accompaniments: ['Banana', 'Leite em Pó'], extras: ['Nutella'], note: 'Caprichado' }
      ],
      payment: { method: 'Dinheiro', timing: 'delivery', changeFor: '50' },
      bypassStoreClosed: true
    });

    const concluded = orderService.confirmDeliveryAndPayment(order.id);
    assert.equal(concluded.status, OrderStatus.DELIVERED, 'Pedido deve estar com status delivered');
    assert.ok(concluded.deliveredAt, 'Deve ter data e hora de conclusão (deliveredAt)');

    const todayBrasilia = getBrasiliaDateString(new Date());
    const orderDateBrasilia = getBrasiliaDateString(concluded.deliveredAt);
    assert.equal(orderDateBrasilia, todayBrasilia, 'Data de conclusão deve ser hoje em Brasília');

    // 2. Confirmar que ele aparece em "Entregues Hoje"
    assert.equal(concluded.archivedToHistory, false, 'Recém-entregue não deve estar arquivado');
    const isTodayDelivered = concluded.status === OrderStatus.DELIVERED && !concluded.archivedToHistory && orderDateBrasilia === todayBrasilia;
    assert.ok(isTodayDelivered, 'Pedido deve pertencer a Entregues Hoje');

    // 3. Simular a virada do dia (ex: amanhã ou data futura em Brasília)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowBrasilia = getBrasiliaDateString(tomorrow);

    const archiveResult = orderService.archiveDailyCompletedOrders(tomorrowBrasilia);
    assert.ok(archiveResult.count >= 1, 'Pelo menos um pedido deve ser arquivado para o novo dia');

    // 4. Confirmar que "Entregues Hoje" fica vazia para o novo dia
    const reloaded = orderService.getOrderById(order.id);
    assert.equal(reloaded.archivedToHistory, true, 'Pedido concluído no dia anterior agora está arquivado');
    assert.ok(reloaded.archivedAt, 'Deve ter data de arquivamento');

    const appearsInTodayForNewDay = reloaded.status === OrderStatus.DELIVERED && !reloaded.archivedToHistory && (orderDateBrasilia === tomorrowBrasilia);
    assert.equal(appearsInTodayForNewDay, false, 'Entregues Hoje deve estar zerada em relação ao pedido do dia anterior');

    // 5. Confirmar que os pedidos antigos continuam salvos permanentemente no histórico
    const inHistory = reloaded.status === OrderStatus.DELIVERED && (reloaded.archivedToHistory || orderDateBrasilia < tomorrowBrasilia);
    assert.ok(inHistory, 'Pedido antigo deve estar disponível na coluna Pedidos Concluídos');
    assert.equal(reloaded.customer.name, 'Cliente Teste Histórico', 'Nome do cliente preservado');
    assert.equal(reloaded.items.length, 1, 'Itens preservados');
    assert.equal(reloaded.items[0].name, 'Copo Açaí 500 ml', 'Produto preservado');
    assert.equal(reloaded.total, 39.80, 'Valor preservado');
    assert.ok(reloaded.deliveredAt, 'Data e horário preservados');
  });

  test('6. Remoção de botões de WhatsApp em colunas específicas (Pronto/Saiu para Entrega, Entregues Hoje, Pedidos Concluídos, Devolvidos, Cancelados)', () => {
    const { context, toasts } = createAdminVm();

    const testOrderTemplate = {
      id: 'ord_ui_test',
      orderNo: '998877',
      customer: { name: 'João Silva', phone: '16999990000' },
      delivery: { type: 'delivery', street: 'Rua das Flores', number: '123', bairro: 'Centro', km: 1.5 },
      items: [{ name: 'Açaí 300 ml', quantity: 1, unitPrice: 15.90, accompaniments: [], extras: [] }],
      payment: { method: 'Pix', status: 'approved' },
      total: 15.90,
      createdAt: new Date().toISOString()
    };

    // Helper para checar presença de botões de WhatsApp
    const hasWpp = (html) => html.includes('💬 Zap') || html.includes('💬 Avisar no Zap') || html.includes('Avisar no WhatsApp');

    // 1. Coluna Pronto / Saiu para Entrega
    const readyDeliveryCard = context.createOrderCardHtml({ ...testOrderTemplate, status: 'out_for_delivery' });
    assert.equal(hasWpp(readyDeliveryCard), false, 'Pronto / Saiu para Entrega NÃO deve ter botões de WhatsApp');

    // 2. Coluna Entregues Hoje
    const deliveredCard = context.createOrderCardHtml({ ...testOrderTemplate, status: 'delivered' });
    assert.equal(hasWpp(deliveredCard), false, 'Entregues Hoje NÃO deve ter botões de WhatsApp');

    // 3. Coluna Pedidos Concluídos (Histórico)
    const historyCard = context.createOrderCardHtml({ ...testOrderTemplate, status: 'delivered', archivedToHistory: true }, true);
    assert.equal(hasWpp(historyCard), false, 'Pedidos Concluídos NÃO deve ter botões de WhatsApp');
    assert.equal(historyCard.includes('wa.me/55'), false, 'Pedidos Concluídos NÃO deve conter link direto de WhatsApp no cliente');

    // 4. Coluna Devolvidos à Loja
    const returnedCard = context.createOrderCardHtml({ ...testOrderTemplate, status: 'returned' });
    assert.equal(hasWpp(returnedCard), false, 'Devolvidos à Loja NÃO deve ter botões de WhatsApp');

    // 5. Coluna Cancelados
    const cancelledCard = context.createOrderCardHtml({ ...testOrderTemplate, status: 'cancelled' });
    assert.equal(hasWpp(cancelledCard), false, 'Cancelados NÃO deve ter botões de WhatsApp');

    // 6. Colunas permitidas (Novos Pedidos e Em Preparo)
    const receivedCard = context.createOrderCardHtml({ ...testOrderTemplate, status: 'received' });
    assert.ok(hasWpp(receivedCard), 'Novos Pedidos DEVE ter botão de WhatsApp');

    const preparingCard = context.createOrderCardHtml({ ...testOrderTemplate, status: 'preparing' });
    assert.ok(hasWpp(preparingCard), 'Em Preparo DEVE ter botão de WhatsApp');

    // 7. Testar promptWppStatusNotice:
    context.promptWppStatusNotice({ ...testOrderTemplate, status: 'cancelled' });
    context.promptWppStatusNotice({ ...testOrderTemplate, status: 'ready' });
    context.promptWppStatusNotice({ ...testOrderTemplate, status: 'out_for_delivery' });
    context.promptWppStatusNotice({ ...testOrderTemplate, status: 'returned' });
    context.promptWppStatusNotice({ ...testOrderTemplate, status: 'delivered' });
    assert.equal(toasts.length, 0, 'promptWppStatusNotice NÃO deve exibir toast para cancelados, pronto/entrega, devolvidos ou entregues');

    context.promptWppStatusNotice({ ...testOrderTemplate, status: 'received' });
    assert.equal(toasts.length, 1, 'promptWppStatusNotice DEVE exibir para recebidos');
  });

  test('7 e 8: Cancelamento em Pronto/Saiu para Entrega (Retirada vs Entrega)', () => {
    const { context } = createAdminVm();
    context.toggleOrderCardExpand('ord_retirada');
    context.toggleOrderCardExpand('ord_entrega');

    // Pedido para RETIRADA NO BALCÃO na etapa Pronto/Saiu para Entrega
    const pickupOrder = {
      id: 'ord_retirada',
      orderNo: '111111',
      customer: { name: 'Maria Balcão', phone: '16999991111' },
      delivery: { type: 'pickup' },
      items: [{ name: 'Açaí 500 ml', quantity: 1, unitPrice: 19.90, accompaniments: [], extras: [] }],
      payment: { method: 'Dinheiro', timing: 'delivery' },
      total: 19.90,
      status: 'ready'
    };

    const pickupCardHtml = context.createOrderCardHtml(pickupOrder);
    assert.ok(pickupCardHtml.includes("openCancelOrderModal('ord_retirada'"), 'Pedido de RETIRADA no balcão DEVE ter opção de cancelar na etapa Pronto');

    // Pedido de ENTREGA (Delivery) na etapa Pronto/Saiu para Entrega
    const deliveryOrder = {
      id: 'ord_entrega',
      orderNo: '222222',
      customer: { name: 'Carlos Entrega', phone: '16999992222' },
      delivery: { type: 'delivery', street: 'Av Brasil', number: '10' },
      items: [{ name: 'Açaí 500 ml', quantity: 1, unitPrice: 19.90, accompaniments: [], extras: [] }],
      payment: { method: 'Dinheiro', timing: 'delivery' },
      total: 19.90,
      status: 'out_for_delivery'
    };

    const deliveryCardHtml = context.createOrderCardHtml(deliveryOrder);
    assert.equal(deliveryCardHtml.includes("openCancelOrderModal('ord_entrega'"), false, 'Pedido de ENTREGA NÃO deve ter opção de cancelar na etapa Saiu para Entrega');
  });

  test('9: Remoção de "Reimprimir na Cozinha" na coluna Devolvidos à Loja', () => {
    const { context } = createAdminVm();
    context.toggleOrderCardExpand('ord_dev');

    const returnedOrder = {
      id: 'ord_dev',
      orderNo: '333333',
      customer: { name: 'Lucas Devolvido', phone: '16999993333' },
      delivery: { type: 'delivery' },
      items: [{ name: 'Açaí 700 ml', quantity: 1, unitPrice: 24.90, accompaniments: [], extras: [] }],
      payment: { method: 'Pix', status: 'approved' },
      total: 24.90,
      status: 'returned',
      returnReason: 'Não atendeu interfone'
    };

    const returnedCardHtml = context.createOrderCardHtml(returnedOrder);
    assert.equal(returnedCardHtml.includes('Imprimir Cozinha'), false, 'Não deve exibir Imprimir Cozinha');
    assert.equal(returnedCardHtml.includes('kitchen'), false, 'Não deve permitir impressão para cozinha na coluna Devolvidos');
    assert.ok(returnedCardHtml.includes('Reimprimir Comanda') || returnedCardHtml.includes('Reimprimir'), 'Deve permitir reimpressão da comanda balcão');
    assert.ok(returnedCardHtml.includes('Reenviar p/ Cozinha'), 'Deve preservar opção de reenviar p/ cozinha');
  });

  test('10: Botão "Finalizar Compra" na tela do cliente (public/js/app.js)', () => {
    const appJsCode = fs.readFileSync(path.resolve('public/js/app.js'), 'utf-8');

    assert.equal(appJsCode.includes('Continuar para Entrega'), false, 'Não deve mais existir o texto "Continuar para Entrega"');
    assert.ok(appJsCode.includes('Finalizar Compra'), 'Deve existir o botão "Finalizar Compra"');
    assert.ok(appJsCode.includes('onclick="openCheckoutModal()">Finalizar Compra</button>'), 'Deve manter a chamada openCheckoutModal()');
  });

  test('Estrutura HTML do Kanban: Colunas "Entregues Hoje" e "Pedidos Concluídos"', () => {
    const adminHtml = fs.readFileSync(path.resolve('public/admin.html'), 'utf-8');

    assert.ok(adminHtml.includes('id="col-header-delivered">Entregues Hoje</span>'), 'Deve conter coluna Entregues Hoje');
    assert.ok(adminHtml.includes('id="col-header-history">Pedidos Concluídos</span>'), 'Deve conter coluna Pedidos Concluídos');
    assert.ok(adminHtml.includes('id="cards-delivered"'), 'Deve conter container cards-delivered');
    assert.ok(adminHtml.includes('id="cards-history"'), 'Deve conter container cards-history');
    assert.ok(adminHtml.includes('<option value="delivered">Entregues Hoje</option>'), 'Filtro deve ter Entregues Hoje');
    assert.ok(adminHtml.includes('<option value="history">Pedidos Concluídos</option>'), 'Filtro deve ter Pedidos Concluídos');
  });
});
