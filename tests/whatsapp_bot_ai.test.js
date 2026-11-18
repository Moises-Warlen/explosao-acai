process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { server } from '../src/server.js';
import { geminiAssistantService } from '../src/application/services/GeminiAssistantService.js';
import { whatsAppBotService } from '../src/infrastructure/notifications/WhatsAppBotService.js';

process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'senha-teste-automatizado';
const TEST_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

describe('Explosão Açaí — Testes do Bot WhatsApp & Inteligência Artificial', () => {
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

  test('1. GeminiAssistantService: Constrói contexto em tempo real a partir do catálogo e banco', () => {
    const ctx = geminiAssistantService.buildLiveContext('16991098863');
    assert.ok(ctx.storeName, 'Deve conter o nome da loja');
    assert.ok(typeof ctx.isOpen === 'boolean', 'Deve conter status aberto/fechado');
    assert.ok(ctx.productsSummary.includes('Clássico') || ctx.productsSummary.includes('Doce Tentação'), 'Deve listar produtos do catálogo');
    assert.ok(ctx.acompList.length > 0, 'Deve conter acompanhamentos');
    assert.ok(ctx.publicUrl, 'Deve conter a URL do cardápio digital');
  });

  test('2. GeminiAssistantService: Responde a saudações com o link do cardápio e opções', async () => {
    const res = await geminiAssistantService.processMessage({
      phone: '16999990001',
      customerName: 'Roberto',
      text: 'Olá, boa noite! Quero pedir açaí'
    });

    assert.ok(res.reply, 'Deve conter resposta');
    assert.ok(res.reply.includes('Roberto') || res.reply.includes('Explosão Açaí'), 'Deve saudar o cliente');
    assert.ok(res.reply.includes('http') || res.reply.includes('cardápio'), 'Deve fornecer o link do cardápio digital');
    assert.strictEqual(res.needsHumanTakeover, false, 'Não deve solicitar transbordo humano em saudação');
  });

  test('3. GeminiAssistantService: Responde a rastreamento de pedido', async () => {
    const res = await geminiAssistantService.processMessage({
      phone: '16999990002',
      customerName: 'Fernanda',
      text: 'Cadê meu pedido? Quero rastrear'
    });

    assert.ok(res.reply, 'Deve conter resposta');
    assert.ok(res.reply.includes('Status') || res.reply.includes('Entrega') || res.reply.includes('Pedido'), 'Deve responder sobre a entrega');
    assert.strictEqual(res.needsHumanTakeover, false);
  });

  test('4. GeminiAssistantService: Detecta solicitação de atendente humano', async () => {
    const res = await geminiAssistantService.processMessage({
      phone: '16999990003',
      customerName: 'Camila',
      text: 'Quero falar com um atendente humano por favor'
    });

    assert.ok(res.reply, 'Deve conter resposta');
    assert.strictEqual(res.needsHumanTakeover, true, 'Deve marcar para transbordo humano');
    assert.ok(res.reply.includes('atendente') || res.reply.includes('aguarde'), 'Deve confirmar que transferiu para humano');
  });

  test('5. GeminiAssistantService: Detecta reclamação grave e aciona o suporte', async () => {
    const res = await geminiAssistantService.processMessage({
      phone: '16999990004',
      customerName: 'Lucas',
      text: 'O açaí veio todo derretido e errado, que absurdo!'
    });

    assert.ok(res.reply);
    assert.strictEqual(res.needsHumanTakeover, true, 'Deve acionar suporte em reclamações');
    assert.ok(res.reply.toLowerCase().includes('desculpa') || res.reply.toLowerCase().includes('responsável'));
  });

  test('6. WhatsAppBotService: Gerencia estado, alternância de IA e liberação de transbordo', () => {
    const initial = whatsAppBotService.getStatus();
    assert.ok(initial);
    assert.ok(typeof initial.connected === 'boolean');
    assert.ok(typeof initial.aiEnabled === 'boolean');

    // Alterna IA
    const prev = whatsAppBotService.aiEnabled;
    const toggled = whatsAppBotService.toggleAI();
    assert.strictEqual(toggled, !prev);
    whatsAppBotService.toggleAI(prev); // restaura

    // Simula transbordo e liberação
    whatsAppBotService.humanTakeoverPhones.add('16999998877');
    assert.ok(whatsAppBotService.humanTakeoverPhones.has('16999998877'));
    whatsAppBotService.releaseHumanTakeover('(16) 99999-8877');
    assert.strictEqual(whatsAppBotService.humanTakeoverPhones.has('16999998877'), false);
  });

  test('7. Rotas da API: GET /api/bot/status protegido por token de Admin', async () => {
    // 1. Sem token -> 401
    const unauth = await fetch(`${baseUrl}/api/bot/status`);
    assert.strictEqual(unauth.status, 401);

    // 2. Com token correto -> 200
    const auth = await fetch(`${baseUrl}/api/bot/status`, {
      headers: { 'x-admin-token': TEST_ADMIN_PASSWORD }
    });
    assert.strictEqual(auth.status, 200);
    const data = await auth.json();
    assert.strictEqual(data.ok, true);
    assert.ok('connected' in data);
    assert.ok('aiEnabled' in data);
    assert.ok(data.stats);
  });

  test('8. Rotas da API: POST /api/bot/toggle-ai altera modo da IA', async () => {
    const res = await fetch(`${baseUrl}/api/bot/toggle-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': TEST_ADMIN_PASSWORD
      },
      body: JSON.stringify({ enabled: false })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.aiEnabled, false);

    // Restaura para true
    await fetch(`${baseUrl}/api/bot/toggle-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': TEST_ADMIN_PASSWORD
      },
      body: JSON.stringify({ enabled: true })
    });
  });

  test('9. Rotas da API: POST /api/bot/set-gemini-key atualiza a chave com segurança', async () => {
    const res = await fetch(`${baseUrl}/api/bot/set-gemini-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': TEST_ADMIN_PASSWORD
      },
      body: JSON.stringify({ apiKey: 'teste_gemini_key_12345' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.hasGeminiKey, true);

    // Limpa chave de teste
    geminiAssistantService.setApiKey('');
  });

});
