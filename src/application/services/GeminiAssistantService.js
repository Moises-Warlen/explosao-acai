import { GoogleGenAI } from '@google/genai';
import { catalogService } from './CatalogService.js';
import { orderService } from './OrderService.js';
import { storeService } from './StoreService.js';
import { couponService } from './CouponService.js';
import { freightService } from './FreightService.js';

class GeminiAssistantService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.client = null;
    this.initClient();
  }

  initClient() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    if (this.apiKey) {
      try {
        this.client = new GoogleGenAI({ apiKey: this.apiKey });
      } catch (err) {
        console.error('[Gemini] Erro ao inicializar SDK GenAI:', err.message);
        this.client = null;
      }
    }
  }

  setApiKey(key) {
    this.apiKey = (key || '').trim();
    process.env.GEMINI_API_KEY = this.apiKey;
    this.initClient();
  }

  /**
   * Constrói o contexto dinâmico do sistema em tempo real a partir do banco
   */
  buildLiveContext(customerPhone) {
    const catalog = typeof catalogService.getCatalog === 'function' ? catalogService.getCatalog() : {};
    const storeOpenInfo = typeof storeService.isStoreOpen === 'function' ? storeService.isStoreOpen() : { isOpen: true };
    const storeSettings = typeof storeService.getSettings === 'function' ? storeService.getSettings() : {};
    const coupons = (typeof couponService.getCoupons === 'function' ? couponService.getCoupons() : (couponService.getAll ? couponService.getAll() : [])).filter(c => c.active);
    
    // Busca pedidos recentes do cliente pelo telefone para rastreamento instantâneo
    let recentOrders = [];
    if (customerPhone) {
      try {
        const cleanPhone = customerPhone.replace(/\D/g, '');
        recentOrders = (orderService.getOrders() || [])
          .filter(o => o.customer?.phone && o.customer.phone.replace(/\D/g, '').endsWith(cleanPhone.slice(-8)))
          .slice(-3);
      } catch (e) {}
    }

    const products = (catalog.products || []).filter(p => p.active);
    const accompaniments = (catalog.accompaniments || []).filter(a => a.active);
    const extras = (catalog.extras || []).filter(e => e.active);
    const fruits = (catalog.fruits || []).filter(f => f.active);

    const productsSummary = products.map(p => {
      const prices = (p.prices || []).map(pr => `${pr.size}ml: R$ ${pr.price.toFixed(2)}`).join(' | ');
      return `• ${p.name} (${prices}) - ${p.description || ''}`;
    }).join('\n');

    const acompList = accompaniments.map(a => a.name).join(', ');
    const extrasList = extras.map(e => `${e.name} (+R$ ${(e.price || 0).toFixed(2)})`).join(', ');
    const fruitsList = fruits.map(f => `${f.name} (+R$ ${(f.price || 0).toFixed(2)})`).join(', ');
    const couponList = coupons.map(c => `${c.code} (${c.type === 'percentage' ? c.value + '%' : 'R$ ' + c.value} off, pedido mín: R$ ${c.minOrderValue || 0})`).join(', ');

    let orderStatusText = 'Nenhum pedido recente encontrado para este número.';
    if (recentOrders.length > 0) {
      const latest = recentOrders[recentOrders.length - 1];
      const motoboyInfo = latest.delivery?.motoboyName ? ` pelo motoboy ${latest.delivery.motoboyName}` : '';
      orderStatusText = `Último Pedido #${latest.orderNo} (${latest.createdAt}): Status atual é "${latest.status}"${motoboyInfo}. Total: R$ ${Number(latest.total || 0).toFixed(2)}.`;
    }

    const publicUrl = process.env.BASE_URL || 'http://localhost:3000';

    return {
      storeName: storeSettings.storeName || 'Explosão Açaí',
      isOpen: Boolean(storeOpenInfo.isOpen),
      openingHours: storeSettings.openingHours || 'Terça a Domingo das 13h às 23h',
      address: storeSettings.address || 'Rua Renato Lourenço Fernandes Rosa, 1721 - Franca, SP',
      phone: storeSettings.phone || '16991098863',
      publicUrl,
      productsSummary,
      acompList,
      extrasList,
      fruitsList,
      couponList: couponList || 'Nenhum cupom ativo no momento',
      orderStatusText
    };
  }

  /**
   * Processa a mensagem do cliente via Gemini IA ou fallback inteligente
   */
  async processMessage({ phone = '', customerName = '', text = '' }) {
    const ctx = this.buildLiveContext(phone);
    const cleanText = (text || '').trim();

    // 1. Detecção imediata de pedido de atendente humano
    const humanKeywords = ['atendente', 'humano', 'falar com pessoa', 'gerente', 'falar com alguem', 'pessoa real'];
    if (humanKeywords.some(k => cleanText.toLowerCase().includes(k))) {
      return {
        reply: `Entendido, ${customerName ? customerName : 'amigo(a)'}! 👤 Estou transferindo você para um de nossos atendentes humanos agora mesmo. Por favor, aguarde só um momento que já vamos te responder!`,
        needsHumanTakeover: true
      };
    }

    // 2. Se a chave do Gemini estiver configurada, usa a IA
    if (this.client && this.apiKey) {
      try {
        const systemInstruction = `
Você é a atendente virtual oficial e especialista da "Explosão Açaí", delivery de açaí artesanal em Franca - SP.
Seu objetivo é encantar o cliente, tirar dúvidas com simpatia, vender ativamente e facilitar o pedido.

INFORMAÇÕES REAIS DO ESTABELECIMENTO EM TEMPO REAL:
- Loja: ${ctx.storeName}
- Status da Loja: ${ctx.isOpen ? 'ABERTA AGORA! 🟢 Aceitando pedidos.' : 'FECHADA NO MOMENTO 🔴'}
- Horário de Atendimento: ${ctx.openingHours}
- Endereço da Loja: ${ctx.address}
- Link do Cardápio Digital Oficial: ${ctx.publicUrl}
- Cupons Ativos: ${ctx.couponList}

CARDÁPIO E PREÇOS REAIS:
${ctx.productsSummary}

ACOMPANHAMENTOS (já inclusos):
${ctx.acompList}

EXTRAS / COBERTURAS ESPECIAIS:
${ctx.extrasList}

FRUTAS FRESCAS:
${ctx.fruitsList}

STATUS DE PEDIDO DO CLIENTE ATUAL (${phone}):
${ctx.orderStatusText}

REGRAS DE CONDUTA E ESTILO:
1. Seja acolhedora, animada, use emojis típicos de açaí (🍇, 🍧, 🍫, 🛵, ✨) com bom senso.
2. Seja concisa: as pessoas no WhatsApp preferem mensagens diretas, fáceis de ler no celular, sem blocos gigantes de texto.
3. Se perguntarem sobre lactose/vegano: o açaí puro não contém lactose nem glúten. Sugira montar com frutas, paçoca e granola tradicional sem leite.
4. Se perguntarem sobre pedido ou entrega: use as informações de STATUS DE PEDIDO fornecidas acima.
5. Sempre que fizer sentido, envie o link do Cardápio Digital (${ctx.publicUrl}) para que o cliente possa montar o copo com facilidade.
6. Se o cliente demonstrar insatisfação grave (pedido errado, derretido, atraso excessivo) ou pedir explicitamente para falar com uma pessoa, peça desculpas sinceras, diga que chamou o responsável e termine a mensagem com o código: [ACTION:CALL_HUMAN].
        `.trim();

        const response = await this.client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [
            {
              role: 'user',
              parts: [{ text: `Cliente (${customerName || 'Cliente'}, Tel: ${phone}): ${cleanText}` }]
            }
          ],
          config: {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            temperature: 0.7,
            maxOutputTokens: 600
          }
        });

        const replyText = response.text || '';
        const needsHuman = replyText.includes('[ACTION:CALL_HUMAN]');
        const cleanReply = replyText.replace(/\[ACTION:CALL_HUMAN\]/g, '').trim();

        return {
          reply: cleanReply,
          needsHumanTakeover: needsHuman
        };
      } catch (err) {
        console.warn('[Gemini] Falha na chamada da IA, alternando para motor inteligente local:', err.message);
      }
    }

    // 3. Fallback Inteligente Local (Regras estruturadas sem custo de API)
    return this.fallbackSmartRuleEngine(cleanText, ctx, customerName);
  }

  /**
   * Motor inteligente de contingência (quando a chave de IA não está preenchida ou há instabilidade de rede)
   */
  fallbackSmartRuleEngine(text, ctx, customerName) {
    const t = text.toLowerCase();
    const nameStr = customerName ? ` ${customerName}` : '';

    // Saudação / Cardápio
    if (t.includes('oi') || t.includes('ola') || t.includes('olá') || t.includes('boa noite') || t.includes('boa tarde') || t.includes('cardapio') || t.includes('cardápio') || t.includes('menu')) {
      return {
        reply: `Olá${nameStr}! 🍇 Bem-vindo(a) à *${ctx.storeName}*!\n\n${ctx.isOpen ? '🟢 *Estamos abertos e aceitando pedidos!*' : '🔴 *No momento estamos fechados.* ' + ctx.openingHours}\n\n📱 *Acesse nosso cardápio completo e monte seu copo:* \n👉 ${ctx.publicUrl}\n\nSe preferir, posso te ajudar com:\n1️⃣ Rastrear meu pedido\n2️⃣ Horários e endereço\n3️⃣ Ver promoções e combos\n4️⃣ Falar com um atendente`,
        needsHumanTakeover: false
      };
    }

    // Rastreio de Pedido
    if (t.includes('pedido') || t.includes('rastrear') || t.includes('onde ta') || t.includes('cade') || t.includes('cadê') || t.includes('demorando') || t === '1') {
      return {
        reply: `🛵 *Status da sua Entrega:*\n\n${ctx.orderStatusText}\n\nQualquer dúvida adicional ou alteração urgente, basta me avisar que chamo a gerência! ✨`,
        needsHumanTakeover: false
      };
    }

    // Horários / Endereço
    if (t.includes('horario') || t.includes('horário') || t.includes('onde fica') || t.includes('endereco') || t.includes('endereço') || t === '2') {
      return {
        reply: `📍 *Nossa Localização & Horários:*\n\n🏠 *Endereço:* ${ctx.address}\n🕒 *Horário:* ${ctx.openingHours}\n\n📱 Peça direto pelo delivery: ${ctx.publicUrl}`,
        needsHumanTakeover: false
      };
    }

    // Promoções e Combos
    if (t.includes('promo') || t.includes('combo') || t.includes('desconto') || t.includes('cupom') || t === '3') {
      return {
        reply: `🎉 *Promoções & Cupons Ativos:*\n\n🎟️ *Cupons Disponíveis:* ${ctx.couponList}\n\n💥 Temos combos especiais com preços promocionais para casal e família!\n👉 Confira todos no cardápio digital: ${ctx.publicUrl}`,
        needsHumanTakeover: false
      };
    }

    // Reclamação ou problema
    if (t.includes('errado') || t.includes('derretido') || t.includes('faltou') || t.includes('reclamar') || t.includes('ruim') || t.includes('cancelar')) {
      return {
        reply: `Sinto muito pelo ocorrido${nameStr}! 😔 Nós levamos a qualidade muito a sério. Já notifiquei o responsável no painel da loja e alguém vai assumir este chat agora mesmo para resolver isso para você!`,
        needsHumanTakeover: true
      };
    }

    // Resposta padrão amigável direcionando ao cardápio
    return {
      reply: `Oi${nameStr}! 🍇 Para fazer seu pedido e escolher seus acompanhamentos e coberturas favoritas, acesse nosso cardápio online:\n👉 ${ctx.publicUrl}\n\nSe precisar de ajuda com um pedido em andamento ou quiser falar com um atendente humano, é só me responder aqui!`,
      needsHumanTakeover: false
    };
  }
}

export const geminiAssistantService = new GeminiAssistantService();
