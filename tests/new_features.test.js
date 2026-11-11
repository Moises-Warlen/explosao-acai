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

  test('Isolamento Estrito de Chat: Um cliente NUNCA pode ver a conversa de outro cliente', async () => {
    const phoneClientA = '16988880001';
    const phoneClientB = '16988880002';

    // 1. Cliente A envia mensagem
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'customer',
        customerPhone: phoneClientA,
        customerName: 'Cliente A',
        message: 'Mensagem confidencial do Cliente A'
      })
    });

    // 2. Cliente B envia mensagem
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'customer',
        customerPhone: phoneClientB,
        customerName: 'Cliente B',
        message: 'Mensagem confidencial do Cliente B'
      })
    });

    // 3. Consulta mensagens do Cliente A
    const resA = await fetch(`${baseUrl}/api/chat?phone=${phoneClientA}`);
    const dataA = await resA.json();
    assert.ok(dataA.messages.some(m => m.message.includes('Cliente A')));
    assert.ok(!dataA.messages.some(m => m.message.includes('Cliente B')), 'Cliente A NUNCA deve ver mensagem do Cliente B');

    // 4. Consulta mensagens do Cliente B
    const resB = await fetch(`${baseUrl}/api/chat?phone=${phoneClientB}`);
    const dataB = await resB.json();
    assert.ok(dataB.messages.some(m => m.message.includes('Cliente B')));
    assert.ok(!dataB.messages.some(m => m.message.includes('Cliente A')), 'Cliente B NUNCA deve ver mensagem do Cliente A');

    // 5. Consulta sem identificador público: deve retornar array vazio, sem vazar nada
    const resEmpty = await fetch(`${baseUrl}/api/chat`);
    const dataEmpty = await resEmpty.json();
    assert.strictEqual(dataEmpty.messages.length, 0, 'Consulta sem telefone deve retornar array vazio');
  });

  test('Fluxo de Entrega do Motoboy: POST /api/orders/:id/confirm-delivery marca como entregue e pago', async () => {
    // 1. Cria pedido com pagamento na entrega (dinheiro)
    const orderPayload = {
      customer: { name: 'Lucas Motoboy Test', phone: '16999995544' },
      delivery: {
        type: 'delivery',
        street: 'Rua do Entregador',
        number: '100',
        bairro: 'Centro',
        km: 3.5
      },
      payment: {
        method: 'Dinheiro',
        timing: 'delivery',
        trocoValue: 10.0
      },
      items: [
        {
          productId: 'p1',
          name: 'Copo Tradicional 300ml',
          size: 300,
          quantity: 1,
          unitPrice: 24.90,
          totalPrice: 24.90
        }
      ]
    };

    const createRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });
    const createData = await createRes.json();
    assert.strictEqual(createRes.status, 201);
    const orderId = createData.order.id;

    // 2. Confirma entrega e recebimento pelo motoboy
    const confirmRes = await fetch(`${baseUrl}/api/orders/${orderId}/confirm-delivery`, {
      method: 'POST'
    });
    const confirmData = await confirmRes.json();
    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmData.ok, true);
    assert.strictEqual(confirmData.order.status, 'delivered', 'Status deve mudar para delivered');
    assert.strictEqual(confirmData.order.payment.status, 'approved', 'Pagamento deve mudar para approved');
    assert.ok(confirmData.order.deliveredAt, 'Deve registrar data e hora da entrega');
  });

  test('Gerenciamento de Chat: PUT /api/chat/customer-name e POST /api/chat/close', async () => {
    const testPhone = '16977771234';

    // 1. Envia mensagem do cliente
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'customer',
        customerPhone: testPhone,
        customerName: 'Cliente Inicial',
        message: 'Dúvida sobre o açaí'
      })
    });

    // 2. Altera o nome do cliente no chat
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer RafaeLL@2'
    };

    const renameRes = await fetch(`${baseUrl}/api/chat/customer-name`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        customerPhone: testPhone,
        newName: 'Carlos Silva VIP'
      })
    });
    const renameData = await renameRes.json();
    assert.strictEqual(renameRes.status, 200);
    assert.strictEqual(renameData.ok, true);

    // 3. Finaliza o chat
    const closeRes = await fetch(`${baseUrl}/api/chat/close`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ customerPhone: testPhone })
    });
    const closeData = await closeRes.json();
    assert.strictEqual(closeRes.status, 200);
    assert.strictEqual(closeData.ok, true);

    // 4. Verifica histórico de mensagens
    const getRes = await fetch(`${baseUrl}/api/chat?phone=${testPhone}`);
    const getData = await getRes.json();
    assert.ok(getData.messages.some(m => m.customerName === 'Carlos Silva VIP'), 'Mensagens devem refletir o novo nome');
    assert.ok(getData.messages.some(m => m.isSystemClose === true), 'Deve conter a mensagem de encerramento amigável');

    // 5. Verifica se a conversa foi removida da lista ativa do painel admin
    const listRes = await fetch(`${baseUrl}/api/chat/conversations`, { headers: authHeaders });
    const listData = await listRes.json();
    assert.ok(!listData.conversations.some(c => c.customerPhone === testPhone), 'Conversa finalizada DEVE ser removida das conversas ativas');

    // 6. Se o cliente enviar uma nova mensagem após ser finalizado, histórico antigo deve ser limpo e chat recomeçar limpo
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'customer',
        customerPhone: testPhone,
        customerName: 'Carlos Silva VIP',
        message: 'Olá, gostaria de fazer outro pedido!'
      })
    });

    const getResClean = await fetch(`${baseUrl}/api/chat?phone=${testPhone}`);
    const getDataClean = await getResClean.json();
    assert.strictEqual(getDataClean.messages.length, 1, 'Novo chat deve conter APENAS a nova mensagem sem histórico antigo');
    assert.strictEqual(getDataClean.messages[0].message, 'Olá, gostaria de fazer outro pedido!');
  });

  test('Fluxo de Pedidos Devolvidos: POST /api/orders/:id/return e Relatório de Vendas', async () => {
    // 1. Cria pedido para entrega
    const orderPayload = {
      customer: { name: 'Mariana Devolução Test', phone: '16988884433' },
      delivery: {
        type: 'delivery',
        street: 'Rua Deserta',
        number: '99',
        bairro: 'Jardim Primavera',
        km: 4.0
      },
      payment: {
        method: 'Dinheiro',
        timing: 'delivery',
        trocoValue: 0
      },
      items: [
        {
          productId: 'p1',
          name: 'Copo Tradicional 500ml',
          size: 500,
          quantity: 2,
          unitPrice: 29.90,
          totalPrice: 59.80
        }
      ]
    };

    const createRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });
    const createData = await createRes.json();
    assert.strictEqual(createRes.status, 201);
    const orderId = createData.order.id;

    // 2. Devolve o pedido informando motivo
    const returnReason = 'Cliente não atendeu o interfone nem telefone';
    const returnRes = await fetch(`${baseUrl}/api/orders/${orderId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: returnReason })
    });
    const returnData = await returnRes.json();
    assert.strictEqual(returnRes.status, 200);
    assert.strictEqual(returnData.ok, true);
    assert.strictEqual(returnData.order.status, 'returned', 'Status do pedido deve ser returned');
    assert.strictEqual(returnData.order.returnReason, returnReason, 'Deve gravar o motivo da devolução');
    assert.ok(returnData.order.returnedAt, 'Deve registrar data/hora da devolução');

    // 3. Consulta relatório de vendas e verifica contadores de devolvidos
    const authHeaders = {
      'Authorization': 'Bearer RafaeLL@2'
    };
    const repRes = await fetch(`${baseUrl}/api/reports/sales?period=today`, { headers: authHeaders });
    const repData = await repRes.json();
    assert.strictEqual(repRes.status, 200);
    assert.ok(repData.report.summary.returnedOrdersCount >= 1, 'Deve registrar ao menos 1 pedido devolvido no sumário');
    assert.ok(repData.report.summary.returnedTotal >= 59.80, 'Deve contabilizar o valor devolvido no sumário');

    const returnedOrderInReport = repData.report.orders.find(o => o.id === orderId);
    assert.ok(returnedOrderInReport, 'Pedido devolvido deve constar na listagem detalhada do relatório');
    assert.strictEqual(returnedOrderInReport.isReturned, true);
    assert.strictEqual(returnedOrderInReport.returnReason, returnReason);
  });

  test('Resposta Automática no Chat quando a Loja estiver Fechada', async () => {
    const authHeaders = {
      'Authorization': 'Bearer RafaeLL@2',
      'Content-Type': 'application/json'
    };

    // 1. Força a loja a ficar FECHADA
    const toggleCloseRes = await fetch(`${baseUrl}/api/store/toggle-status`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ forceStatus: false })
    });
    const toggleCloseData = await toggleCloseRes.json();
    assert.strictEqual(toggleCloseData.isOpen, false, 'Loja deve estar fechada para o teste');

    // 2. Garante que resposta automática está ativada nas configurações
    await fetch(`${baseUrl}/api/store/settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        autoReplyClosedEnabled: true,
        autoReplyClosedMessage: 'Olá! A loja está fechada agora. Responderemos em breve.'
      })
    });

    const testPhone = '16999998877';
    // 3. Cliente envia mensagem no chat
    const sendRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'customer',
        customerPhone: testPhone,
        customerName: 'Cliente Noturno',
        message: 'Olá, ainda estão aceitando pedidos hoje?'
      })
    });
    const sendData = await sendRes.json();
    assert.strictEqual(sendRes.status, 201);
    assert.strictEqual(sendData.ok, true);

    // 4. Consulta a conversa do cliente para verificar se recebeu a auto-resposta
    const chatRes = await fetch(`${baseUrl}/api/chat?phone=${testPhone}`);
    const chatData = await chatRes.json();
    assert.strictEqual(chatData.ok, true);
    assert.ok(chatData.messages.length >= 2, 'Deve conter a mensagem do cliente e a auto-resposta');

    const autoReplyMsg = chatData.messages.find(m => m.isAutoReply === true);
    assert.ok(autoReplyMsg, 'Deve existir uma mensagem com isAutoReply: true');
    assert.strictEqual(autoReplyMsg.sender, 'admin');
    assert.ok(autoReplyMsg.message.includes('fechada'), 'A mensagem deve indicar que a loja está fechada');

    // 5. Reabre a loja ao final do teste
    await fetch(`${baseUrl}/api/store/toggle-status`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ forceStatus: true })
    });
  });
});
