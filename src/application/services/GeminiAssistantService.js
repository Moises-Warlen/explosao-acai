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
    this.history = new Map(); // Memória de curto prazo por telefone: Map<phone, Array<{role, text}>>
    this.stats = {
      profanityBlocked: 0,
      menuRequests: 0,
      aiGenerations: 0
    };
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
   * Salva mensagem no histórico de conversa (mantém até 6 turnos para contextualização)
   */
  saveHistory(phone, role, text) {
    if (!phone) return;
    const clean = phone.replace(/\D/g, '');
    const list = this.history.get(clean) || [];
    list.push({ role, text: String(text).slice(0, 500), timestamp: Date.now() });
    if (list.length > 6) {
      list.splice(0, list.length - 6);
    }
    this.history.set(clean, list);
  }

  getHistory(phone) {
    if (!phone) return [];
    const clean = phone.replace(/\D/g, '');
    return this.history.get(clean) || [];
  }

  clearHistory(phone) {
    if (!phone) return;
    const clean = phone.replace(/\D/g, '');
    this.history.delete(clean);
  }

  /**
   * Filtro de Palavrões, Ofensas e Conteúdo Explícito
   */
  checkProfanityAndExplicit(text) {
    if (!text || typeof text !== 'string') return false;
    
    // Expressões regulares com variações fonéticas e abreviações comuns
    const profanityPatterns = [
      /\b(p+o+r+r+a+|c+a+r+a+l+h+o+|m+e+r+d+a+|p+u+t+a+|p+u+t+o+)\b/i,
      /\b(f+i+l+h+o+\s*d+a+\s*p+u+t+a+|f+d+p+|p+q+p+)\b/i,
      /\b(v+a+g+a+b+u+n+d+[ao]|v+i+a+d+o+|a+r+r+o+m+b+a+d+[ao])\b/i,
      /\b(c+u+|b+u+c+e+t+a+|b+o+c+e+t+a+|c+u+z+a+o+|c+u+z+[aã]o)\b/i,
      /\b(f+o+d+a+\-?s+e+|v+s+f+|v+a+i+\s*s+e+\s*f+o+d+e+r+|t+o+m+a+\s*n+o+\s*c+u+)\b/i,
      /\b(d+e+s+g+r+a+c+[ao]|d+e+s+g+r+a+[çc]+a+d+[ao]|o+t+[aá]+r+i+[ao]|c+o+r+n+o+)\b/i,
      /\b(n+u+d+e+s?|s+e+x+o+\s*a+g+o+r+a+|p+i+r+o+c+a+|p+a+u+\s*z+[aã]o)\b/i
    ];

    return profanityPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Verifica se o comando é para voltar ao Menu Principal
   */
  isMenuCommand(text) {
    if (!text) return false;
    const clean = text.toLowerCase().trim().replace(/[!.,?]/g, '');
    const menuCommands = ['menu', 'voltar', 'inicio', 'início', 'comeco', 'começo', '0', 'ajuda', 'opcoes', 'opções', 'oi menu', 'ver menu'];
    return menuCommands.includes(clean);
  }

  /**
   * Renderiza a resposta formatada do Menu Principal
   */
  renderMainMenu(ctx, customerName, isReactivated = false) {
    this.stats.menuRequests++;
    const nameStr = customerName ? ` ${customerName}` : '';
    const reactivationNotice = isReactivated ? '🔄 *Atendimento automático do bot reativado!*\n\n' : '';

    return `${reactivationNotice}🍇 *Menu Principal — Explosão Açaí* 🍇
${ctx.isOpen ? '🟢 *Loja Aberta e Entregando!*' : '🔴 *Loja Fechada no Momento* (' + ctx.openingHours + ')'}

Olá${nameStr}! Como posso te ajudar hoje?

📱 *1️⃣ Cardápio Digital Completo:*
👉 ${ctx.publicUrl}
_(Monte seu açaí, escolha acompanhamentos e pague no Pix ou Cartão)_

🛵 *2️⃣ Rastrear meu Pedido*
🍧 *3️⃣ Combos & Promoções da Semana*
📍 *4️⃣ Horário de Funcionamento & Endereço*
👤 *5️⃣ Falar com um Atendente Humano*

💡 _Dica: Digite *menu* ou *0* a qualquer momento para voltar aqui!_`;
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
  async processMessage({ phone = '', customerName = '', text = '', wasInHumanTakeover = false }) {
    const cleanText = (text || '').trim();
    const ctx = this.buildLiveContext(phone);

    // 1. FILTRO DE PALAVRÕES, OFENSAS E CONTEÚDO IMPRÓPRIO
    if (this.checkProfanityAndExplicit(cleanText)) {
      this.stats.profanityBlocked++;
      const reply = `Olá${customerName ? ` ${customerName}` : ''}! 🍇 Prezamos por um atendimento respeitoso e harmonioso para todos os nossos clientes e atendentes.\n\nPedimos gentilmente que evite o uso de termos ofensivos. Como posso te ajudar com o cardápio ou seu pedido hoje?\n\n💡 _Dica: Digite *menu* para ver as opções._`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        isProfanity: true
      };
    }

    // 2. COMANDO DE VOLTAR AO MENU PRINCIPAL
    if (this.isMenuCommand(cleanText)) {
      const reply = this.renderMainMenu(ctx, customerName, wasInHumanTakeover);
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        resetHumanTakeover: wasInHumanTakeover
      };
    }

    // 3. DETECÇÃO DE PEDIDO EXPLÍCITO DE ATENDENTE HUMANO
    const humanKeywords = ['atendente', 'humano', 'falar com pessoa', 'gerente', 'falar com alguem', 'pessoa real', '5'];
    if (humanKeywords.some(k => cleanText.toLowerCase() === k || cleanText.toLowerCase().includes(k))) {
      const reply = `Entendido${customerName ? `, ${customerName}` : ''}! 👤 Estou transferindo você para um de nossos atendentes humanos agora mesmo. Por favor, aguarde só um momento que já vamos te responder por aqui!\n\n💡 _Se quiser voltar ao atendimento automático, basta digitar *menu*._`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: true
      };
    }

    // 4. ATENDIMENTO AVANÇADO COM GOOGLE GEMINI 2.0 FLASH (COM MEMÓRIA CONVERSACIONAL)
    if (this.client && this.apiKey) {
      try {
        const systemInstruction = `
Você é a atendente virtual oficial e consultora de açaí da "Explosão Açaí", delivery em Franca - SP.
Seu objetivo é encantar o cliente, tirar dúvidas com simpatia, sugerir produtos (venda ativa / upsell) e orientar no pedido.

INFORMAÇÕES REAIS DO ESTABELECIMENTO EM TEMPO REAL:
- Loja: ${ctx.storeName}
- Status: ${ctx.isOpen ? 'ABERTA AGORA! 🟢 Recebendo pedidos.' : 'FECHADA NO MOMENTO 🔴'}
- Horário: ${ctx.openingHours}
- Endereço: ${ctx.address}
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
1. Seja acolhedora, rápida, use emojis típicos de açaí (🍇, 🍧, 🍫, 🛵, ✨) com moderação.
2. Seja concisa: responda em poucas linhas, sem parágrafos gigantes, ideal para leitura rápida no WhatsApp.
3. Se perguntarem sobre lactose/vegano: o açaí puro não contém lactose nem glúten. Sugira montar com frutas, paçoca e granola tradicional sem leite.
4. Se perguntarem sobre status de entrega: informe o status exato e o entregador com base no STATUS DE PEDIDO acima.
5. Sempre que fizer sentido, envie o link do Cardápio Digital (${ctx.publicUrl}) para o cliente finalizar.
6. Sempre inclua ao final de forma sutil: "💡 _Digite *menu* para ver as opções._"
7. Se o cliente demonstrar insatisfação grave (pedido errado, derretido, atraso excessivo), peça desculpas sinceras, diga que acionou o gerente e finalize com o código: [ACTION:CALL_HUMAN].
        `.trim();

        // Constrói histórico de mensagens anteriores para manter a continuidade
        const historyList = this.getHistory(phone);
        const contents = [
          ...historyList.map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.text }]
          })),
          {
            role: 'user',
            parts: [{ text: `Cliente (${customerName || 'Cliente'}, Tel: ${phone}): ${cleanText}` }]
          }
        ];

        this.stats.aiGenerations++;
        const response = await this.client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents,
          config: {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            temperature: 0.7,
            maxOutputTokens: 600
          }
        });

        const replyText = response.text || '';
        const needsHuman = replyText.includes('[ACTION:CALL_HUMAN]');
        const cleanReply = replyText.replace(/\[ACTION:CALL_HUMAN\]/g, '').trim();

        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', cleanReply);

        return {
          reply: cleanReply,
          needsHumanTakeover: needsHuman
        };
      } catch (err) {
        console.warn('[Gemini] Falha na chamada da IA, alternando para motor inteligente local:', err.message);
      }
    }

    // 5. MOTOR INTELIGENTE LOCAL (CONTINGÊNCIA SEM CUSTO DE API)
    const result = this.fallbackSmartRuleEngine(cleanText, ctx, customerName);
    this.saveHistory(phone, 'user', cleanText);
    this.saveHistory(phone, 'assistant', result.reply);
    return result;
  }

  /**
   * Motor inteligente local de contingência
   */
  fallbackSmartRuleEngine(text, ctx, customerName) {
    const t = text.toLowerCase();
    const nameStr = customerName ? ` ${customerName}` : '';

    // Opção 1 ou Rastreio de Pedido
    if (t === '1' || t.includes('pedido') || t.includes('rastrear') || t.includes('onde ta') || t.includes('cade') || t.includes('cadê') || t.includes('demorando')) {
      return {
        reply: `🛵 *Status do seu Pedido:*\n\n${ctx.orderStatusText}\n\n📱 Acompanhe o pedido ou monte um novo copo:\n👉 ${ctx.publicUrl}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 2 ou Produtos / Preços
    if (t === '2' || t.includes('preco') || t.includes('preço') || t.includes('quanto custa') || t.includes('sabores')) {
      return {
        reply: `🍧 *Destaques do nosso Cardápio:*\n\n${ctx.productsSummary.split('\n').slice(0, 4).join('\n')}\n\n📱 *Confira todos os tamanhos, adicionais e combos no cardápio digital:*\n👉 ${ctx.publicUrl}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 3 ou Promoções / Cupons
    if (t === '3' || t.includes('promo') || t.includes('combo') || t.includes('desconto') || t.includes('cupom')) {
      return {
        reply: `🎉 *Promoções & Cupons Ativos:*\n\n🎟️ *Cupons Disponíveis:* ${ctx.couponList}\n\n💥 Temos combos especiais para casal e família com descontos imperdíveis!\n👉 Acesse: ${ctx.publicUrl}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 4 ou Horários / Endereço
    if (t === '4' || t.includes('horario') || t.includes('horário') || t.includes('onde fica') || t.includes('endereco') || t.includes('endereço')) {
      return {
        reply: `📍 *Nossa Localização & Horários:*\n\n🏠 *Endereço:* ${ctx.address}\n🕒 *Horário:* ${ctx.openingHours}\n\n📱 Peça online pelo delivery: ${ctx.publicUrl}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Reclamação ou problema
    if (t.includes('errado') || t.includes('derretido') || t.includes('faltou') || t.includes('reclamar') || t.includes('ruim') || t.includes('cancelar')) {
      return {
        reply: `Sinto muito pelo ocorrido${nameStr}! Peço sinceras desculpas pelo transtorno. 😔 Nós levamos a qualidade do seu açaí muito a sério. Já notifiquei a gerência e o responsável da loja no painel e alguém da nossa equipe vai assumir este chat agora mesmo para te ajudar!`,
        needsHumanTakeover: true
      };
    }

    // Resposta padrão simpática
    return {
      reply: `Oi${nameStr}! 🍇 Como posso te ajudar hoje?\n\n📱 *Para ver o cardápio e fazer seu pedido, acesse:* \n👉 ${ctx.publicUrl}\n\n💡 _Digite *menu* para ver todas as opções disponíveis!_`,
      needsHumanTakeover: false
    };
  }

  /**
   * Gera texto promocional semanal persuasivo com IA para disparo aos clientes
   */
  async generateWeeklyPromotionText({ productName = '', discount = '', couponCode = '' } = {}) {
    const ctx = this.buildLiveContext();
    const publicUrl = ctx.publicUrl;

    if (this.client && this.apiKey) {
      try {
        const prompt = `
Crie uma mensagem promocional curta, divertida e altamente persuasiva para envio no WhatsApp da "Explosão Açaí".
Detalhes da oferta:
- Produto em Destaque: ${productName || 'Nossos Combos e Copos Especiais'}
- Cupom / Desconto: ${couponCode ? `Cupom ${couponCode}` : (discount || 'Desconto exclusivo')}
- Link da loja: ${publicUrl}

Regras:
1. Comece com uma saudação calorosa e um gancho irresistível sobre o calor ou vontade de açaí.
2. Use emojis típicos (🍇, 🍧, 💥, 🛵).
3. Mantenha no máximo 5 a 6 linhas para caber perfeitamente na tela do celular.
4. Inclua chamada para ação com o link.
5. Termine com nota legal: "(Caso não queira mais receber nossas ofertas, digite 'sair')".
        `.trim();

        const response = await this.client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { temperature: 0.8, maxOutputTokens: 350 }
        });

        return response.text || '';
      } catch (e) {}
    }

    // Fallback padrão se Gemini não estiver configurado
    const itemStr = productName ? `o delicioso *${productName}*` : 'nossos melhores copos e combos';
    const couponStr = couponCode ? `Use o cupom *${couponCode}* e aproveite!` : 'Aproveite nossa promoção especial!';

    return `Oi! 🍇 Passando para adoçar sua semana com a *Explosão Açaí*! 💥\n\nQue tal se refrescar hoje com ${itemStr}? ${couponStr} 🍧\n\n🛵 Peça agora com entrega rápida:\n👉 ${publicUrl}\n\n_(Caso não queira mais receber novidades da loja, basta responder 'sair')_`;
  }
}

export const geminiAssistantService = new GeminiAssistantService();
