import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { securityAuditService, SecurityEventType, SecuritySeverity } from '../src/infrastructure/security/SecurityAuditService.js';
import { storeService } from '../src/application/services/StoreService.js';
import { orderService } from '../src/application/services/OrderService.js';
import { createAdminToken } from '../src/presentation/middlewares/authMiddleware.js';

describe('Auditoria de Segurança & Seletor de Motoboys com Auto-Cadastro', () => {

  test('1. SecurityAuditService: Registra eventos de segurança e gera sumário', () => {
    securityAuditService.clearLogs();

    const ev1 = securityAuditService.recordEvent({
      type: SecurityEventType.RATE_LIMIT_EXCEEDED,
      severity: SecuritySeverity.CRITICAL,
      ip: '192.168.1.100',
      endpoint: '/api/admin/auth',
      method: 'POST',
      details: 'Bloqueio de força bruta: 5 tentativas inválidas.'
    });

    assert.ok(ev1.id);
    assert.equal(ev1.type, SecurityEventType.RATE_LIMIT_EXCEEDED);
    assert.equal(ev1.severity, SecuritySeverity.CRITICAL);

    const ev2 = securityAuditService.recordEvent({
      type: SecurityEventType.AUTH_FAILURE,
      severity: SecuritySeverity.HIGH,
      ip: '192.168.1.101',
      endpoint: '/api/admin/auth',
      method: 'POST',
      details: 'Senha administrativa incorreta.'
    });

    const ev3 = securityAuditService.recordEvent({
      type: SecurityEventType.PROFANITY_OFFENSE,
      severity: SecuritySeverity.MEDIUM,
      ip: 'WhatsApp-Client',
      endpoint: '/bot/webhook',
      details: 'Linguagem ofensiva barrada.'
    });

    const logsResult = securityAuditService.getLogs({ limit: 10 });
    assert.equal(logsResult.total, 3);
    assert.equal(logsResult.summary.critical, 1);
    assert.equal(logsResult.summary.high, 1);
    assert.equal(logsResult.summary.medium, 1);

    // Filtro por severidade
    const criticalLogs = securityAuditService.getLogs({ severity: 'critical' });
    assert.equal(criticalLogs.logs.length, 1);
    assert.equal(criticalLogs.logs[0].type, SecurityEventType.RATE_LIMIT_EXCEEDED);
  });

  test('2. StoreService: Gestão e Auto-Cadastro de Motoboys', () => {
    const initialList = storeService.getMotoboys();
    assert.ok(Array.isArray(initialList));
    assert.ok(initialList.length >= 1);

    // Adiciona motoboy novo
    const uniqueName = `Marcos_Diarista_${Date.now()}`;
    const updated = storeService.addMotoboy(uniqueName);
    assert.ok(updated.includes(uniqueName));

    // Não duplica se adicionar novamente
    const noDupes = storeService.addMotoboy(uniqueName);
    const count = noDupes.filter(m => m === uniqueName).length;
    assert.equal(count, 1);

    // Remove motoboy
    const removed = storeService.removeMotoboy(uniqueName);
    assert.ok(!removed.includes(uniqueName));
  });

  test('3. OrderService: Atribuição de Motoboy faz Auto-Cadastro no StoreService', async () => {
    const motoboyFreelancer = `Freelancer_AutoCad_${Date.now()}`;

    // Cria um pedido em dinheiro para teste
    const order = await orderService.createOrder({
      customer: { name: 'Cliente Teste Motoboy', phone: '16999998888' },
      delivery: { type: 'delivery', street: 'Rua Teste', number: '100', bairro: 'Centro', city: 'Franca' },
      payment: { method: 'Dinheiro', changeFor: 50 },
      items: [{ productId: 'prod_monte', name: 'Monte seu açaí', price: 15.90, quantity: 1, selectedSize: 300 }]
    });

    assert.ok(order.id);

    // Despacha com motoboy novo via updateOrderStatus
    orderService.updateOrderStatus(order.id, 'preparing');
    const dispatched = orderService.updateOrderStatus(order.id, 'out_for_delivery', null, motoboyFreelancer);

    assert.equal(dispatched.delivery?.motoboyName, motoboyFreelancer);

    // O motoboy deve estar na lista de motoboys da loja
    const storeMotoboys = storeService.getMotoboys();
    assert.ok(storeMotoboys.includes(motoboyFreelancer));

    // Limpa do cadastro
    storeService.removeMotoboy(motoboyFreelancer);
  });

  test('4. SecurityAuditService: Limpeza segura de histórico', () => {
    securityAuditService.clearLogs();
    const res = securityAuditService.getLogs();
    assert.equal(res.total, 0);
    assert.equal(res.logs.length, 0);
  });
});
