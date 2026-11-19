import { GoogleGenAI } from '@google/genai';
import { catalogService } from './CatalogService.js';
import { orderService } from './OrderService.js';
import { storeService } from './StoreService.js';
import { couponService } from './CouponService.js';
import { freightService } from './FreightService.js';
import { db } from '../../infrastructure/database/JsonDatabase.js';
import { securityAuditService, SecurityEventType, SecuritySeverity } from '../../infrastructure/security/SecurityAuditService.js';
import { wsHub } from '../../infrastructure/websockets/WebSocketHub.js';

class GeminiAssistantService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.client = null;
    this.history = new Map(); // Memória de curto prazo por telefone: Map<phone, Array<{role, text}>>
    this.pendingFeedbackSessions = new Map(); // Sessão ativa de Ouvidoria: Map<cleanPhone, {timestamp, customerName}>
    this.lastInteraction = new Map(); // Timestamp da última interação: Map<cleanPhone, number>
    this.profanityCount = new Map(); // Contagem de ofensas consecutivas: Map<cleanPhone, number>
    this.stats = {
      profanityBlocked: 0,
      menuRequests: 0,
      aiGenerations: 0,
      humanTransfers: 0
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
    this.profanityCount.delete(clean);
  }

  /**
   * Memória das últimas conversas e histórico relevante do cliente (Contexto Inteligente)
   */
  getClientMemory(phone) {
    if (!phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    try {
      const allOrders = orderService.getOrders() || [];
      const customerOrders = allOrders.filter(o => {
        const p = o.customer?.phone ? String(o.customer.phone).replace(/\D/g, '') : '';
        return p && p.endsWith(cleanPhone.slice(-8));
      });

      const latestOrder = customerOrders.length > 0 ? customerOrders[customerOrders.length - 1] : null;

      // Preferência de pagamento
      let paymentPref = null;
      if (latestOrder?.payment?.method) {
        paymentPref = latestOrder.payment.method;
        if (latestOrder.payment.changeFor) {
          paymentPref += ` (troco para R$ ${latestOrder.payment.changeFor})`;
        }
      }

      // Itens favoritos
      const itemCounts = {};
      for (const ord of customerOrders) {
        for (const it of (ord.items || [])) {
          if (it.name) itemCounts[it.name] = (itemCounts[it.name] || 0) + (it.quantity || 1);
        }
      }
      const favoriteItems = Object.entries(itemCounts).sort((a,b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);

      // Endereço de entrega
      let deliveryAddress = null;
      if (latestOrder?.delivery && latestOrder.delivery.type === 'delivery') {
        const d = latestOrder.delivery;
        deliveryAddress = [d.street, d.number, d.bairro, d.city].filter(Boolean).join(', ');
      }

      // Último feedback ou pendência na Ouvidoria
      const feedbacks = db.get()?.feedbacks || [];
      const lastFeedback = feedbacks.find(f => f.rawPhone === cleanPhone || (f.phone && f.phone.endsWith(cleanPhone.slice(-4))));

      return {
        customerName: latestOrder?.customer?.name || null,
        latestOrder,
        favoriteItems,
        paymentPref,
        deliveryAddress,
        lastFeedback: lastFeedback ? { id: lastFeedback.id, type: lastFeedback.type, resolved: lastFeedback.resolved, message: lastFeedback.message } : null
      };
    } catch (e) {
      return null;
    }
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
    const menuCommands = ['menu', 'voltar', 'inicio', 'início', 'comeco', 'começo', '0', '0️⃣', 'ajuda', 'opcoes', 'opções', 'oi menu', 'ver menu'];
    return menuCommands.includes(clean);
  }

  /**
   * Consulta a base de aprendizado de perguntas e respostas (FAQ Dinâmica / IA)
   */
  findLearnedKnowledge(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const knowledgeList = db.get()?.botKnowledge || [];

    for (const item of knowledgeList) {
      const qClean = (item.question || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (clean.includes(qClean) || qClean.includes(clean)) {
        return item;
      }
      if (Array.isArray(item.keywords) && item.keywords.length > 0) {
        const matches = item.keywords.some(k => {
          const kNorm = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return clean.includes(kNorm);
        });
        if (matches) return item;
      }
    }
    return null;
  }

  /**
   * Salva sugestão ou reclamação do cliente na Ouvidoria (com proteção LGPD de dados pessoais)
   */
  saveFeedback({ phone = '', customerName = '', type = 'sugestao', message = '' }) {
    try {
      const data = db.get();
      if (!Array.isArray(data.feedbacks)) data.feedbacks = [];
      const cleanPhone = (phone || '').replace(/\D/g, '');
      const masked = cleanPhone.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) 9****-$3');

      const entry = {
        id: 'fb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: type === 'reclamacao' ? 'reclamacao' : 'sugestao',
        customerName: customerName || 'Cliente',
        phone: masked,
        rawPhone: cleanPhone,
        message: String(message).slice(0, 800),
        createdAt: new Date().toISOString(),
        resolved: false
      };

      data.feedbacks.unshift(entry);
      db.save();

      // Dispara notificação em tempo real via WebSocket para o painel admin
      try {
        if (wsHub && typeof wsHub.broadcast === 'function') {
          wsHub.broadcast({ type: 'NEW_FEEDBACK', payload: entry });
        }
      } catch (wsErr) {}

      return entry;
    } catch (e) {
      console.warn('[Gemini] Erro ao registrar feedback:', e.message);
      return null;
    }
  }

  /**
   * Classificador fonético para mensagens de reclamação
   */
  isComplaintText(text) {
    if (!text || typeof text !== 'string') return false;
    const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const complaintPatterns = [
      /\b(reclamac|reclamar|queixa)\w*/i,
      /\b(pessim|ruim|horrivel|detest|odei|odiei)\w*/i,
      /\b(errad|derret|estragad|azed|gelad|quente|frio|sujo|podre|cabelo|inseto|bicho)\w*/i,
      /\b(faltou|falta|nao veio|veio sem|esqueceram|cobrou errado)\w*/i,
      /\b(atras|demor|demora|espera demais|cancelar|prejuizo|absurdo|engan)\w*/i,
      /\b(mal educad|grosso|grosseiro|estupido|nao gostei)\w*/i,
      /\b(nao recebi|nao entregou|sumiu|devolva|estorno|estornar)\w*/i
    ];
    return complaintPatterns.some(p => p.test(norm));
  }

  /**
   * Classificador fonético para sugestões e elogios
   */
  isSuggestionText(text) {
    if (!text || typeof text !== 'string') return false;
    const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const suggestionPatterns = [
      /\b(sugir|sugesta|sugestao|ideia|poderia|seria|gostaria|queria)\w*/i,
      /\b(elogio|paraben|adorei|muito bom|otimo|excelente|sensacional|maravilh)\w*/i,
      /\b(coloqu|adicion|vendam|melhor|novidad|mais opca|opcoes|opcao)\w*/i,
      /\b(parabens|gostei|top|show|perfeito)\b/i
    ];
    return suggestionPatterns.some(p => p.test(norm));
  }

  /**
   * Renderiza a resposta formatada do Menu Principal (Texto Exato e 8 Opções)
   */
  renderMainMenu(ctx, customerName, isReactivated = false) {
    this.stats.menuRequests++;
    const nameStr = customerName ? customerName : (ctx?.clientMemory?.customerName || 'Cliente');
    const reactivationNotice = isReactivated ? 'Atendimento automático do bot reativado!\n\n' : '';
    const statusLine = ctx.isOpen ? '😊 Status: Loja Aberta e Entregando' : '😴 Status: Loja Fechada no momento';

    return `${reactivationNotice}Atendimento automático Explosão Açaí! 🍧

📋 Menu Principal Explosão Açaí
${statusLine}

Olá ${nameStr}! Como posso te ajudar hoje? escolha uma opção.

1️⃣ - Para Conhecer nosso cardapio digital Cardápio Digital Completo:
2️⃣ - Rastrear meu Pedido.
3️⃣ - Combos & Promoções da Semana.
4️⃣ - Horário de Funcionamento e Endereço.
5️⃣ - Falar com um Atendente.
6️⃣ - Enviar Sugestão ou Reclamação (Ouvidoria)
7️⃣ - Forma de pagamento.
8️⃣ - Pedir Chave PIX.
9️⃣ - Encerrar atendimento.

0️⃣ Digite 0 a qualquer momento para voltar no menu!`;
  }

  /**
   * Retorna a lista detalhada de Combos, Promoções da Semana e Cupons Ativos
   */
  getCombosAndPromosText(ctx) {
    try {
      const catalog = typeof catalogService.getCatalog === 'function' ? catalogService.getCatalog() : {};
      const allProducts = (catalog.products || []).filter(p => p.active !== false);
      const combos = allProducts.filter(p => p.id?.startsWith('combo') || p.categoryId === 'cat_combos' || p.categorySlug === 'combos');
      const promos = allProducts.filter(p => p.isPromo && !combos.some(c => c.id === p.id));
      const coupons = (typeof couponService.getCoupons === 'function' ? couponService.getCoupons() : (couponService.getAll ? couponService.getAll() : [])).filter(c => c.active !== false);

      let text = `Confira nossos *Combos & Promoções da Semana* com descontos especiais:\n\n`;

      if (combos.length > 0) {
        text += `*Combos da Casa:*\n`;
        combos.forEach(c => {
          const prices = (c.prices || []);
          const minPrice = prices.reduce((min, p) => {
            const val = p.promoPrice || p.price;
            return val && val < min ? val : min;
          }, 9999);
          const priceStr = minPrice < 9999 ? ` - a partir de R$ ${minPrice.toFixed(2).replace('.', ',')}` : '';
          const promoTag = c.isPromo ? ' *(Em Promoção!)*' : '';
          text += `• *${c.name}*${promoTag}${priceStr}\n`;
          if (c.description) text += `  ${c.description}\n`;
        });
        text += `\n`;
      }

      if (promos.length > 0) {
        text += `*Produtos em Promoção:*\n`;
        promos.forEach(p => {
          const promoPrices = (p.prices || []).filter(pr => pr.promoPrice && pr.promoPrice < pr.price);
          const priceList = promoPrices.length > 0
            ? promoPrices.map(pr => `${pr.size}ml por R$ ${pr.promoPrice.toFixed(2).replace('.', ',')} (de R$ ${pr.price.toFixed(2).replace('.', ',')})`).join(' | ')
            : (p.prices || []).map(pr => `${pr.size}ml: R$ ${(pr.promoPrice || pr.price).toFixed(2).replace('.', ',')}`).join(' | ');
          text += `• *${p.name}*: ${priceList}\n`;
        });
        text += `\n`;
      }

      if (coupons.length > 0) {
        text += `*Cupons Ativos:*\n`;
        coupons.slice(0, 3).forEach(cp => {
          const disc = cp.type === 'percentage' || cp.type === 'percent' ? `${cp.value}% OFF` : `R$ ${Number(cp.value).toFixed(2).replace('.', ',')} OFF`;
          const min = cp.minOrder || cp.minOrderValue ? ` (em pedidos a partir de R$ ${Number(cp.minOrder || cp.minOrderValue).toFixed(2).replace('.', ',')})` : '';
          text += `• Cupom *${cp.code}*: ${disc}${min}\n`;
        });
        text += `\n`;
      }

      text += `Peça agora pelo nosso cardápio digital:\n👉 *https://cardapioexplosaoacai.com.br*\nAproveite antes que acabe!\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
      return text;
    } catch (e) {
      return `Confira nossos *Combos & Promoções da Semana* com descontos especiais direto na aba de promoções do nosso cardápio digital:\n👉 *https://cardapioexplosaoacai.com.br*\nAproveite antes que acabe!\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
    }
  }

  /**
   * Constrói o contexto dinâmico do sistema em tempo real a partir do banco
   */
  buildLiveContext(customerPhone) {
    const catalog = typeof catalogService.getCatalog === 'function' ? catalogService.getCatalog() : {};
    const storeOpenInfo = typeof storeService.isStoreOpen === 'function' ? storeService.isStoreOpen() : { isOpen: true };
    const storeSettings = typeof storeService.getSettings === 'function' ? storeService.getSettings() : {};
    const coupons = (typeof couponService.getCoupons === 'function' ? couponService.getCoupons() : (couponService.getAll ? couponService.getAll() : [])).filter(c => c.active);
    const clientMemory = this.getClientMemory(customerPhone);

    // Busca pedidos recentes do cliente pelo telefone para rastreamento instantâneo
    let recentOrders = [];
    let customerPrefGreeting = '';
    if (customerPhone) {
      try {
        const cleanPhone = customerPhone.replace(/\D/g, '');
        const allOrders = orderService.getOrders() || [];
        recentOrders = allOrders
          .filter(o => o.customer?.phone && o.customer.phone.replace(/\D/g, '').endsWith(cleanPhone.slice(-8)))
          .slice(-3);

        // Memória de consumo saudável (sem dados sensíveis, em total conformidade com a LGPD)
        if (recentOrders.length > 0) {
          const sizeCounts = {};
          for (const ord of recentOrders) {
            for (const it of (ord.items || [])) {
              if (it.size) sizeCounts[it.size] = (sizeCounts[it.size] || 0) + 1;
            }
          }
          const favoriteSize = Object.entries(sizeCounts).sort((a,b) => b[1] - a[1])[0]?.[0];
          if (favoriteSize) {
            customerPrefGreeting = `*Que bom ter você de volta!* Vai querer seu copo de *${favoriteSize}ml* de costume ou quer experimentar uma novidade hoje?`;
          }
        }
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

    const publicUrl = process.env.BASE_URL || 'https://cardapioexplosaoacai.com.br';

    // Resumo de perguntas frequentes aprendidas pela IA
    const knowledgeList = db.get()?.botKnowledge || [];
    const knowledgeSummary = knowledgeList.map(k => `• Pergunta: "${k.question}" => Resposta: "${k.answer}"`).join('\n');

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
      orderStatusText,
      knowledgeSummary,
      customerPrefGreeting,
      clientMemory
    };
  }

  /**
   * Processa a mensagem do cliente via Gemini IA ou fallback inteligente
   */
  async processMessage({ phone = '', customerName = '', text = '', wasInHumanTakeover = false }) {
    const cleanText = (text || '').trim();
    const t = cleanText.toLowerCase();
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const ctx = this.buildLiveContext(phone);
    const clientMemory = ctx.clientMemory || this.getClientMemory(cleanPhone);
    const effectiveName = customerName || clientMemory?.customerName || 'Cliente';

    // 0. REGRA DE INATIVIDADE (APÓS 20 MINUTOS)
    const lastTime = this.lastInteraction.get(cleanPhone);
    const now = Date.now();
    const isInactiveTimeout = Boolean(lastTime && (now - lastTime > 20 * 60 * 1000));
    this.lastInteraction.set(cleanPhone, now);

    if (isInactiveTimeout) {
      this.pendingFeedbackSessions.delete(cleanPhone);
      this.clearHistory(cleanPhone);
      const timeoutNotice = `Atendimento encerrado por *falta de interação* (mais de 20 minutos sem resposta) ⏳.\nPara iniciar um novo atendimento com a *Explosão Açaí*, escolha uma opção abaixo:\n\n`;
      const reply = timeoutNotice + this.renderMainMenu(ctx, effectiveName, wasInHumanTakeover);
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        resetHumanTakeover: wasInHumanTakeover,
        isTimeoutNotice: true
      };
    }

    // 0.1 DIREITO AO ESQUECIMENTO (LGPD - ART. 18)
    const forgetKeywords = ['esquecer', 'apagar dados', 'limpar dados', 'limpar historico', 'limpar histórico', 'esquecer meus dados', 'privacidade lgpd'];
    if (forgetKeywords.some(k => t === k || t.includes(k))) {
      this.clearHistory(phone);
      this.pendingFeedbackSessions.delete(cleanPhone);
      const reply = `*Privacidade & LGPD — Explosão Açaí*\n\nSeus dados de histórico e preferências temporárias de atendimento foram totalmente apagados da nossa memória em estrita conformidade com a LGPD!\n\nSeus direitos de privacidade são respeitados com total rigor. Quando quiser nos chamar novamente, estaremos à disposição.\n\n_Digite *0* para ver opções._`;
      return {
        reply,
        needsHumanTakeover: false,
        isForget: true
      };
    }

    // 1. REGRA DE NAVEGAÇÃO: VOLTAR AO MENU (DIGITE 0 OU MENU)
    if (this.isMenuCommand(cleanText)) {
      this.pendingFeedbackSessions.delete(cleanPhone);
      const reply = this.renderMainMenu(ctx, effectiveName, wasInHumanTakeover);
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        resetHumanTakeover: wasInHumanTakeover,
        sendWithLogo: true
      };
    }

    // 1.1 OPÇÃO 9: ENCERRAR ATENDIMENTO
    if (t === '9' || t === '9️⃣' || t === 'encerrar' || t === 'encerrar atendimento' || t === 'fim') {
      this.pendingFeedbackSessions.delete(cleanPhone);
      this.clearHistory(cleanPhone);
      const reply = `Atendimento encerrado! Agradecemos pelo contato com a *Explosão Açaí* 🍧💜.\nSempre que precisar, basta enviar um *Oi* por aqui para iniciar um novo atendimento!`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        isSessionEnded: true
      };
    }

    // 1.2 TRATAMENTO DE SESSÃO ATIVA DE OUVIDORIA (O cliente digitou 6 anteriormente)
    if (this.pendingFeedbackSessions.has(cleanPhone)) {
      const session = this.pendingFeedbackSessions.get(cleanPhone);
      const isExpired = session && session.timestamp && (Date.now() - session.timestamp > 15 * 60 * 1000);

      if (!isExpired) {
        this.pendingFeedbackSessions.delete(cleanPhone);

        // Cliente enviou áudio na Ouvidoria ("eu falei e nao gravou")
        if (cleanText === '[MENSAGEM_DE_AUDIO]') {
          const entry = this.saveFeedback({
            phone: cleanPhone,
            customerName: effectiveName,
            type: 'reclamacao',
            message: '[Áudio gravado pelo cliente no WhatsApp - Ouvidoria]'
          });
          const reply = `Recebi seu áudio na Ouvidoria${effectiveName ? ` ${effectiveName}` : ''}. Sua mensagem foi gravada com sucesso no sistema (Protocolo #${entry?.id || 'OK'}).\n\nEstou transferindo para nossa equipe humana ouvir sua gravação e te dar o retorno imediato. Por favor, aguarde só um momento.`;
          this.saveHistory(phone, 'user', cleanText);
          this.saveHistory(phone, 'assistant', reply);
          return {
            reply,
            needsHumanTakeover: true,
            isAudio: true,
            feedbackId: entry?.id
          };
        }

        // Cliente enviou texto na Ouvidoria
        const isComp = this.isComplaintText(cleanText);
        const type = isComp ? 'reclamacao' : 'sugestao';
        const entry = this.saveFeedback({
          phone: cleanPhone,
          customerName: effectiveName,
          type,
          message: cleanText
        });

        if (type === 'reclamacao') {
          const reply = `Sinto muito pelo ocorrido${effectiveName ? ` ${effectiveName}` : ''}. Registrei sua reclamação no sistema (Protocolo #${entry?.id || 'OK'}). A gerência foi notificada e nossa equipe humana vai assumir este atendimento agora mesmo para te ajudar.`;
          this.saveHistory(phone, 'user', cleanText);
          this.saveHistory(phone, 'assistant', reply);
          return {
            reply,
            needsHumanTakeover: true,
            feedbackId: entry?.id
          };
        } else {
          const reply = `Muito obrigado pelo seu carinho e pela sua sugestão${effectiveName ? ` ${effectiveName}` : ''}! Registrei sua mensagem no sistema com sucesso (Protocolo #${entry?.id || 'OK'}) e já encaminhei para a gerência.\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
          this.saveHistory(phone, 'user', cleanText);
          this.saveHistory(phone, 'assistant', reply);
          return {
            reply,
            needsHumanTakeover: false,
            feedbackId: entry?.id
          };
        }
      } else {
        this.pendingFeedbackSessions.delete(cleanPhone);
      }
    }

    // 1.3 TRATAMENTO DE ÁUDIO FORA DA OUVIDORIA
    if (cleanText === '[MENSAGEM_DE_AUDIO]') {
      const reply = `Oi! Como sou o assistente virtual da *Explosão Açaí*, ainda não consigo ouvir áudios por aqui. 🎧\n\nSe puder digitar o que precisa, eu já te ajudo agora mesmo! Mas se preferir falar com alguém da nossa equipe para ouvir seu áudio, digite *0* e escolha a opção de atendente no menu. 😊`;
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isAudio: true };
    }

    // 1.4 TRATAMENTO DE FOTO OU IMAGEM
    if (cleanText === '[MENSAGEM_DE_FOTO]' || cleanText === '[MENSAGEM_DE_IMAGEM]' || cleanText === '[MENSAGEM_DE_DOCUMENTO]') {
      const reply = `Recebi sua imagem! 📸 Como sou um assistente virtual, não consigo visualizar fotos por aqui.\n\nSe for o *comprovante do seu PIX* ou algo sobre um pedido, pode aguardar um pouquinho que nossa equipe já vai conferir! Se precisar de outra coisa, é só escrever por aqui ou digitar *0* para voltar ao menu. `;
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isMedia: true };
    }

    // 1.5 TRATAMENTO DE FIGURINHA
    if (cleanText === '[MENSAGEM_DE_FIGURINHA]') {
      const reply = `Recebi sua mensagem! Como posso te ajudar hoje? Digite *0* para ver nosso cardápio e opções!`;
      return { reply, needsHumanTakeover: false };
    }

    // 2. FILTRO DE PALAVRÕES, OFENSAS E CONTEÚDO IMPRÓPRIO (ESCALADA DE ATÉ 3 AVISOS CONSECUTIVOS)
    if (this.checkProfanityAndExplicit(cleanText)) {
      this.stats.profanityBlocked++;
      try {
        const maskedPhone = phone ? String(phone).replace(/(\d{4})\d+(\d{4})/, '$1****$2') : 'Desconhecido';
        securityAuditService.recordEvent({
          type: SecurityEventType.PROFANITY_OFFENSE,
          severity: SecuritySeverity.MEDIUM,
          ip: 'WhatsApp-Client',
          endpoint: '/bot/webhook',
          method: 'MESSAGE',
          details: `Linguagem inapropriada bloqueada do remetente ${maskedPhone}.`,
          userAgent: 'WhatsApp-Baileys'
        });
      } catch (e) {}

      const currentCount = (this.profanityCount.get(cleanPhone) || 0) + 1;
      this.profanityCount.set(cleanPhone, currentCount);

      let reply = '';
      let needsTakeover = false;

      if (currentCount === 1) {
        reply = `Poxa, quero muito te ajudar da melhor forma possível, mas preciso que a gente mantenha o respeito por aqui, combinado? 🤝\n\nSe houve algum problema com seu pedido ou se precisa resolver algo urgente, digite *0* para acessar o menu e depois a opção *6* para falar com a nossa equipe sobre sua sugestão ou reclamação.`;
      } else if (currentCount === 2) {
        reply = `Entendo que você possa estar chateado, mas não consigo continuar o atendimento com esse tipo de linguagem. Por favor, mantenha o respeito para que possamos resolver tudo da melhor forma. 🙏\n\nSe precisar registrar uma reclamação ou falar com um responsável, digite *0* e escolha a opção *6* no menu.`;
      } else {
        reply = `Como as ofensas continuaram, estou encerrando o atendimento automático por aqui. Nossa equipe foi notificada e analisará a conversa assim que possível.`;
        needsTakeover = true;
      }

      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: needsTakeover,
        isProfanity: true,
        profanityCount: currentCount
      };
    }

    // Se o cliente enviou mensagem normal respeitosa, reseta o contador consecutivo de ofensas
    this.profanityCount.delete(cleanPhone);

    // 3. MAPEAMENTO DIRETO DAS 8 OPÇÕES DO MENU

    // Opção 1: Cardápio Digital Completo
    if (t === '1' || t === '1️⃣') {
      const reply = `Acesse nosso *Cardápio Digital Completo* pelo link abaixo para montar seu açaí do seu jeito e escolher seus acompanhamentos favoritos:\n👉 *https://cardapioexplosaoacai.com.br*\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // Opção 2: Rastrear meu Pedido
    if (t === '2' || t === '2️⃣') {
      let memoryNote = '';
      if (clientMemory?.latestOrder) {
        memoryNote = `Identifiquei seu último pedido realizado (#${clientMemory.latestOrder.orderNo} - Status atual: "${clientMemory.latestOrder.status}"). Deseja consultar o andamento deste pedido ou rastrear um novo?\n\n`;
      }
      const reply = `${memoryNote}Para consultar o *Status do seu Pedido*, por favor, me informe o *número do pedido* ou o *nome completo / telefone* cadastrado na compra.\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // Opção 3: Combos & Promoções da Semana
    if (t === '3' || t === '3️⃣') {
      const reply = this.getCombosAndPromosText(ctx);
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // Opção 4: Horário de Funcionamento e Endereço
    if (t === '4' || t === '4️⃣') {
      const address = ctx.address || 'Rua Renato Lourenço Fernandes Rosa, 1721 - Franca, SP';
      const hours = ctx.openingHours || 'Terça a Domingo das 13h às 23h';
      const reply = `Confira nossas informações de funcionamento e retirada na loja:\n- *Endereço:* ${address}\n- *Horário de Funcionamento:* ${hours}\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // Opção 5: Falar com um Atendente
    if (t === '5' || t === '5️⃣') {
      if (!ctx.isOpen) {
        const reply = `Poxa, no momento a *Explosão Açaí* está fechada e nossa equipe já encerrou o expediente por hoje! 🌙\n\nMas pode ficar à vontade para deixar sua mensagem escrita aqui mesmo. Assim que abrirmos, alguém da equipe já pega o seu recado para te responder! \n\n(Se quiser ver nosso cardápio ou horários, é só digitar *0* para voltar ao menu).`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }
      const reply = `Com certeza! Já estou chamando alguém da nossa equipe para te atender por aqui. É só aguardar um minutinho que já vamos te responder! 😊\n\n(Se precisar voltar para o menu anterior enquanto aguarda, é só digitar *0*).`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: true };
    }

    // Opção 6: Enviar Sugestão ou Reclamação (Ouvidoria)
    if (t === '6' || t === '6️⃣' || t === 'ouvidoria' || t === 'feedback') {
      this.pendingFeedbackSessions.set(cleanPhone, { timestamp: Date.now(), customerName: effectiveName });
      const reply = `Sua opinião é muito importante para a *Explosão Açaí*! Digite abaixo sua *sugestão, elogio ou reclamação* que nossa gerência vai analisar com carinho.\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isFeedbackPrompt: true };
    }

    // Opção 7: Forma de pagamento
    if (t === '7' || t === '7️⃣') {
      const reply = `Aceitamos as seguintes *formas de pagamento*:\n- *Pix* (pagamento rápido online ou na entrega)\n- *Cartão de Crédito e Débito* (online ou na maquininha na entrega)\n- *Dinheiro* (informe se precisar de *troco*)\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // Opção 8: Pedir Chave PIX
    if (t === '8' || t === '8️⃣' || t === 'chave pix' || t === 'pedir chave pix' || t === 'chave do pix' || t === 'qual o pix' || t === 'qual a chave pix' || t === 'pix') {
      const reply = `Aqui está a nossa chave PIX (CNPJ) para pagamento! 💠\n\n**Favorecido:** Laudinea Cristina dos Reis / Explosão Açaí\n\n👇 Selecione e copie a chave abaixo:\n\n\`\`\`69925028000136\`\`\`\n\n*(Após o pagamento, lembre-se de nos enviar o comprovante por aqui!)*\n\n0️⃣ Digite 0 a qualquer momento para voltar no menu!`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // Opção 9: Encerrar atendimento
    if (t === '9' || t === '9️⃣') {
      this.pendingFeedbackSessions.delete(cleanPhone);
      this.clearHistory(cleanPhone);
      const reply = `Atendimento encerrado! Agradecemos pelo contato com a *Explosão Açaí* 🍧💜.\nSempre que precisar, basta enviar um *Oi* por aqui para iniciar um novo atendimento!`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isSessionEnded: true };
    }

    // Detecção espontânea de sugestão ou elogio do cliente
    if (this.isSuggestionText(cleanText)) {
      const entry = this.saveFeedback({ phone: cleanPhone, customerName: effectiveName, type: 'sugestao', message: cleanText });
      const reply = `Muito obrigado pelo seu carinho e pela sua sugestão${effectiveName ? ` ${effectiveName}` : ''}! A sua opinião é muito valiosa para continuarmos melhorando a cada dia. Já registrei sua mensagem para a nossa gerência e equipe!\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, feedbackId: entry?.id };
    }

    // Detecção espontânea de reclamação explícita do cliente
    if (this.isComplaintText(cleanText)) {
      const entry = this.saveFeedback({ phone: cleanPhone, customerName: effectiveName, type: 'reclamacao', message: cleanText });
      const reply = `Sinto muito pelo ocorrido${effectiveName ? ` ${effectiveName}` : ''}! Peço sinceras desculpas pelo transtorno. Nós levamos a qualidade do seu atendimento muito a sério. Notifiquei a gerência e o responsável da loja no painel e alguém da nossa equipe vai assumir este chat agora mesmo para te ajudar!`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: true, feedbackId: entry?.id };
    }

    // 4. CONSULTA À BASE DE APRENDIZADO DA IA (FAQ APRENDIDA)
    const learned = this.findLearnedKnowledge(cleanText);
    if (learned) {
      let reply = `*Explosão Açaí Informa:*\n\n${learned.answer}`;
      if (!ctx.isOpen) {
        reply += `\n\n*(Lembrando que nossa cozinha está fechada no momento e abre às ${ctx.openingHours}, mas você já pode ir escolhendo o seu favorito!)*`;
      } else {
        reply += `\n\n*Monte seu açaí no cardápio digital:* https://cardapioexplosaoacai.com.br\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`;
      }
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // 5. ATENDIMENTO AVANÇADO COM GOOGLE GEMINI 2.0 FLASH (COM MEMÓRIA CONVERSACIONAL)
    if (this.client && this.apiKey) {
      try {
        const systemInstruction = `
Você é o assistente virtual oficial de atendimento da "Explosão Açaí".

MENU PRINCIPAL:
Atendimento automático Explosão Açaí! 🍧

📋 Menu Principal Explosão Açaí
${ctx.isOpen ? '😊 Status: Loja Aberta e Entregando' : '😴 Status: Loja Fechada no momento'}

Olá {Nome_Cliente}! Como posso te ajudar hoje? escolha uma opção.

1️⃣ - Para Conhecer nosso cardapio digital Cardápio Digital Completo:
2️⃣ - Rastrear meu Pedido.
3️⃣ - Combos & Promoções da Semana.
4️⃣ - Horário de Funcionamento e Endereço.
5️⃣ - Falar com um Atendente.
6️⃣ - Enviar Sugestão ou Reclamação (Ouvidoria)
7️⃣ - Forma de pagamento.
8️⃣ - Pedir Chave PIX.
9️⃣ - Encerrar atendimento.

0️⃣ Digite 0 a qualquer momento para voltar no menu!

INFORMAÇÕES REAIS DO ESTABELECIMENTO EM TEMPO REAL:
- Loja: ${ctx.storeName}
- Status: ${ctx.isOpen ? '😊 Status: Loja Aberta e Entregando' : '😴 Status: Loja Fechada no momento'}
- Horário de Funcionamento: ${ctx.openingHours}
- Endereço: ${ctx.address}
- Link do Cardápio Digital Oficial: https://cardapioexplosaoacai.com.br
- Cupons Ativos: ${ctx.couponList}

MEMÓRIA DO CLIENTE:
- Nome: ${effectiveName}
- Último pedido: ${clientMemory?.latestOrder ? '#' + clientMemory.latestOrder.orderNo + ' (' + clientMemory.latestOrder.status + ')' : 'Nenhum'}
- Preferência de pagamento: ${clientMemory?.paymentPref || 'Nenhuma'}
- Endereço de entrega: ${clientMemory?.deliveryAddress || 'Nenhum'}

REGRAS RÍGIDAS DE ATENDIMENTO:
1. Status da Loja & Opção 5:
   - Se a loja estiver ABERTA: transfira para atendente humano com a mensagem exata:
"Com certeza! Já estou chamando alguém da nossa equipe para te atender por aqui. É só aguardar um minutinho que já vamos te responder! 😊

(Se precisar voltar para o menu anterior enquanto aguarda, é só digitar *0*)."
e conclua internamente com: [ACTION:CALL_HUMAN].
   - Se a loja estiver FECHADA: NÃO transfira para o atendente, responda exatamente:
"Poxa, no momento a *Explosão Açaí* está fechada e nossa equipe já encerrou o expediente por hoje! 🌙

Mas pode ficar à vontade para deixar sua mensagem escrita aqui mesmo. Assim que abrirmos, alguém da equipe já pega o seu recado para te responder! 

(Se quiser ver nosso cardápio ou horários, é só digitar *0* para voltar ao menu)."

2. Opção 8 (Pedir Chave PIX):
Responda exatamente com:
"Aqui está a nossa chave PIX (CNPJ) para pagamento! 💠

**Favorecido:** Laudinea Cristina dos Reis / Explosão Açaí

👇 Selecione e copie a chave abaixo:

\`\`\`69925028000136\`\`\`

*(Após o pagamento, lembre-se de nos enviar o comprovante por aqui!)*

0️⃣ Digite 0 a qualquer momento para voltar no menu!"

3. Opção 9: Encerre o atendimento com a mensagem de encerramento.
4. Se o cliente digitar 0 ou pedir menu, envie o Menu Principal exato.
5. Quando o cliente escolher a Opção 3 ou perguntar sobre combos e promoções, informe os combos e promoções da semana com preços e composições, os cupons ativos e o link https://cardapioexplosaoacai.com.br.
6. Mensagens Não Compreendidas ou Fora de Contexto (Fallback):
Se a mensagem do cliente for aleatória, incompreensível ou fora de contexto, responda exatamente:
"Ops! Acho que não consegui entender essa mensagem por aqui. 😅

Como sou um assistente virtual, às vezes preciso de uma ajudinha. Tente escrever com outras palavras o que você precisa ou digite *0* para voltar ao menu principal da *Explosão Açaí*! 🍧"
        `.trim();

        const historyList = this.getHistory(phone);
        const contents = [
          ...historyList.map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.text }]
          })),
          {
            role: 'user',
            parts: [{ text: `Cliente (${effectiveName}, Tel: ${phone}): ${cleanText}` }]
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

        // Se a IA detectou que precisa chamar humano por reclamação, garante gravação no banco
        if (needsHuman && this.isComplaintText(cleanText)) {
          this.saveFeedback({ phone: cleanPhone, customerName: effectiveName, type: 'reclamacao', message: cleanText });
        }

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

    // 6. MOTOR INTELIGENTE LOCAL (CONTINGÊNCIA SEM CUSTO DE API)
    const result = this.fallbackSmartRuleEngine(cleanText, ctx, effectiveName, cleanPhone);
    this.saveHistory(phone, 'user', cleanText);
    this.saveHistory(phone, 'assistant', result.reply);
    return result;
  }

  /**
   * Motor inteligente local de contingência (com tom limpo, profissional e mapeamento das 8 opções)
   */
  fallbackSmartRuleEngine(text, ctx, customerName, cleanPhone = '') {
    const t = text.toLowerCase().trim();
    const phoneToSave = cleanPhone || (ctx.phone || '').replace(/\D/g, '');
    const memory = ctx.clientMemory || this.getClientMemory(phoneToSave);
    const effectiveName = customerName || memory?.customerName || 'Cliente';

    // Opção 1 ou Cardápio
    if (t === '1' || t.includes('cardapio') || t.includes('cardápio') || t.includes('conhecer nosso cardapio')) {
      return {
        reply: `Acesse nosso *Cardápio Digital Completo* pelo link abaixo para montar seu açaí do seu jeito e escolher seus acompanhamentos favoritos:\n👉 *https://cardapioexplosaoacai.com.br*\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`,
        needsHumanTakeover: false
      };
    }

    // Opção 2 ou Rastreamento de Pedido
    if (t === '2' || t.includes('rastrear') || t.includes('rastreio') || t.includes('onde ta') || t.includes('cade meu pedido') || t.includes('cadê meu pedido')) {
      let memoryNote = '';
      if (memory?.latestOrder) {
        memoryNote = `Identifiquei seu último pedido realizado (#${memory.latestOrder.orderNo} - Status atual: "${memory.latestOrder.status}"). Deseja consultar o andamento deste pedido ou rastrear um novo?\n\n`;
      }
      return {
        reply: `${memoryNote}Para consultar o *Status do seu Pedido*, por favor, me informe o *número do pedido* ou o *nome completo / telefone* cadastrado na compra.\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`,
        needsHumanTakeover: false
      };
    }

    // Consulta direta por número de pedido (ex: 6 dígitos ou #123456)
    const orderNoMatch = t.match(/\b\d{6}\b/);
    if (orderNoMatch) {
      const orderNo = orderNoMatch[0];
      const allOrders = orderService.getOrders() || [];
      const found = allOrders.find(o => o.orderNo === orderNo);
      if (found) {
        const motoboy = found.delivery?.motoboyName ? ` com o motoboy ${found.delivery.motoboyName}` : '';
        return {
          reply: `*Status do Pedido #${found.orderNo}:*\n- *Situação:* ${found.status}${motoboy}\n- *Total:* R$ ${Number(found.total || 0).toFixed(2)}\n- *Entrega:* ${found.delivery?.street ? `${found.delivery.street}, ${found.delivery.number || ''}` : 'Retirada'}\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`,
          needsHumanTakeover: false
        };
      }
    }

    // Opção 3 ou Promoções / Combos
    if (t === '3' || t.includes('combo') || t.includes('promo') || t.includes('promocoes') || t.includes('promoções') || t.includes('desconto')) {
      return {
        reply: this.getCombosAndPromosText(ctx),
        needsHumanTakeover: false
      };
    }

    // Opção 4 ou Horários e Endereço
    if (t === '4' || t.includes('horario') || t.includes('horário') || t.includes('endereco') || t.includes('endereço') || t.includes('onde fica') || t.includes('localizacao')) {
      const address = ctx.address || 'Rua Renato Lourenço Fernandes Rosa, 1721 - Franca, SP';
      const hours = ctx.openingHours || 'Terça a Domingo das 13h às 23h';
      return {
        reply: `Confira nossas informações de funcionamento e retirada na loja:\n- *Endereço:* ${address}\n- *Horário de Funcionamento:* ${hours}\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`,
        needsHumanTakeover: false
      };
    }

    // Opção 5 ou Atendente Humano
    if (t === '5' || t === '5️⃣' || t.includes('atendente') || t.includes('humano') || t.includes('falar com pessoa') || t.includes('pessoa real')) {
      if (!ctx.isOpen) {
        return {
          reply: `Poxa, no momento a *Explosão Açaí* está fechada e nossa equipe já encerrou o expediente por hoje! 🌙\n\nMas pode ficar à vontade para deixar sua mensagem escrita aqui mesmo. Assim que abrirmos, alguém da equipe já pega o seu recado para te responder! \n\n(Se quiser ver nosso cardápio ou horários, é só digitar *0* para voltar ao menu).`,
          needsHumanTakeover: false
        };
      }
      return {
        reply: `Com certeza! Já estou chamando alguém da nossa equipe para te atender por aqui. É só aguardar um minutinho que já vamos te responder! 😊\n\n(Se precisar voltar para o menu anterior enquanto aguarda, é só digitar *0*).`,
        needsHumanTakeover: true
      };
    }

    // Opção 6 ou Ouvidoria
    if (t === '6' || t === '6️⃣' || t.includes('ouvidoria') || t.includes('sugestao') || t.includes('sugestão') || t.includes('reclamacao') || t.includes('reclamação')) {
      this.pendingFeedbackSessions.set(phoneToSave, { timestamp: Date.now(), customerName: effectiveName });
      return {
        reply: `Sua opinião é muito importante para a *Explosão Açaí*! Digite abaixo sua *sugestão, elogio ou reclamação* que nossa gerência vai analisar com carinho.\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`,
        needsHumanTakeover: false,
        isFeedbackPrompt: true
      };
    }

    // Opção 7 ou Forma de pagamento
    if (t === '7' || t === '7️⃣' || t.includes('forma de pagamento') || t.includes('formas de pagamento') || t.includes('cartao') || t.includes('cartão') || t.includes('dinheiro') || t.includes('troco')) {
      return {
        reply: `Aceitamos as seguintes *formas de pagamento*:\n- *Pix* (pagamento rápido online ou na entrega)\n- *Cartão de Crédito e Débito* (online ou na maquininha na entrega)\n- *Dinheiro* (informe se precisar de *troco*)\n\n*(Digite *0* para voltar ao menu ou *8* para encerrar o atendimento).*`,
        needsHumanTakeover: false
      };
    }

    // Opção 8 ou Pedir Chave PIX
    if (t === '8' || t === '8️⃣' || t.includes('chave pix') || t.includes('pedir chave pix') || t.includes('qual o pix') || t.includes('qual a chave') || t === 'pix') {
      return {
        reply: `Aqui está a nossa chave PIX (CNPJ) para pagamento! 💠\n\n**Favorecido:** Laudinea Cristina dos Reis / Explosão Açaí\n\n👇 Selecione e copie a chave abaixo:\n\n\`\`\`69925028000136\`\`\`\n\n*(Após o pagamento, lembre-se de nos enviar o comprovante por aqui!)*\n\n0️⃣ Digite 0 a qualquer momento para voltar no menu!`,
        needsHumanTakeover: false
      };
    }

    // Opção 9 ou Encerrar atendimento
    if (t === '9' || t === '9️⃣' || t.includes('encerrar') || t.includes('finalizar atendimento') || t.includes('tchau') || t.includes('obrigado') || t.includes('valeu')) {
      this.pendingFeedbackSessions.delete(phoneToSave);
      this.clearHistory(phoneToSave);
      return {
        reply: `Atendimento encerrado! Agradecemos pelo contato com a *Explosão Açaí* 🍧💜.\nSempre que precisar, basta enviar um *Oi* por aqui para iniciar um novo atendimento!`,
        needsHumanTakeover: false,
        isSessionEnded: true
      };
    }

    // Reclamação ou problema com gravação garantida em db.feedbacks
    if (this.isComplaintText(t) || t.includes('errado') || t.includes('derretido') || t.includes('faltou') || t.includes('reclamar') || t.includes('ruim') || t.includes('cancelar')) {
      this.saveFeedback({ phone: phoneToSave, customerName: effectiveName, type: 'reclamacao', message: text });
      return {
        reply: `Sinto muito pelo ocorrido${effectiveName ? ` ${effectiveName}` : ''}! Peço sinceras desculpas pelo transtorno. Nós levamos a qualidade do seu atendimento muito a sério. Notifiquei a gerência no painel e alguém da nossa equipe vai assumir este chat agora mesmo para te ajudar!`,
        needsHumanTakeover: true
      };
    }

    // Saudações comuns ou intenção inicial de pedir -> Menu Principal
    const isGreetingOrOrderIntent = /^(oi|ola|olá|bom dia|boa tarde|boa noite|quero pedir|quero açaí|quero acai)\b/i.test(t) ||
      t.includes('boa noite') || t.includes('bom dia') || t.includes('boa tarde') || t.includes('quero pedir') || t.includes('fazer pedido') || t === 'oi' || t === 'ola' || t === 'olá';

    if (isGreetingOrOrderIntent && !t.includes('?')) {
      return {
        reply: this.renderMainMenu(ctx, effectiveName),
        needsHumanTakeover: false
      };
    }

    // Dúvida específica ou solicitação complexa (Parceria, Vagas, Dúvidas): transfere para atendente humano
    const isQuestionOrComplex = t.includes('?') || t.includes('parceria') || t.includes('trabalhar') || t.includes('vaga');
    if (isQuestionOrComplex) {
      return {
        reply: `Essa é uma dúvida bem específica e quero te dar a resposta correta com certeza. Por isso, estou chamando um atendente humano da nossa equipe agora mesmo para te responder por aqui. Aguarde só um instante!\n\nSe quiser ver o cardápio ou outras informações  enquanto isso, digite 0 para voltar ao menu de opções !`,
        needsHumanTakeover: true
      };
    }

    // Resposta padrão (Fallback para mensagem aleatória ou não compreendida)
    return {
      reply: `Ops! Acho que não consegui entender essa mensagem por aqui. 😅\n\nComo sou um assistente virtual, às vezes preciso de uma ajudinha. Tente escrever com outras palavras o que você precisa ou digite *0* para voltar ao menu principal da *Explosão Açaí*! 🍧`,
      needsHumanTakeover: false,
      isFallback: true
    };
  }

  /**
   * Gera texto promocional semanal persuasivo com IA para disparo aos clientes (sem excesso de emojis)
   */
  async generateWeeklyPromotionText({ productName = '', discount = '', couponCode = '' } = {}) {
    const ctx = this.buildLiveContext();
    const publicUrl = ctx.publicUrl;

    if (this.client && this.apiKey) {
      try {
        const prompt = `
Crie uma mensagem promocional curta, direta e atraente para envio no WhatsApp da "Explosão Açaí".
Detalhes da oferta:
- Produto em Destaque: ${productName || 'Nossos Combos e Copos Especiais'}
- Cupom / Desconto: ${couponCode ? `Cupom ${couponCode}` : (discount || 'Desconto exclusivo')}
- Link da loja: ${publicUrl}

Regras:
1. Comece com uma saudação educada e simpática.
2. Seja elegante e direto. Não use excesso de emojis (no máximo 1 ou nenhum).
3. Mantenha no máximo 4 a 5 linhas.
4. Inclua chamada para ação com o link.
5. Termine com nota legal: "(Caso não queira mais receber nossas ofertas, digite 'sair')".
        `.trim();

        const response = await this.client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { temperature: 0.7, maxOutputTokens: 300 }
        });

        return response.text || '';
      } catch (e) {}
    }

    // Fallback padrão se Gemini não estiver configurado
    const itemStr = productName ? `o delicioso *${productName}*` : 'nossos melhores copos e combos';
    const couponStr = couponCode ? `Use o cupom *${couponCode}* e aproveite!` : 'Aproveite nossa promoção especial!';

    return `Olá! Passando para compartilhar uma oferta especial da *Explosão Açaí*!\n\nQue tal pedir hoje ${itemStr}? ${couponStr}\n\nPeça agora com entrega rápida:\n${publicUrl}\n\n_(Caso não queira mais receber novidades da loja, basta responder 'sair')_`;
  }
}

export const geminiAssistantService = new GeminiAssistantService();
