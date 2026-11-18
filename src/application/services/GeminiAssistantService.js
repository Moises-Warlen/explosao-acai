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
   * Renderiza a resposta formatada do Menu Principal (estilo limpo, elegante e sem excesso de emojis)
   */
  renderMainMenu(ctx, customerName, isReactivated = false) {
    this.stats.menuRequests++;
    const nameStr = customerName ? ` ${customerName}` : '';
    const reactivationNotice = isReactivated ? '*Atendimento automático do bot reativado!*\n\n' : '';

    // Mensagem cordial quando a loja estiver fechada
    if (!ctx.isOpen) {
      return `${reactivationNotice}*Olá${nameStr}! No momento nossa cozinha está descansando.*
Nosso horário de funcionamento é: *${ctx.openingHours}*.

fique super à vontade! Continuo online por aqui para:
• Tirar qualquer dúvida sobre sabores, adicionais, frutas e tamanhos de copos!
• Te informar sobre valores de frete, lactose, veganos e entrega
• Registrar sua sugestão ou reclamação para a gerência

*Você já pode ir montando seu açaí no cardápio digital:*
${ctx.publicUrl}

1. Cardápio Digital Completo
2. Rastrear meu Pedido
3. Combos & Promoções da Semana
4. Horário de Funcionamento & Endereço
5. Falar com um Atendente Humano
6. Enviar Sugestão ou Reclamação (Ouvidoria)

_Dica: Digite *menu* ou *0* a qualquer momento para voltar aqui!_`;
    }

    return `${reactivationNotice}*Menu Principal — Explosão Açaí*
*Status:* Loja Aberta e Entregando

Olá${nameStr}! Como posso te ajudar hoje?${ctx.customerPrefGreeting ? '\n' + ctx.customerPrefGreeting : ''}

1. *Cardápio Digital Completo:*
${ctx.publicUrl}
_(Monte seu açaí, escolha acompanhamentos e pague no Pix ou Cartão)_

2. Rastrear meu Pedido
3. Combos & Promoções da Semana
4. Horário de Funcionamento & Endereço
5. Falar com um Atendente Humano
6. Enviar Sugestão ou Reclamação (Ouvidoria)

_Dica: Digite *menu* ou *0* a qualquer momento para voltar aqui!_`;
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

    const publicUrl = process.env.BASE_URL || 'http://localhost:3000';

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
      customerPrefGreeting
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

    // 0. DIREITO AO ESQUECIMENTO (LGPD - ART. 18)
    const forgetKeywords = ['esquecer', 'apagar dados', 'limpar dados', 'limpar historico', 'limpar histórico', 'esquecer meus dados', 'privacidade lgpd'];
    if (forgetKeywords.some(k => t === k || t.includes(k))) {
      this.clearHistory(phone);
      this.pendingFeedbackSessions.delete(cleanPhone);
      const reply = `*Privacidade & LGPD — Explosão Açaí*\n\nSeus dados de histórico e preferências temporárias de atendimento foram totalmente apagados da nossa memória em estrita conformidade com a LGPD!\n\nSeus direitos de privacidade são respeitados com total rigor. Quando quiser nos chamar novamente, estaremos à disposição.\n\n_Digite *menu* para ver opções._`;
      return {
        reply,
        needsHumanTakeover: false,
        isForget: true
      };
    }

    // Retorno ao Menu Principal (cancela sessão pendente de ouvidoria se houver e reativa bot se estava em transbordo)
    if (this.isMenuCommand(cleanText)) {
      this.pendingFeedbackSessions.delete(cleanPhone);
      const reply = this.renderMainMenu(ctx, customerName, wasInHumanTakeover);
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        resetHumanTakeover: wasInHumanTakeover,
        sendWithLogo: true
      };
    }

    // 0.1 TRATAMENTO DE SESSÃO ATIVA DE OUVIDORIA (Cliente escolheu opção 6 anteriormente e agora enviou texto ou áudio)
    if (this.pendingFeedbackSessions.has(cleanPhone)) {
      const session = this.pendingFeedbackSessions.get(cleanPhone);
      const isExpired = session && session.timestamp && (Date.now() - session.timestamp > 15 * 60 * 1000);

      if (!isExpired) {
        this.pendingFeedbackSessions.delete(cleanPhone);

        // Cliente enviou áudio na Ouvidoria ("eu falei e nao gravou")
        if (cleanText === '[MENSAGEM_DE_AUDIO]') {
          const entry = this.saveFeedback({
            phone: cleanPhone,
            customerName,
            type: 'reclamacao',
            message: '[Áudio gravado pelo cliente no WhatsApp - Ouvidoria]'
          });
          const reply = `Recebi seu áudio na Ouvidoria${customerName ? ` ${customerName}` : ''}. Sua mensagem foi gravada com sucesso no sistema (Protocolo #${entry?.id || 'OK'}).\n\nEstou transferindo para nossa equipe humana ouvir sua gravação e te dar o retorno imediato. Por favor, aguarde só um momento.`;
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
          customerName,
          type,
          message: cleanText
        });

        if (type === 'reclamacao') {
          const reply = `Sinto muito pelo ocorrido${customerName ? ` ${customerName}` : ''}. Registrei sua reclamação no sistema (Protocolo #${entry?.id || 'OK'}). A gerência foi notificada e nossa equipe humana vai assumir este atendimento agora mesmo para te ajudar.`;
          this.saveHistory(phone, 'user', cleanText);
          this.saveHistory(phone, 'assistant', reply);
          return {
            reply,
            needsHumanTakeover: true,
            feedbackId: entry?.id
          };
        } else {
          const reply = `Muito obrigado pelo seu carinho e pela sua sugestão${customerName ? ` ${customerName}` : ''}! Registrei sua mensagem no sistema com sucesso (Protocolo #${entry?.id || 'OK'}) e já encaminhei para a gerência.\n\n_Digite *menu* para ver opções._`;
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

    // 0.2 TRATAMENTO DE ÁUDIO ENVIADO PELO CLIENTE FORA DA OUVIDORIA
    if (cleanText === '[MENSAGEM_DE_AUDIO]') {
      const reply = `Olá${customerName ? ` ${customerName}` : ''}! Recebi seu áudio. No momento nosso assistente virtual do delivery lê mensagens em texto. Se puder digitar sua dúvida ou pedido, te respondo prontamente!\n\n*Cardápio Digital:* ${ctx.publicUrl}\n\n_Para falar com atendente humano, digite *5* ou *humano*._`;
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isAudio: true };
    }

    // 0.3 TRATAMENTO DE FOTO / COMPROVANTE PIX / DOCUMENTO
    if (cleanText === '[MENSAGEM_DE_FOTO]' || cleanText === '[MENSAGEM_DE_DOCUMENTO]') {
      const reply = `Recebi seu arquivo/foto. Se for um comprovante de pagamento Pix, nosso time do caixa já está conferindo no sistema para liberar seu pedido!\n\nSe for uma dúvida, você pode digitar aqui em texto que te ajudo na hora!\n\n*Cardápio Digital:* ${ctx.publicUrl}\n\n_Digite *menu* para ver opções ou *5* para falar com um atendente humano._`;
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isMedia: true };
    }

    // 0.4 TRATAMENTO DE FIGURINHA
    if (cleanText === '[MENSAGEM_DE_FIGURINHA]') {
      const reply = `Recebi sua mensagem! Como posso te ajudar hoje? Digite *menu* para ver nosso cardápio e opções!`;
      return { reply, needsHumanTakeover: false };
    }

    // 1. FILTRO DE PALAVRÕES, OFENSAS E CONTEÚDO IMPRÓPRIO
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

      const reply = `Olá${customerName ? ` ${customerName}` : ''}! Prezamos por um atendimento respeitoso e harmonioso para todos os nossos clientes e atendentes.\n\nPedimos gentilmente que evite o uso de termos ofensivos. Como posso te ajudar com o cardápio ou seu pedido hoje?\n\n_Dica: Digite *menu* para ver as opções._`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: false,
        isProfanity: true
      };
    }

    // 2. OPÇÃO 6 OU FEEDBACK / SUGESTÃO / RECLAMAÇÃO (OUVIDORIA)
    const isOuvidoriaCommand = t === '6' || t === 'ouvidoria' || t === 'feedback' || t === 'reclamacao' || t === 'reclamação' || t === 'sugestao' || t === 'sugestão' || t === 'ouvidoria e feedback';
    if (isOuvidoriaCommand) {
      this.pendingFeedbackSessions.set(cleanPhone, { timestamp: Date.now(), customerName });
      const reply = `*Ouvidoria & Feedback — Explosão Açaí*\n\nA sua opinião é fundamental para nós! Pode digitar ou enviar áudio com sua *sugestão*, *elogio* ou *reclamação*, que nosso sistema registra diretamente para a gerência.\n\nSe for um problema com seu pedido, nossa equipe humana já assume para te ajudar! Como podemos te ouvir hoje?\n\n_Digite *menu* para voltar._`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, isFeedbackPrompt: true };
    }

    // Detecção espontânea de sugestão ou elogio do cliente
    if (this.isSuggestionText(cleanText)) {
      const entry = this.saveFeedback({ phone: cleanPhone, customerName, type: 'sugestao', message: cleanText });
      const reply = `Muito obrigado pelo seu carinho e pela sua sugestão${customerName ? ` ${customerName}` : ''}! A sua opinião é muito valiosa para continuarmos melhorando a cada dia. Já registrei sua mensagem para a nossa gerência e equipe!\n\n_Digite *menu* para ver outras opções._`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false, feedbackId: entry?.id };
    }

    // Detecção espontânea de reclamação explícita do cliente
    if (this.isComplaintText(cleanText)) {
      const entry = this.saveFeedback({ phone: cleanPhone, customerName, type: 'reclamacao', message: cleanText });
      const reply = `Sinto muito pelo ocorrido${customerName ? ` ${customerName}` : ''}! Peço sinceras desculpas pelo transtorno. Nós levamos a qualidade do seu atendimento muito a sério. Notifiquei a gerência e o responsável da loja no painel e alguém da nossa equipe vai assumir este chat agora mesmo para te ajudar!`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: true, feedbackId: entry?.id };
    }

    // 3. CONSULTA À BASE DE APRENDIZADO DA IA (FAQ APRENDIDA)
    const learned = this.findLearnedKnowledge(cleanText);
    if (learned) {
      let reply = `*Explosão Açaí Informa:*\n\n${learned.answer}`;
      if (!ctx.isOpen) {
        reply += `\n\n*(Lembrando que nossa cozinha está fechada no momento e abre às ${ctx.openingHours}, mas você já pode ir escolhendo o seu favorito!)*`;
      } else {
        reply += `\n\n*Monte seu açaí no cardápio digital:* ${ctx.publicUrl}\n\n_Digite *menu* para mais opções._`;
      }
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // 4. DETECÇÃO DE PEDIDO EXPLÍCITO DE ATENDENTE HUMANO
    const humanKeywords = ['atendente', 'humano', 'falar com pessoa', 'gerente', 'falar com alguem', 'pessoa real', '5'];
    if (humanKeywords.some(k => t === k || t.includes(k))) {
      const reply = `Entendido${customerName ? `, ${customerName}` : ''}! Estou transferindo você para um de nossos atendentes humanos agora mesmo. Por favor, aguarde só um momento que já vamos te responder por aqui!\n\n_Se quiser voltar ao atendimento automático, basta digitar *menu*._`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: true
      };
    }

    // 5. ATENDIMENTO AVANÇADO COM GOOGLE GEMINI 2.0 FLASH (COM MEMÓRIA CONVERSACIONAL)
    if (this.client && this.apiKey) {
      try {
        const systemInstruction = `
Você é a atendente virtual oficial e consultora da "Explosão Açaí", delivery em Franca - SP.
Seu objetivo é encantar o cliente, tirar dúvidas com simpatia, sugerir produtos e orientar no pedido.

INFORMAÇÕES REAIS DO ESTABELECIMENTO EM TEMPO REAL:
- Loja: ${ctx.storeName}
- Status: ${ctx.isOpen ? 'ABERTA AGORA! Recebendo pedidos normalmente.' : 'FECHADA NO MOMENTO (Atenção: responda todas as dúvidas do cliente com gentileza, explicando que a cozinha está descansando e abre às ' + ctx.openingHours + ')'}
- Horário de Funcionamento: ${ctx.openingHours}
- Endereço: ${ctx.address}
- Link do Cardápio Digital Oficial: ${ctx.publicUrl}
- Cupons Ativos: ${ctx.couponList}

BASE DE CONHECIMENTO & APRENDIZADO DA IA:
${ctx.knowledgeSummary}

PREFERÊNCIAS DE CONSUMO DO CLIENTE (MEMÓRIA LGPD):
${ctx.customerPrefGreeting || 'Nenhum pedido anterior registrado.'}

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
1. Mantenha um tom limpo, profissional, prestativo e direto ao ponto. NUNCA use emojis em excesso ou repetidos (NUNCA envie 🍇, 💳, 📲, ✨). Use no máximo 0 a 1 emoji simples e discreto por mensagem apenas se absolutamente necessário.
2. Se a loja estiver FECHADA: acolha o cliente com simpatia, responda todas as perguntas sobre o cardápio e avise que quando a loja abrir às ${ctx.openingHours} ele já pode enviar o pedido pelo link.
3. Se perguntarem sobre lactose/vegano: o açaí puro não contém lactose nem glúten. Sugira montar com frutas, paçoca e granola tradicional sem leite.
4. Se perguntarem sobre status de entrega: informe o status exato e o entregador com base no STATUS DE PEDIDO acima.
5. Sempre que fizer sentido, envie o link do Cardápio Digital (${ctx.publicUrl}) para o cliente finalizar.
6. Sempre inclua ao final de forma sutil: "_Digite *menu* para ver as opções._"
7. Se o cliente fizer uma pergunta muito específica, técnica ou que você NÃO saiba responder com absoluta certeza, NUNCA invente dados: peça desculpas com simpatia, diga que está chamando a equipe e conclua com o código: [ACTION:CALL_HUMAN].
8. Se o cliente demonstrar insatisfação grave (pedido errado, derretido, atraso excessivo), peça desculpas sinceras, diga que acionou o gerente e finalize com o código: [ACTION:CALL_HUMAN].
        `.trim();

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

        // Se a IA detectou que precisa chamar humano por reclamação, garante gravação no banco
        if (needsHuman && this.isComplaintText(cleanText)) {
          this.saveFeedback({ phone: cleanPhone, customerName, type: 'reclamacao', message: cleanText });
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
    const result = this.fallbackSmartRuleEngine(cleanText, ctx, customerName, cleanPhone);
    this.saveHistory(phone, 'user', cleanText);
    this.saveHistory(phone, 'assistant', result.reply);
    return result;
  }

  /**
   * Motor inteligente local de contingência (com tom limpo, profissional e sem poluição de emojis)
   */
  fallbackSmartRuleEngine(text, ctx, customerName, cleanPhone = '') {
    const t = text.toLowerCase();
    const nameStr = customerName ? ` ${customerName}` : '';
    const phoneToSave = cleanPhone || (ctx.phone || '').replace(/\D/g, '');
    const closedReminder = !ctx.isOpen ? `\n\n*(Lembrando que nossa cozinha está fechada no momento e abre às ${ctx.openingHours}, mas você já pode ir escolhendo o seu favorito!)*` : '';

    // Opção 1 ou Rastreio de Pedido
    if (t === '1' || t.includes('pedido') || t.includes('rastrear') || t.includes('onde ta') || t.includes('cade') || t.includes('cadê') || t.includes('demorando')) {
      return {
        reply: `*Status do seu Pedido:*\n\n${ctx.orderStatusText}\n\nAcompanhe o pedido ou monte um novo copo:\n${ctx.publicUrl}\n\n_Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 2 ou Produtos / Preços / Sabores
    if (t === '2' || t.includes('preco') || t.includes('preço') || t.includes('quanto custa') || t.includes('sabores') || t.includes('cardapio') || t.includes('cardápio') || t.includes('tamanhos') || t.includes('copos')) {
      return {
        reply: `*Destaques do nosso Cardápio:*\n\n${ctx.productsSummary.split('\n').slice(0, 4).join('\n')}\n\n*Confira todos os tamanhos, adicionais e combos no cardápio digital:*\n${ctx.publicUrl}${closedReminder}\n\n_Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 3 ou Promoções / Cupons
    if (t === '3' || t.includes('promo') || t.includes('combo') || t.includes('desconto') || t.includes('cupom')) {
      return {
        reply: `*Promoções & Cupons Ativos:*\n\n*Cupons Disponíveis:* ${ctx.couponList}\n\nTemos combos especiais com preços promocionais no cardápio!\nAcesse: ${ctx.publicUrl}${closedReminder}\n\n_Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 4 ou Horários / Endereço / Onde fica
    if (t === '4' || t.includes('horario') || t.includes('horário') || t.includes('onde fica') || t.includes('endereco') || t.includes('endereço') || t.includes('localizacao') || t.includes('localização')) {
      return {
        reply: `*Nossa Localização & Horários:*\n\n*Endereço:* ${ctx.address}\n*Horário:* ${ctx.openingHours}\n\nPeça online pelo delivery: ${ctx.publicUrl}${closedReminder}\n\n_Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Dúvidas de Ingredientes / Lactose / Vegano
    if (t.includes('leite') || t.includes('lactose') || t.includes('vegano') || t.includes('intolerante') || t.includes('puro') || t.includes('ingredientes')) {
      return {
        reply: `*Nosso Açaí é 100% Puro & Natural!*\n\nNão contém leite, lactose nem glúten em sua base tradicional. Se você tiver intolerância, recomendamos pedir com frutas frescas, paçoca e granola tradicional sem leite!${closedReminder}\n\nMonte do seu jeito: ${ctx.publicUrl}\n\n_Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Dúvidas de Entrega / Bairros / Frete
    if (t.includes('entrega') || t.includes('frete') || t.includes('taxa') || t.includes('distancia') || t.includes('distância')) {
      return {
        reply: `*Entregas em toda Franca - SP!*\n\nCobrimos até 25km de distância da loja com frete a partir de R$ 4,50. Você pode colocar seu endereço direto no cardápio digital para calcular o frete exato:\n${ctx.publicUrl}${closedReminder}\n\n_Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Reclamação ou problema com gravação garantida em db.feedbacks
    if (this.isComplaintText(t) || t.includes('errado') || t.includes('derretido') || t.includes('faltou') || t.includes('reclamar') || t.includes('ruim') || t.includes('cancelar')) {
      this.saveFeedback({ phone: phoneToSave, customerName, type: 'reclamacao', message: text });
      return {
        reply: `Sinto muito pelo ocorrido${nameStr}! Peço sinceras desculpas pelo transtorno. Nós levamos a qualidade do seu atendimento muito a sério. Notifiquei a gerência no painel e alguém da nossa equipe vai assumir este chat agora mesmo para te ajudar!`,
        needsHumanTakeover: true
      };
    }

    // Saudações comuns ou intenção inicial de pedir
    const isGreetingOrOrderIntent = /^(oi|ola|olá|bom dia|boa tarde|boa noite|quero pedir|quero açaí|quero acai)\b/i.test(t) ||
      t.includes('boa noite') || t.includes('bom dia') || t.includes('boa tarde') || t.includes('quero pedir') || t.includes('fazer pedido') || t === 'oi' || t === 'ola' || t === 'olá';

    if (isGreetingOrOrderIntent && !t.includes('?')) {
      const greeting = !ctx.isOpen
        ? `Olá${nameStr}! No momento nossa cozinha está descansando (abrimos às *${ctx.openingHours}*), mas continuo por aqui para tirar qualquer dúvida sobre o cardápio ou te ajudar a escolher o açaí ideal da *Explosão Açaí*!\n\n*Acesse nosso cardápio digital:* \n${ctx.publicUrl}\n\n_Digite *menu* para ver todas as opções!_`
        : `Oi${nameStr}! Bem-vindo à *Explosão Açaí*! Como posso te ajudar hoje?\n\n*Para ver o cardápio e fazer seu pedido, acesse:* \n${ctx.publicUrl}\n\n_Digite *menu* para ver todas as opções disponíveis!_`;

      return {
        reply: greeting,
        needsHumanTakeover: false
      };
    }

    // DÚVIDA NÃO RECONHECIDA OU ESPECÍFICA: TRANSFERE PARA ATENDENTE HUMANO
    const isQuestionOrComplex = t.includes('?') || t.includes('como') || t.includes('qual') || t.includes('onde') || t.includes('quando') || t.includes('aceita') || t.includes('parceria') || t.includes('trabalhar') || t.includes('vaga') || t.length > 20;
    if (isQuestionOrComplex) {
      return {
        reply: `Essa é uma dúvida bem específica e quero te dar a resposta correta com certeza. Por isso, estou chamando um atendente humano da nossa equipe agora mesmo para te responder por aqui. Aguarde só um instante!\n\n_Se quiser ver o cardápio enquanto isso, digite *menu*._`,
        needsHumanTakeover: true
      };
    }

    // Saudação padrão sóbria
    const closedGreeting = !ctx.isOpen
      ? `Olá${nameStr}! No momento nossa cozinha está descansando (abrimos às *${ctx.openingHours}*), mas continuo por aqui para tirar qualquer dúvida sobre o cardápio ou te ajudar a escolher o seu pedido!\n\n*Acesse nosso cardápio digital:* \n${ctx.publicUrl}\n\n_Digite *menu* para ver todas as opções!_`
      : `Oi${nameStr}! Como posso te ajudar hoje?\n\n*Para ver o cardápio e fazer seu pedido, acesse:* \n${ctx.publicUrl}\n\n_Digite *menu* para ver todas as opções disponíveis!_`;

    return {
      reply: closedGreeting,
      needsHumanTakeover: false
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
