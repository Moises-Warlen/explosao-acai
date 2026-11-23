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
    this.sessions = new Map(); // Sessões de atendimento: Map<cleanPhone, UserSession>
    this.pendingFeedbackSessions = new Map(); // Sessão legada de Ouvidoria: Map<cleanPhone, {timestamp, customerName}>
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
   * Normalização fonética e leetspeak para detecção de linguagem disfarçada
   */
  normalizeForModeration(text) {
    if (!text || typeof text !== 'string') return { norm: '', leet: '', collapsed: '' };
    const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const leetMap = {
      '@': 'a', '4': 'a',
      '3': 'e',
      '1': 'i', '!': 'i', '|': 'i',
      '0': 'o',
      '5': 's', '$': 's',
      '7': 't'
    };
    const leet = norm.replace(/[@431!|05$7]/g, m => leetMap[m] || m);
    // Remove pontuações e espaços repetidos entre letras, ex: p.u.t.a -> puta, m-e-r-d-a -> merda
    const collapsed = leet.replace(/([a-z])[\s._\-*]+(?=[a-z])/g, '$1');
    return { norm, leet, collapsed };
  }

  /**
   * Proteção contra falsos positivos: identifica relatos legítimos de discriminação ou dúvidas
   */
  isPrejudiceDiscussionOrReport(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const safePhrases = [
      'sofri preconceito', 'sofri racismo', 'sofri discriminacao', 'fui vitima',
      'relatar preconceito', 'denunciar preconceito', 'denunciar racismo',
      'intolerancia a lactose', 'intolerante a lactose',
      'publico lgbt', 'publico lgbtq', 'atendem lgbt', 'opcao vegana'
    ];
    return safePhrases.some(phrase => lower.includes(phrase));
  }

  /**
   * Detecção de Ameaças Graves ou Discriminação Explícita (Prioridade Máxima - Ação Imediata)
   */
  checkSevereThreatOrDiscrimination(text) {
    if (!text || typeof text !== 'string') return false;
    if (this.isPrejudiceDiscussionOrReport(text)) return false;

    const { norm, leet, collapsed } = this.normalizeForModeration(text);
    const targets = [norm, leet, collapsed];

    // Ameaças de morte, violência física, armas, agressão
    const severeThreatPatterns = [
      /\b(vou|vai|vcs vao|voces vao)\s*(te|lhe|nos)?\s*(matar|arrebentar|espancar|degolar|linchar)\b/i,
      /\b(dar\s*um\s*tiro|meter\s*bala|tiro\s*na\s*cara|bala\s*na\s*cara|vou\s*te\s*dar\s*um\s*tiro)\b/i,
      /\b(botar\s*fogo\s*na\s*loja|quebrar\s*a\s*loja|quebrar\s*a\s*sua\s*cara|vou\s*quebrar\s*tudo)\b/i,
      /\b(te\s*pego\s*na\s*saida|voce\s*vai\s*morrer|vou\s*te\s*achar)\b/i
    ];

    // Discriminação e preconceito explícito (racismo, injúria racial, homofobia/transfobia)
    const severeDiscriminationPatterns = [
      /\b(seu\s*macaco|seus\s*macacos|macaco\s*safado|macaca\s*safada)\b/i,
      /\b(preto\s*imundo|negro\s*imundo|preto\s*fedido|crioulo\s*safado|preto\s*de\s*merda)\b/i,
      /\b(traveco|traveco\s*imundo|bicha\s*imunda|viadinho\s*de\s*merda|sapatao\s*de\s*merda)\b/i,
      /\b(aberracao\s*lgbt|malditos\s*lgbt)\b/i,
      /\b(retardado\s*mental|mongoloid[es]|aleijado\s*de\s*merda)\b/i
    ];

    const hasThreat = severeThreatPatterns.some(p => targets.some(t => p.test(t)));
    if (hasThreat) return { isSevere: true, reason: 'ameaca' };

    const hasDiscrimination = severeDiscriminationPatterns.some(p => targets.some(t => p.test(t)));
    if (hasDiscrimination) return { isSevere: true, reason: 'discriminacao' };

    return false;
  }

  /**
   * Filtro de Palavrões, Ofensas e Conteúdo Explícito (com suporte a leetspeak e variações disfarçadas)
   */
  checkProfanityAndExplicit(text) {
    if (!text || typeof text !== 'string') return false;
    if (this.isPrejudiceDiscussionOrReport(text)) return false;

    const { norm, leet, collapsed } = this.normalizeForModeration(text);
    const targets = [norm, leet, collapsed];
    
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

    return profanityPatterns.some(pattern => targets.some(t => pattern.test(t)));
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
   * Cliente perguntando se fazemos delivery / quanto é a taxa de entrega?
   * (Não captura rastreio de pedido nem reclamação de atraso)
   */
  isDeliveryQuestion(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!t || t.length > 200) return false;
    // Rastreio / atraso / problemas -> outros fluxos
    if (/(onde esta|cade|status|rastre|atras|demor|minha entrega|meu pedido|ja saiu|motoboy)/.test(t)) return false;
    if (/\bdelivery\b/.test(t)) return true;
    if (/\b(frete|taxa de entrega|taxa de delivery|valor da entrega|valor do frete|preco da entrega)\b/.test(t)) return true;
    if (/\b(faz|fazem|tem|tm|voces|vcs|vc|ai tem)\b.{0,25}\bentreg/.test(t)) return true;
    if (/\bentreg(a|am|ar)\b.{0,20}\b(em|no|na|pra|para|ate|aqui|bairro)\b/.test(t)) return true;
    return false;
  }

  /**
   * Resposta padrão sobre delivery (valores vêm das configurações de frete da loja)
   */
  buildDeliveryReply(ctx = {}) {
    const st = db.get()?.settings || {};
    const num = (v, d) => (v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
    const freeKm = num(st.freeKmThreshold, 2);
    const minFreight = num(st.minFreight, 4.5);
    const perKm = num(st.perKmRate, 1);
    const fmtKm = (n) => String(Number(n.toFixed(1))).replace('.', ',');
    const fmtMoney = (n) => 'R$ ' + n.toFixed(2).replace('.', ',');
    // Acima deste km a taxa passa do valor mínimo e cobra por km rodado (arredondado para km inteiro na comunicação)
    const tierKm = Math.ceil(minFreight / (perKm || 1));
    const rawUrl = ctx.publicUrl || process.env.BASE_URL || 'https://cardapioexplosaoacai.com.br';
    const url = rawUrl.replace(/\/+$/, '') + '/';

    return `Oi! 😍 Sim, fazemos delivery! 🛵

A taxa de entrega varia de acordo com a distância do seu endereço:

📍 Até ${fmtKm(freeKm)} km: entrega grátis!
📍 Acima de ${fmtKm(freeKm)} km até ${fmtKm(tierKm)} km: taxa mínima de ${fmtMoney(minFreight)}.
📍 Acima de ${fmtKm(tierKm)} km: cobramos ${fmtMoney(perKm)} por km rodado.

Mas pode ficar tranquilo(a)! Nosso cardápio digital informa o valor da taxa de entrega antes de você finalizar o pagamento. 😉

Acesse agora, confira nossas delícias e aproveite para fazer seu pedido! 

🛒 ${url}`;
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
   * Horário de abertura do dia ou do próximo dia útil puxado automaticamente das configurações
   */
  getNextOpeningTimeFormatted(schedules = []) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return '13:00';
    }
    const now = new Date();
    const brTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const todayDay = brTime.getDay();
    const hours = String(brTime.getHours()).padStart(2, '0');
    const minutes = String(brTime.getMinutes()).padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;

    const todaySchedule = schedules.find(s => s.day === todayDay);
    if (todaySchedule && todaySchedule.active && currentTime < todaySchedule.open) {
      return todaySchedule.open;
    }

    for (let i = 1; i <= 7; i++) {
      const nextDay = (todayDay + i) % 7;
      const sched = schedules.find(s => s.day === nextDay);
      if (sched && sched.active) {
        return sched.open + (sched.dayName ? ` (${sched.dayName})` : '');
      }
    }
    return todaySchedule?.open || '13:00';
  }

  /**
   * Formata a lista completa de horários de funcionamento cadastrados na loja
   */
  getOpeningHoursFormatted(schedules = []) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return '• Terça a Domingo das 13h às 23h';
    }
    return schedules.map(s => {
      if (s.active) {
        return `• *${s.dayName}:* das ${s.open} às ${s.close}`;
      }
      return `• *${s.dayName}:* Fechado`;
    }).join('\n');
  }

  /**
   * Mensagem compartilhada de Horário, Endereço e Pagamentos (PIX) - Seção 5 / Opção 4
   */
  renderSharedInfoMessage(ctx) {
    return `📍 *Informações da Explosão Açaí*

🕒 *Horário de Funcionamento:*
${ctx.openingHoursFormatted}

🏠 *Endereço (Retirada / Local):*
${ctx.address}

💳 *Formas de Pagamento:*
• *Pix:* Chave CNPJ: *${ctx.pixKey}* — _Favorecido: ${ctx.pixFavored}_
• *Cartão de Crédito e Débito* (levamos a maquininha)
• *Dinheiro* (informe se precisar de troco)

_(Digite *0* para voltar ao menu)_`;
  }

  /**
   * Retorna descrição amigável de status do pedido para o cliente
   */
  getFriendlyStatus(status) {
    const map = {
      received: 'Recebido (Aguardando confirmação)',
      preparing: 'Em preparo na cozinha 🍧',
      ready: 'Pronto para entrega/retirada 📦',
      out_for_delivery: 'Saiu para entrega (Em rota com motoboy) 🛵',
      delivered: 'Entregue',
      cancelled: 'Cancelado',
      returned: 'Devolvido'
    };
    return map[status] || status || 'Em andamento';
  }

  /**
   * Consulta o último pedido ativo vinculado ao número de WhatsApp do cliente
   */
  getActiveCustomerOrder(cleanPhone) {
    if (!cleanPhone) return null;
    try {
      const cleanLast8 = cleanPhone.slice(-8);
      const allOrders = orderService.getOrders() || [];
      const active = allOrders.filter(o => {
        const p = o.customer?.phone ? String(o.customer.phone).replace(/\D/g, '') : '';
        if (!p.endsWith(cleanLast8)) return false;
        return o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'returned';
      });
      return active.length > 0 ? active[0] : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Verifica se o cliente realizou algum pedido no sistema desde um determinado timestamp
   */
  hasCustomerOrderedSince(cleanPhone, timestamp) {
    if (!cleanPhone || !timestamp) return false;
    try {
      const cleanLast8 = cleanPhone.slice(-8);
      const orders = db.get()?.orders || [];
      return orders.some(o => {
        const p = o.customer?.phone ? String(o.customer.phone).replace(/\D/g, '') : '';
        if (!p.endsWith(cleanLast8)) return false;
        const createdMs = new Date(o.createdAt).getTime();
        return createdMs >= timestamp && o.status !== 'cancelled';
      });
    } catch (e) {
      return false;
    }
  }

  /**
   * Obtém ou inicializa a sessão ativa do usuário
   */
  getSession(cleanPhone, customerName = '', remoteJid = '') {
    if (!cleanPhone) return null;
    let session = this.sessions.get(cleanPhone);
    if (!session) {
      session = {
        phone: cleanPhone,
        customerName: customerName || 'Cliente',
        remoteJid: remoteJid || `${cleanPhone}@s.whatsapp.net`,
        estado_sessao: 'MENU_PRINCIPAL',
        acessou_cardapio: false,
        cardapioAccessedAt: null,
        lastInteractionAt: Date.now(),
        recovered12Sent: false,
        reminder15Sent: false,
        closed20Sent: false
      };
      this.sessions.set(cleanPhone, session);
    } else {
      if (customerName && session.customerName === 'Cliente') {
        session.customerName = customerName;
      }
      if (remoteJid) {
        session.remoteJid = remoteJid;
      }
    }
    return session;
  }

  /**
   * Libera a sessão humana de volta para MENU_PRINCIPAL
   */
  releaseHumanSession(cleanPhone) {
    if (!cleanPhone) return;
    const session = this.sessions.get(cleanPhone);
    if (session) {
      session.estado_sessao = 'MENU_PRINCIPAL';
      session.lastInteractionAt = Date.now();
    }
  }

  /**
   * Executa a checagem periódica dos timers automáticos de recuperação e inatividade
   * (Apenas enquanto bot estiver ativo - nunca dispara em FILA_HUMANA_PAUSADO ou ENCERRADO)
   */
  checkInactivityTimers() {
    const messagesToSend = [];
    const now = Date.now();
    const ctx = this.buildLiveContext();
    const isOpen = ctx.isOpen;
    const nextOpenTime = ctx.nextOpeningTime;
    const linkCardapio = ctx.publicUrl;

    for (const [cleanPhone, session] of this.sessions.entries()) {
      if (session.estado_sessao === 'FILA_HUMANA_PAUSADO' || session.estado_sessao === 'ENCERRADO') {
        continue;
      }

      const customerName = session.customerName || 'Cliente';
      const remoteJid = session.remoteJid || `${cleanPhone}@s.whatsapp.net`;

      // 1. Gatilho de 12 minutos (Somente se loja_aberta == true e acessou_cardapio == true sem pedido gerado)
      if (isOpen && session.acessou_cardapio && !session.recovered12Sent && session.cardapioAccessedAt) {
        const elapsedSinceCardapio = now - session.cardapioAccessedAt;
        if (elapsedSinceCardapio >= 12 * 60 * 1000) {
          const hasOrdered = this.hasCustomerOrderedSince(cleanPhone, session.cardapioAccessedAt);
          if (!hasOrdered) {
            session.recovered12Sent = true;
            const msg = `Oi *${customerName}*, vi que você deu uma olhada no nosso cardápio! 👀🍧\n\nFicou com alguma dúvida nos tamanhos, adicionais ou taxa de entrega? \n\n👉 *Link direto:* ${linkCardapio}\n\nSe precisar de ajuda para montar seu pedido, digite *5* para falar com a nossa equipe!`;
            messagesToSend.push({ phone: cleanPhone, remoteJid, message: msg, type: 'recovery_12' });
          } else {
            session.recovered12Sent = true;
          }
        }
      }

      // 2. Aviso de 15 minutos sem interação
      const elapsedInteraction = now - (session.lastInteractionAt || now);
      if (!session.reminder15Sent && elapsedInteraction >= 15 * 60 * 1000 && elapsedInteraction < 20 * 60 * 1000) {
        session.reminder15Sent = true;
        let msg = '';
        if (isOpen) {
          msg = `Oi *${customerName}*, ainda está por aí? 👀 Se precisar de ajuda para montar seu açaí, é só responder aqui!`;
        } else {
          msg = `Oi *${customerName}*, ainda está por aí? 👀 Se quiser deixar seu açaí agendado para quando abrirmos às ${nextOpenTime}, é só responder aqui!`;
        }
        messagesToSend.push({ phone: cleanPhone, remoteJid, message: msg, type: 'reminder_15' });
      }

      // 3. Encerramento aos 20 minutos sem interação
      if (!session.closed20Sent && elapsedInteraction >= 20 * 60 * 1000) {
        session.closed20Sent = true;
        session.estado_sessao = 'ENCERRADO';
        const msg = `Atendimento encerrado por falta de interação (mais de 20 minutos sem resposta) ⏳.\nPara iniciar um novo atendimento com a Explosão Açaí, mande um *Oi*! 🍧`;
        messagesToSend.push({ phone: cleanPhone, remoteJid, message: msg, type: 'close_20' });
      }
    }

    return messagesToSend;
  }

  /**
   * Renderiza a resposta formatada do Menu Principal (Loja Aberta: Seção 3.1 | Loja Fechada: Seção 4.1)
   */
  renderMainMenu(ctx, customerName, isReactivated = false) {
    this.stats.menuRequests++;
    const nameStr = customerName ? customerName : (ctx?.clientMemory?.customerName || 'Cliente');

    if (ctx.isOpen) {
      return `Atendimento automático Explosão Açaí!
😃 *Status:* Loja Aberta (Pedidos saindo agora! 🚀)

Olá *${nameStr}*! Bateu vontade de um açaí geladinho? Escolha uma opção:

1️⃣ - *Fazer Pedido / Cardápio Digital* 🍧
2️⃣ - *Combos & Promoções da Semana*
3️⃣ - *Rastrear meu Pedido* 🛵
4️⃣ - *Horário, Endereço e Pagamentos (PIX)*
5️⃣ - *Falar com Atendente / Ouvidoria* 💬
6️⃣ - *Encerrar atendimento*

_Digite 0 a qualquer momento para voltar ao menu._`;
    } else {
      const nextTime = ctx.nextOpeningTime || '13:00';
      return `Atendimento automático Explosão Açaí!
😴 *Status:* Loja Fechada (Abrimos às ${nextTime})

Olá *${nameStr}*! Quer já deixar seu açaí garantido para quando abrirmos? Escolha uma opção:

1️⃣ - *Agendar Pedido para Hoje* ⏰
2️⃣ - *Ver Cardápio Digital (Preços e Sabores)*
3️⃣ - *Combos & Promoções da Semana*
4️⃣ - *Horário, Endereço e Pagamentos (PIX)*
5️⃣ - *Falar com Atendente / Ouvidoria* 💬
6️⃣ - *Encerrar atendimento*

_Digite 0 a qualquer momento para voltar ao menu._`;
    }
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

    const nextOpeningTime = this.getNextOpeningTimeFormatted(storeSettings.schedules);
    const openingHoursFormatted = this.getOpeningHoursFormatted(storeSettings.schedules);
    const pixKey = storeSettings.pixKey || '16991098863';
    const pixFavored = storeSettings.pixFavored || storeSettings.pixName || 'Laudinea Cristina dos Reis / Explosão Açaí';

    return {
      storeName: storeSettings.storeName || 'Explosão Açaí',
      isOpen: Boolean(storeOpenInfo.isOpen),
      openingHours: storeSettings.openingHours || 'Terça a Domingo das 13h às 23h',
      schedules: storeSettings.schedules || [],
      nextOpeningTime,
      openingHoursFormatted,
      address: storeSettings.address || 'Rua Renato Lourenço Fernandes Rosa, 1721 - Franca, SP',
      pixKey,
      pixFavored,
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
   * Processa a mensagem do cliente via Fluxo Unificado Explosão Açaí (Loja Aberta, Loja Fechada, Agendamento, Ouvidoria, Rastreio e IA)
   */
  async processMessage({ phone = '', customerName = '', text = '', remoteJid = '', wasInHumanTakeover = false }) {
    const cleanText = (text || '').trim();
    const t = cleanText.toLowerCase();
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const ctx = this.buildLiveContext(phone);
    const clientMemory = ctx.clientMemory || this.getClientMemory(cleanPhone);
    const effectiveName = customerName || clientMemory?.customerName || 'Cliente';
    const session = this.getSession(cleanPhone, effectiveName, remoteJid);

    // Se o atendimento anterior estava encerrado, qualquer nova mensagem reinicia em MENU_PRINCIPAL
    if (session.estado_sessao === 'ENCERRADO') {
      session.estado_sessao = 'MENU_PRINCIPAL';
      session.acessou_cardapio = false;
      session.cardapioAccessedAt = null;
      session.recovered12Sent = false;
      session.reminder15Sent = false;
      session.closed20Sent = false;
    }

    session.lastInteractionAt = Date.now();
    session.reminder15Sent = false;
    session.closed20Sent = false;

    // 0. DIREITO AO ESQUECIMENTO (LGPD - ART. 18)
    const forgetKeywords = ['esquecer', 'apagar dados', 'limpar dados', 'limpar historico', 'limpar histórico', 'esquecer meus dados', 'privacidade lgpd'];
    if (forgetKeywords.some(k => t === k || t.includes(k))) {
      this.clearHistory(phone);
      this.sessions.delete(cleanPhone);
      const reply = `*Privacidade & LGPD — Explosão Açaí*\n\nSeus dados de histórico e preferências temporárias de atendimento foram totalmente apagados da nossa memória em estrita conformidade com a LGPD!\n\nSeus direitos de privacidade são respeitados com total rigor. Quando quiser nos chamar novamente, estaremos à disposição.\n\n_Digite *0* para ver opções._`;
      return {
        reply,
        needsHumanTakeover: false,
        isForget: true
      };
    }

    // 1. CAMADA DE PROTEÇÃO CONTRA OFENSAS E DISCRIMINAÇÃO (PRIORIDADE MÁXIMA)
    const severeCheck = this.checkSevereThreatOrDiscrimination(cleanText);
    const isProfane = this.checkProfanityAndExplicit(cleanText);

    if (severeCheck || isProfane) {
      this.stats.profanityBlocked++;
      const isSevere = Boolean(severeCheck);
      const maskedPhone = phone ? String(phone).replace(/(\d{4})\d+(\d{4})/, '$1****$2') : 'Desconhecido';

      try {
        securityAuditService.recordEvent({
          type: SecurityEventType.PROFANITY_OFFENSE,
          severity: isSevere ? SecuritySeverity.HIGH : SecuritySeverity.MEDIUM,
          ip: 'WhatsApp-Client',
          endpoint: '/bot/webhook',
          method: 'MESSAGE',
          details: isSevere
            ? `Conduta intolerável detectada (${severeCheck.reason}) do remetente ${maskedPhone}. Encerramento imediato do bot.`
            : `Linguagem inapropriada bloqueada do remetente ${maskedPhone}.`,
          userAgent: 'WhatsApp-Baileys'
        });
      } catch (e) {}

      let currentCount = (this.profanityCount.get(cleanPhone) || 0) + 1;
      if (isSevere) currentCount = 3;
      this.profanityCount.set(cleanPhone, currentCount);

      let reply = '';
      let needsTakeover = false;

      if (currentCount === 1) {
        reply = `Poxa, quero muito te ajudar da melhor forma possível, mas preciso que a gente mantenha o respeito por aqui, combinado? 🤝\n\nSe houve algum problema com seu pedido ou se precisa resolver algo urgente, digite *0* para acessar o menu e depois a opção *5* para falar com a nossa equipe sobre sua sugestão ou reclamação.`;
      } else if (currentCount === 2) {
        reply = `Entendo que você possa estar chateado, mas não consigo continuar o atendimento com esse tipo de linguagem. Por favor, mantenha o respeito para que possamos resolver tudo da melhor forma. 🙏\n\nSe precisar registrar uma reclamação ou falar com um responsável, digite *0* e escolha a opção *5* no menu.`;
      } else {
        reply = `Como as ofensas continuaram (ou por envolver conduta que não toleramos na Explosão Açaí), estou encerrando o atendimento automático por aqui. Nossa equipe foi notificada e analisará a conversa assim que possível.`;
        needsTakeover = true;
      }

      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: needsTakeover,
        isProfanity: true,
        isSevere,
        profanityCount: currentCount
      };
    }

    this.profanityCount.delete(cleanPhone);

    // 2. REGRA GLOBAL DO "0" (OU COMANDO MENU)
    // Em qualquer etapa ativa do bot (inclusive se o cliente quiser sair da fila humana), se enviar "0", reseta estado_sessao = "MENU_PRINCIPAL" e reenvia o Menu Principal correspondente ao status atual de {loja_aberta}
    const isMenu = cleanText === '0' || cleanText === '0️⃣' || this.isMenuCommand(cleanText);
    if (isMenu) {
      session.estado_sessao = 'MENU_PRINCIPAL';
      const reply = this.renderMainMenu(ctx, effectiveName);
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        resetHumanTakeover: true,
        sendWithLogo: true
      };
    }

    // 3. SE O CLIENTE JÁ ESTÁ NA FILA HUMANA (BOT SILENCIOSO) E NÃO DIGITOU "0"
    if (session.estado_sessao === 'FILA_HUMANA_PAUSADO' || wasInHumanTakeover) {
      return {
        reply: null,
        needsHumanTakeover: true
      };
    }

    // 4. TRATAMENTO DO ESTADO: AGUARDANDO_DADOS_AGENDAMENTO (Seção 4.2 - Passo 2)
    if (session.estado_sessao === 'AGUARDANDO_DADOS_AGENDAMENTO') {
      session.estado_sessao = 'FILA_HUMANA_PAUSADO';
      if (wsHub && typeof wsHub.broadcast === 'function') {
        wsHub.broadcast({
          type: 'HUMAN_TAKEOVER_REQUESTED',
          payload: {
            phone: cleanPhone,
            customerName: effectiveName,
            tag: 'Agendamento',
            lastMessage: cleanText
          }
        });
      }
      const reply = `✅ *Solicitação de Agendamento Recebida!*

Assim que nossa equipe iniciar o turno *(às ${ctx.nextOpeningTime})*, vamos conferir seu pedido, confirmar o valor total com a taxa de entrega e enviar a confirmação aqui mesmo no seu WhatsApp! 🍧🚀

_Obrigado por escolher a Explosão Açaí!_`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: true,
        tag: 'Agendamento'
      };
    }

    // 5. TRATAMENTO DO ESTADO: SUBMENU_ATENDENTE (Seção 5 - Opção 5)
    if (session.estado_sessao === 'SUBMENU_ATENDENTE') {
      if (t === '1' || t === '1️⃣') {
        session.estado_sessao = 'FILA_HUMANA_PAUSADO';
        if (wsHub && typeof wsHub.broadcast === 'function') {
          wsHub.broadcast({
            type: 'HUMAN_TAKEOVER_REQUESTED',
            payload: {
              phone: cleanPhone,
              customerName: effectiveName,
              tag: 'Atendente',
              lastMessage: cleanText
            }
          });
        }
        let reply = '';
        if (ctx.isOpen) {
          reply = `👨‍💻 *Transferindo para um atendente...*

Aguarde só um instante! Um de nossos atendentes já vai te responder por aqui.

_(Digite *0* se quiser voltar para o robô)_`;
        } else {
          reply = `👨‍💻 *Mensagem encaminhada para a equipe!*

Deixe sua dúvida aqui abaixo. Como estamos fechados no momento *(abrimos às ${ctx.nextOpeningTime})*, nossa equipe vai te responder assim que iniciar o expediente!

_(Digite *0* se quiser voltar para o robô)_`;
        }
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return {
          reply,
          needsHumanTakeover: true
        };
      }

      if (t === '2' || t === '2️⃣') {
        session.estado_sessao = 'AGUARDANDO_OUVIDORIA';
        const reply = `📝 *Ouvidoria Explosão Açaí*

Sua opinião é muito importante! Escreva abaixo sua *sugestão, elogio ou reclamação* e envie:

_(Digite *0* para cancelar e voltar ao menu)_`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return {
          reply,
          needsHumanTakeover: false
        };
      }

      // Se enviou outra resposta no submenu, reexibe as opções
      const reply = `💬 *Atendimento Humano & Ouvidoria*

Escolha como deseja prosseguir:

1️⃣ - *Falar com um atendente* _(Dúvidas sobre pedidos, entregas ou cardápio)_
2️⃣ - *Enviar sugestão, elogio ou reclamação* _(Ouvidoria)_

_(Digite *0* para voltar ao menu)_`;
      return { reply, needsHumanTakeover: false };
    }

    // 6. TRATAMENTO DO ESTADO: AGUARDANDO_OUVIDORIA (Seção 5 - Ouvidoria)
    if (session.estado_sessao === 'AGUARDANDO_OUVIDORIA') {
      const isComp = this.isComplaintText(cleanText);
      const type = isComp ? 'reclamacao' : 'sugestao';
      const entry = this.saveFeedback({
        phone: cleanPhone,
        customerName: effectiveName,
        type,
        message: cleanText
      });
      session.estado_sessao = 'MENU_PRINCIPAL';
      const reply = `💜 *Mensagem registrada com sucesso!*

Agradecemos pelo seu feedback! Nossa gerência analisará sua mensagem com atenção.

_(Digite *0* para voltar ao menu principal)_`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        feedbackId: entry?.id
      };
    }

    // 7. TRATAMENTO DE ÁUDIO / FOTO / FIGURINHA FORA DOS SUBMENUS
    if (cleanText === '[MENSAGEM_DE_AUDIO]') {
      const reply = `Oi! Como sou o assistente virtual da *Explosão Açaí*, ainda não consigo ouvir áudios por aqui. 🎧\n\nSe puder digitar o que precisa, eu já te ajudo agora mesmo! Mas se preferir falar com alguém da nossa equipe para ouvir seu áudio, digite *5* no menu. 😊\n\n_(Digite *0* a qualquer momento para voltar ao menu)_`;
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isAudio: true };
    }
    if (cleanText === '[MENSAGEM_DE_FOTO]' || cleanText === '[MENSAGEM_DE_IMAGEM]' || cleanText === '[MENSAGEM_DE_DOCUMENTO]') {
      const reply = `Recebi sua imagem! 📸 Como sou um assistente virtual, não consigo visualizar fotos por aqui.\n\nSe for o *comprovante do seu PIX* ou algo sobre um pedido, pode aguardar um pouquinho que nossa equipe já vai conferir! Se precisar de outra coisa, é só escrever por aqui ou digitar *0* para voltar ao menu.`;
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isMedia: true };
    }
    if (cleanText === '[MENSAGEM_DE_FIGURINHA]') {
      const reply = `Recebi sua mensagem! Como posso te ajudar hoje? Digite *0* para ver nosso cardápio e opções!`;
      return { reply, needsHumanTakeover: false };
    }

    // 8. PROCESSAMENTO DO MENU PRINCIPAL

    // ---- FLUXO A: MODO LOJA ABERTA ({loja_aberta} == true) ----
    if (ctx.isOpen) {
      // Opção "1" — Fazer Pedido / Cardápio Digital (Seção 3.2)
      if (t === '1' || t === '1️⃣' || t === 'fazer pedido' || t === 'cardapio' || t === 'cardápio') {
        session.acessou_cardapio = true;
        session.cardapioAccessedAt = Date.now();
        const reply = `Perfeito! Monte seu copo do seu jeito no nosso cardápio digital 👇

🔗 *Acesse aqui:* ${ctx.publicUrl}

✅ *Pagamento fácil:* Aceitamos Pix, Cartão (crédito/débito) e Dinheiro na entrega.
🛵 *Entrega rápida* direto na sua porta!

_Assim que você finalizar o pedido por lá, ele já cai direto na nossa produção._

_(Digite *0* para voltar ao menu principal)_`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "2" — Combos & Promoções da Semana (Seção 3.2)
      if (t === '2' || t === '2️⃣' || t === 'combos' || t === 'promocoes' || t === 'promoções') {
        const reply = `🔥 *Destaques e Promoções da Explosão Açaí!*

Confira nossas ofertas especiais desta semana:
🎟️ *Cupom de Primeira Compra:* Use o código *EXPLOSAO10* no carrinho e ganhe 10% OFF!

👉 *Confira os combos ativos e peça agora:* ${ctx.publicUrl}

_(Digite *0* para voltar ao menu)_`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "3" — Rastrear meu Pedido (Seção 3.2)
      if (t === '3' || t === '3️⃣' || t === 'rastrear' || t === 'rastreio' || t === 'rastrear meu pedido') {
        const activeOrder = this.getActiveCustomerOrder(cleanPhone);
        let reply = '';
        if (activeOrder) {
          reply = `🛵 *Consultando seu pedido...*

📦 *Pedido #${activeOrder.orderNo || activeOrder.id}*
📍 *Status atual:* ${this.getFriendlyStatus(activeOrder.status)}
⏱️ *Previsão:* 25 a 35 minutos.

_(Digite *0* para voltar ao menu ou *5* se precisar falar com a gente)_`;
        } else {
          reply = `🛵 Não localizei nenhum pedido em andamento vinculado a este número no momento.

Se você pediu por outro telefone ou precisa de ajuda, digite *5* para falar com nossa equipe ou *0* para voltar ao menu!`;
        }
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "4" — Horário, Endereço e Pagamentos (PIX) (Seção 5)
      if (t === '4' || t === '4️⃣' || t === 'horario' || t === 'endereco' || t === 'pix') {
        const reply = this.renderSharedInfoMessage(ctx);
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "5" — Falar com Atendente / Ouvidoria (Seção 5)
      if (t === '5' || t === '5️⃣' || t === 'atendente' || t === 'ouvidoria') {
        session.estado_sessao = 'SUBMENU_ATENDENTE';
        const reply = `💬 *Atendimento Humano & Ouvidoria*

Escolha como deseja prosseguir:

1️⃣ - *Falar com um atendente* _(Dúvidas sobre pedidos, entregas ou cardápio)_
2️⃣ - *Enviar sugestão, elogio ou reclamação* _(Ouvidoria)_

_(Digite *0* para voltar ao menu)_`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "6" — Encerrar atendimento (Seção 5)
      if (t === '6' || t === '6️⃣' || t === 'encerrar' || t === 'fim') {
        session.estado_sessao = 'ENCERRADO';
        const reply = `Atendimento encerrado! 👋
Obrigado por entrar em contato com a *Explosão Açaí* 🍧. Quando bater aquela vontade, é só mandar um *Oi* por aqui!`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false, isSessionEnded: true };
      }
    }

    // ---- FLUXO B: MODO LOJA FECHADA ({loja_aberta} == false) ----
    if (!ctx.isOpen) {
      // Opção "1" — Agendar Pedido para Hoje (Seção 4.2)
      if (t === '1' || t === '1️⃣' || t === 'agendar' || t === 'agendamento' || t === 'agendar pedido') {
        session.estado_sessao = 'AGUARDANDO_DADOS_AGENDAMENTO';
        const reply = `⏰ *Agendamento de Pedido — Explosão Açaí*

Que ótima ideia! Vamos deixar seu pedido reservado para o horário que você quiser após a abertura *(a partir das ${ctx.nextOpeningTime})*.

👀 *Consulte os sabores e valores aqui:* ${ctx.publicUrl}

Agora, envie em *uma única mensagem* os dados abaixo:
1. *Seu pedido completo* _(tamanho do copo + adicionais)_
2. *Horário desejado para entrega/retirada* _(ex: 14h30)_
3. *Endereço completo* _(ou avise se vai retirar na loja)_
4. *Forma de pagamento* _(Pix, Cartão ou Dinheiro)_

_(Digite *0* para cancelar e voltar ao menu)_`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "2" — Ver Cardápio Digital (Preços e Sabores) (Seção 4.3)
      if (t === '2' || t === '2️⃣' || t === 'cardapio' || t === 'cardápio') {
        const reply = `Nossa loja está fechada no momento *(abrimos às ${ctx.nextOpeningTime})*, mas você já pode conferir todos os nossos sabores e valores no cardápio digital! 👇

🔗 *Acesse aqui:* ${ctx.publicUrl}

_(Digite *0* para voltar ao menu principal)_`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "3" — Combos & Promoções da Semana (Seção 4.3)
      if (t === '3' || t === '3️⃣' || t === 'combos' || t === 'promocoes' || t === 'promoções') {
        const reply = `🔥 *Destaques e Promoções da Explosão Açaí!*

Confira nossas ofertas e garanta já o seu agendamento:
🎟️ *Cupom de Primeira Compra:* Use o código *EXPLOSAO10* no carrinho e ganhe 10% OFF!

👉 *Consulte os combos ativos no cardápio:* ${ctx.publicUrl}

_(Digite *0* para voltar ao menu ou *1* para agendar seu pedido)_`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "4" — Horário, Endereço e Pagamentos (PIX) (Seção 5)
      if (t === '4' || t === '4️⃣' || t === 'horario' || t === 'endereco' || t === 'pix') {
        const reply = this.renderSharedInfoMessage(ctx);
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "5" — Falar com Atendente / Ouvidoria (Seção 5)
      if (t === '5' || t === '5️⃣' || t === 'atendente' || t === 'ouvidoria') {
        session.estado_sessao = 'SUBMENU_ATENDENTE';
        const reply = `💬 *Atendimento Humano & Ouvidoria*

Escolha como deseja prosseguir:

1️⃣ - *Falar com um atendente* _(Dúvidas sobre pedidos, entregas ou cardápio)_
2️⃣ - *Enviar sugestão, elogio ou reclamação* _(Ouvidoria)_

_(Digite *0* para voltar ao menu)_`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false };
      }

      // Opção "6" — Encerrar atendimento (Seção 5)
      if (t === '6' || t === '6️⃣' || t === 'encerrar' || t === 'fim') {
        session.estado_sessao = 'ENCERRADO';
        const reply = `Atendimento encerrado! 👋
Obrigado por entrar em contato com a *Explosão Açaí* 🍧. Quando bater aquela vontade, é só mandar um *Oi* por aqui!`;
        this.saveHistory(phone, 'user', cleanText);
        this.saveHistory(phone, 'assistant', reply);
        return { reply, needsHumanTakeover: false, isSessionEnded: true };
      }
    }

    // 9. SAUDAÇÕES PADRÃO (Oi, Olá, etc.) -> Envia o Menu Principal correspondente
    const greetings = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'e ai', 'e aí', 'opa', 'salve'];
    if (greetings.includes(t)) {
      const reply = this.renderMainMenu(ctx, effectiveName);
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, sendWithLogo: true };
    }

    // 10. DETECÇÃO ESPONTÂNEA DE RECLAMAÇÃO OU SUGESTÃO FORA DO MENU
    if (this.isComplaintText(cleanText)) {
      const entry = this.saveFeedback({ phone: cleanPhone, customerName: effectiveName, type: 'reclamacao', message: cleanText });
      const reply = `Sinto muito pelo ocorrido${effectiveName ? ` ${effectiveName}` : ''}! Peço sinceras desculpas pelo transtorno. Notifiquei a gerência no painel e nossa equipe vai te responder aqui em breve.\n\n_(Digite *0* a qualquer momento para voltar ao menu)_`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: true, feedbackId: entry?.id };
    }

    if (this.isSuggestionText(cleanText)) {
      const entry = this.saveFeedback({ phone: cleanPhone, customerName: effectiveName, type: 'sugestao', message: cleanText });
      const reply = `Muito obrigado pelo seu carinho e pela sua sugestão${effectiveName ? ` ${effectiveName}` : ''}! Já registrei sua mensagem para a nossa gerência!\n\n_(Digite *0* a qualquer momento para voltar ao menu)_`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, feedbackId: entry?.id };
    }

    // 10.5 PERGUNTA SOBRE DELIVERY / TAXA DE ENTREGA -> resposta padrão da loja
    if (this.isDeliveryQuestion(cleanText)) {
      const reply = this.buildDeliveryReply(ctx);
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // 11. FAQ APRENDIDA (BASE DE CONHECIMENTO)
    const learned = this.findLearnedKnowledge(cleanText);
    if (learned) {
      let reply = `*Explosão Açaí Informa:*\n\n${learned.answer}\n\n_(Digite *0* a qualquer momento para voltar ao menu)_`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // 12. ATENDIMENTO AVANÇADO COM GOOGLE GEMINI (COM MEMÓRIA E ATALHOS)
    if (this.client && this.apiKey) {
      try {
        const systemInstruction = `
Você é o Atendente Virtual Inteligente da Explosão Açaí (Franca - SP).
Seu tom de voz é caloroso, acolhedor, profissional, direto e sem poluição visual de emojis desnecessários.

INFORMAÇÕES OFICIAIS DA LOJA:
- Loja: ${ctx.storeName}
- Status: ${ctx.isOpen ? '🟢 Loja Aberta (Pedidos saindo agora!)' : `🔴 Loja Fechada (Abrimos às ${ctx.nextOpeningTime})`}
- Horários de Funcionamento:
${ctx.openingHoursFormatted}
- Endereço: ${ctx.address}
- Cardápio Digital: ${ctx.publicUrl}
- Formas de Pagamento: Pix (Chave CNPJ ${ctx.pixKey} - Favorecido: ${ctx.pixFavored}), Cartão de Crédito/Débito e Dinheiro (com troco). Sempre informe que a chave Pix é do tipo CNPJ.
- Taxa de Entrega: Até 2 km entrega grátis! De 2 km a 5 km taxa mínima de R$ 4,50. Acima de 5 km cobramos R$ 1,00 por km rodado. A taxa exata é calculada no cardápio digital antes de finalizar o pedido.
- Cupom ativo: Use EXPLOSAO10 para 10% OFF na primeira compra.

ATALHOS DO MENU:
O cliente pode digitar *0* a qualquer momento para ver o menu.
- Loja Aberta: 1: Cardápio, 2: Combos/Promoções, 3: Rastrear Pedido, 4: Informações/PIX, 5: Falar com Atendente / Ouvidoria, 6: Encerrar.
- Loja Fechada: 1: Agendar Pedido, 2: Ver Cardápio, 3: Combos/Promoções, 4: Informações/PIX, 5: Falar com Atendente / Ouvidoria, 6: Encerrar.

Responda com brevidade e simpatia à dúvida do cliente. Sempre finalize com:
_(Digite *0* a qualquer momento para voltar ao menu)_
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

    // 13. MOTOR INTELIGENTE LOCAL (CONTINGÊNCIA)
    const result = this.fallbackSmartRuleEngine(cleanText, ctx, effectiveName, cleanPhone);
    this.saveHistory(phone, 'user', cleanText);
    this.saveHistory(phone, 'assistant', result.reply);
    return result;
  }

  /**
   * Motor inteligente local de contingência
   */
  fallbackSmartRuleEngine(text, ctx, customerName, cleanPhone = '') {
    const t = text.toLowerCase().trim();
    const phoneToSave = cleanPhone || (ctx.phone || '').replace(/\D/g, '');
    const memory = ctx.clientMemory || this.getClientMemory(phoneToSave);
    const effectiveName = customerName || memory?.customerName || 'Cliente';

    // Pedido de cardápio
    if (t.includes('cardapio') || t.includes('cardápio')) {
      return {
        reply: `Acesse nosso *Cardápio Digital Completo* pelo link abaixo para montar seu açaí do seu jeito:\n👉 *${ctx.publicUrl}*\n\n_(Digite *0* a qualquer momento para voltar ao menu)_`,
        needsHumanTakeover: false
      };
    }

    // Rastreamento
    if (t.includes('rastrear') || t.includes('rastreio') || t.includes('cade meu pedido') || t.includes('cadê meu pedido')) {
      const activeOrder = this.getActiveCustomerOrder(phoneToSave);
      if (activeOrder) {
        return {
          reply: `🛵 *Consultando seu pedido...*\n\n📦 *Pedido #${activeOrder.orderNo || activeOrder.id}*\n📍 *Status atual:* ${this.getFriendlyStatus(activeOrder.status)}\n⏱️ *Previsão:* 25 a 35 minutos.\n\n_(Digite *0* para voltar ao menu ou *5* se precisar falar com a gente)_`,
          needsHumanTakeover: false
        };
      }
      return {
        reply: `🛵 Não localizei nenhum pedido em andamento vinculado a este número no momento.\n\nSe você pediu por outro telefone ou precisa de ajuda, digite *5* para falar com nossa equipe ou *0* para voltar ao menu!`,
        needsHumanTakeover: false
      };
    }

    // Combos / Promoções
    if (t.includes('combo') || t.includes('promo')) {
      return {
        reply: `🔥 *Destaques e Promoções da Explosão Açaí!*\n\nConfira nossas ofertas especiais desta semana:\n🎟️ *Cupom de Primeira Compra:* Use o código *EXPLOSAO10* no carrinho e ganhe 10% OFF!\n\n👉 *Confira os combos ativos e peça agora:* ${ctx.publicUrl}\n\n_(Digite *0* para voltar ao menu)_`,
        needsHumanTakeover: false
      };
    }

    // Horários / Endereço / PIX
    if (t.includes('horario') || t.includes('horário') || t.includes('endereco') || t.includes('endereço') || t.includes('pix')) {
      return {
        reply: this.renderSharedInfoMessage(ctx),
        needsHumanTakeover: false
      };
    }

    // Atendente
    if (t.includes('atendente') || t.includes('humano')) {
      if (!ctx.isOpen) {
        return {
          reply: `👨‍💻 *Mensagem encaminhada para a equipe!*\n\nDeixe sua dúvida aqui abaixo. Como estamos fechados no momento *(abrimos às ${ctx.nextOpeningTime})*, nossa equipe vai te responder assim que iniciar o expediente!\n\n_(Digite *0* se quiser voltar para o robô)_`,
          needsHumanTakeover: true
        };
      }
      return {
        reply: `👨‍💻 *Transferindo para um atendente...*\n\nAguarde só um instante! Um de nossos atendentes já vai te responder por aqui.\n\n_(Digite *0* se quiser voltar para o robô)_`,
        needsHumanTakeover: true
      };
    }

    // Fallback padrão amigável
    return {
      reply: `Ops! Acho que não consegui entender essa mensagem por aqui. 😅\n\nComo sou um assistente virtual, às vezes preciso de uma ajudinha. Tente escrever com outras palavras o que você precisa ou digite *0* para voltar ao menu principal da *Explosão Açaí*! 🍧`,
      needsHumanTakeover: false,
      isFallback: true
    };
  }

  /**
   * Gera texto promocional semanal persuasivo com IA para disparo aos clientes (sem excesso de emojis)
   * Suporta tanto produtos tradicionais quanto combos completos (com composição real, descrição e preço)
   */
  async generateWeeklyPromotionText({ productName = '', discount = '', couponCode = '', productDetails = null } = {}) {
    const ctx = this.buildLiveContext();
    const publicUrl = ctx.publicUrl;

    const isCombo = Boolean(productDetails?.isCombo);
    const displayName = productDetails?.name || productName;
    const composition = productDetails?.composition || '';
    const description = productDetails?.description || '';
    const priceStr = productDetails?.priceStr || '';

    if (this.client && this.apiKey) {
      try {
        let offerDetails = `- ${isCombo ? 'Combo em Destaque' : 'Produto em Destaque'}: ${displayName || 'Nossos Combos e Copos Especiais'}`;
        if (isCombo && composition) {
          offerDetails += `\n- Composição real do Combo: ${composition}`;
        }
        if (description) {
          offerDetails += `\n- Detalhes/Descrição: ${description}`;
        }
        if (priceStr) {
          offerDetails += `\n- Preço: ${priceStr}`;
        }
        offerDetails += `\n- Cupom / Desconto: ${couponCode ? `Cupom ${couponCode}` : (discount || 'Desconto exclusivo')}`;
        offerDetails += `\n- Link da loja: ${publicUrl}`;

        const prompt = `
Crie uma mensagem promocional curta, direta e atraente para envio no WhatsApp da "Explosão Açaí".
Detalhes da oferta:
${offerDetails}

Regras:
1. Comece com uma saudação educada e simpática.
2. ${isCombo ? 'Destaque que é um Combo especial exclusivo da casa, mencionando a sua composição deliciosa.' : 'Destaque o produto de forma apetitosa.'}
3. Seja elegante e direto. Não use excesso de emojis (no máximo 1 ou nenhum).
4. Mantenha no máximo 4 a 5 linhas.
5. Inclua chamada para ação com o link da loja.
6. Termine com nota legal: "(Caso não queira mais receber nossas ofertas, digite 'sair')".
        `.trim();

        const response = await this.client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { temperature: 0.7, maxOutputTokens: 300 }
        });

        return response.text || '';
      } catch (e) {}
    }

    // Fallback padrão se Gemini não estiver configurado ou offline
    const itemStr = displayName
      ? (isCombo ? `o combo *${displayName}*${composition ? ` (${composition})` : ''}` : `o delicioso *${displayName}*`)
      : 'nossos melhores copos e combos';
    const couponStr = couponCode ? `Use o cupom *${couponCode}* e aproveite!` : 'Aproveite nossa promoção especial!';

    return `Olá! Passando para compartilhar uma oferta especial da *Explosão Açaí*!\n\nQue tal pedir hoje ${itemStr}? ${couponStr}\n\nPeça agora com entrega rápida:\n${publicUrl}\n\n_(Caso não queira mais receber novidades da loja, basta responder 'sair')_`;
  }
}

export const geminiAssistantService = new GeminiAssistantService();
