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

  test('10. GeminiAssistantService: Filtro de palavrões e ofensas explícitas bloqueia e responde educadamente', async () => {
    // 1. Testa detecção direta
    assert.strictEqual(geminiAssistantService.checkProfanityAndExplicit('porra de açaí'), true);
    assert.strictEqual(geminiAssistantService.checkProfanityAndExplicit('vai se foder'), true);
    assert.strictEqual(geminiAssistantService.checkProfanityAndExplicit('bom dia quero comprar'), false);

    // 2. Testa processamento da mensagem com ofensa
    const res = await geminiAssistantService.processMessage({
      phone: '16999990005',
      customerName: 'Cliente Bravo',
      text: 'seu açaí é uma merda caralho'
    });

    assert.ok(res.reply);
    assert.strictEqual(res.isProfanity, true);
    assert.strictEqual(res.needsHumanTakeover, false);
    assert.ok(res.reply.includes('respeitoso') || res.reply.includes('ofensivos'), 'Deve pedir respeito de forma cortês');
    assert.ok(!res.reply.toLowerCase().includes('merda') && !res.reply.toLowerCase().includes('caralho'), 'Nunca deve repetir ofensas');
  });

  test('11. GeminiAssistantService: Comando de voltar ao menu principal reativa o bot e lista opções', async () => {
    // 1. Testa detecção do comando
    assert.strictEqual(geminiAssistantService.isMenuCommand('menu'), true);
    assert.strictEqual(geminiAssistantService.isMenuCommand('0'), true);
    assert.strictEqual(geminiAssistantService.isMenuCommand('voltar'), true);
    assert.strictEqual(geminiAssistantService.isMenuCommand('início'), true);

    // 2. Processa com retorno ao menu após estar em transbordo humano
    const res = await geminiAssistantService.processMessage({
      phone: '16999990006',
      customerName: 'Larissa',
      text: 'menu',
      wasInHumanTakeover: true
    });

    assert.ok(res.reply);
    assert.ok(res.reply.includes('Cardápio Digital Completo'));
    assert.ok(res.reply.includes('reativado'), 'Deve avisar que o bot foi reativado');
    assert.strictEqual(res.needsHumanTakeover, false);
    assert.strictEqual(res.resetHumanTakeover, true);
  });

  test('12. GeminiAssistantService & WhatsAppBot: Geração de texto promocional semanal com opt-out LGPD', async () => {
    const promoText = await geminiAssistantService.generateWeeklyPromotionText({
      productName: 'Copo Especial 500ml',
      couponCode: 'SEXTOU10'
    });

    assert.ok(promoText);
    assert.ok(promoText.includes('Explosão Açaí'));
    assert.ok(promoText.toLowerCase().includes('sair'), 'Deve conter orientação de descadastro (LGPD)');

    // Testa gestão de opt-out no serviço do WhatsApp
    whatsAppBotService.optOutPhones.add('16999990007');
    assert.strictEqual(whatsAppBotService.optOutPhones.has('16999990007'), true);
    whatsAppBotService.optOutPhones.delete('16999990007');
  });

  test('13. Rotas da API: Endpoints de Campanha Semanal (/info, /preview, /settings)', async () => {
    // 1. Info da Campanha
    const infoRes = await fetch(`${baseUrl}/api/bot/campaign/info`, {
      headers: { 'x-admin-token': TEST_ADMIN_PASSWORD }
    });
    assert.strictEqual(infoRes.status, 200);
    const infoData = await infoRes.json();
    assert.strictEqual(infoData.ok, true);
    assert.ok(typeof infoData.eligibleCount === 'number');
    assert.ok(typeof infoData.optOutCount === 'number');
    assert.ok(infoData.settings);

    // 2. Preview de Texto Promocional com IA
    const prevRes = await fetch(`${baseUrl}/api/bot/campaign/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': TEST_ADMIN_PASSWORD
      },
      body: JSON.stringify({ productName: 'Combo Casal', couponCode: 'AMORDEACAI' })
    });
    assert.strictEqual(prevRes.status, 200);
    const prevData = await prevRes.json();
    assert.strictEqual(prevData.ok, true);
    assert.ok(prevData.message.length > 20);

    // 3. Atualizar configurações de agendamento da campanha
    const setRes = await fetch(`${baseUrl}/api/bot/campaign/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': TEST_ADMIN_PASSWORD
      },
      body: JSON.stringify({
        enabled: true,
        scheduledDay: 5,
        scheduledHour: 18,
        customMessage: 'Oferta especial de sexta!'
      })
    });
    assert.strictEqual(setRes.status, 200);
    const setData = await setRes.json();
    assert.strictEqual(setData.ok, true);
    assert.strictEqual(setData.settings.enabled, true);
    assert.strictEqual(setData.settings.scheduledHour, 18);
  });

  test('14. Loja Fechada: Envia mensagem calorosa e acolhedora e tira dúvidas normalmente', async () => {
    // 1. Renderização do Menu com loja fechada
    const ctxFechado = {
      isOpen: false,
      openingHours: '13h às 23h',
      publicUrl: 'http://localhost:3000'
    };
    const menuFechado = geminiAssistantService.renderMainMenu(ctxFechado, 'Mariana');
    assert.ok(menuFechado.includes('descansando'), 'Deve avisar com carinho que a cozinha está descansando');
    assert.ok(menuFechado.includes('13h às 23h'), 'Deve informar horário');
    assert.ok(menuFechado.includes('fique super à vontade'), 'Deve convidar a tirar dúvidas');

    // 2. Tira dúvidas mesmo com a loja fechada
    const res = await geminiAssistantService.processMessage({
      phone: '16999990008',
      customerName: 'Mariana',
      text: 'O açaí de vocês tem leite ou lactose?'
    });

    assert.ok(res.reply);
    assert.ok(res.reply.includes('100% Puro') || res.reply.includes('lactose'), 'Deve responder sobre lactose');
    assert.strictEqual(res.needsHumanTakeover, false);
  });

  test('15. Ouvidoria: Registra sugestão e reclamação com anonimização LGPD', async () => {
    // 1. Envio de Sugestão
    const resSugestao = await geminiAssistantService.processMessage({
      phone: '16999990009',
      customerName: 'Gustavo',
      text: 'Minha sugestão é que vocês coloquem calda de maracujá no cardápio, parabéns pelo açaí!'
    });

    assert.ok(resSugestao.reply.includes('sugestão') || resSugestao.reply.includes('carinho'));
    assert.strictEqual(resSugestao.needsHumanTakeover, false);

    // 2. Consulta API de Ouvidoria
    const feedRes = await fetch(`${baseUrl}/api/bot/feedbacks`, {
      headers: { 'x-admin-token': TEST_ADMIN_PASSWORD }
    });
    assert.strictEqual(feedRes.status, 200);
    const feedData = await feedRes.json();
    assert.strictEqual(feedData.ok, true);
    assert.ok(Array.isArray(feedData.feedbacks));
    const saved = feedData.feedbacks.find(f => f.customerName === 'Gustavo');
    assert.ok(saved);
    assert.strictEqual(saved.type, 'sugestao');
    assert.ok(saved.phone.includes('****'), 'Telefone do cliente deve ser anonimizado na ouvidoria conforme LGPD');
  });

  test('16. Transbordo Seguro: Quando não souber responder, transfere para atendente humano', async () => {
    const res = await geminiAssistantService.processMessage({
      phone: '16999990010',
      customerName: 'Renato',
      text: 'Vocês fazem parceria para fornecer açaí para um congresso de 500 pessoas no sábado?'
    });

    assert.ok(res.reply);
    assert.ok(res.reply.includes('específica') || res.reply.includes('atendente'), 'Deve avisar que é específica e transferir');
    assert.strictEqual(res.needsHumanTakeover, true, 'Deve acionar atendente humano');
  });

  test('17. Base de Conhecimento Dinâmica: Aprende novas perguntas e respostas', async () => {
    // 1. Cadastra novo conhecimento via API
    const addRes = await fetch(`${baseUrl}/api/bot/knowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': TEST_ADMIN_PASSWORD
      },
      body: JSON.stringify({
        question: 'Vocês têm copo de 1 Litro?',
        answer: 'Sim! Temos a marmita térmica e o copo de 1 Litro para a família toda com até 6 acompanhamentos!',
        keywords: ['1 litro', '1l', 'litro', 'família']
      })
    });
    assert.strictEqual(addRes.status, 200);
    const addData = await addRes.json();
    assert.strictEqual(addData.ok, true);

    // 2. O bot responde usando a resposta aprendida!
    const res = await geminiAssistantService.processMessage({
      phone: '16999990011',
      customerName: 'Lucas',
      text: 'Vocês têm copo de 1 litro?'
    });

    assert.ok(res.reply);
    assert.ok(res.reply.includes('1 Litro') || res.reply.includes('marmita'));
    assert.strictEqual(res.needsHumanTakeover, false);
  });

  test('18. Direito ao Esquecimento (Art. 18 LGPD) e Flag da Logo Oficial', async () => {
    // 1. Direito ao esquecimento apaga dados de conversa
    const resForget = await geminiAssistantService.processMessage({
      phone: '16999990012',
      customerName: 'Bruna',
      text: 'quero apagar meus dados esquecer'
    });
    assert.ok(resForget.reply.includes('Privacidade & LGPD'));
    assert.strictEqual(resForget.isForget, true);

    // 2. Comando Menu sinaliza envio da Logo
    const resMenu = await geminiAssistantService.processMessage({
      phone: '16999990013',
      customerName: 'Bruno',
      text: 'menu'
    });
    assert.strictEqual(resMenu.sendWithLogo, true, 'Menu deve enviar a logo da loja');
  });

});
