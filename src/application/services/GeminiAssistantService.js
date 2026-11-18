import { GoogleGenAI } from '@google/genai';
import { catalogService } from './CatalogService.js';
import { orderService } from './OrderService.js';
import { storeService } from './StoreService.js';
import { couponService } from './CouponService.js';
import { freightService } from './FreightService.js';
import { db } from '../../infrastructure/database/JsonDatabase.js';

class GeminiAssistantService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.client = null;
    this.history = new Map(); // Memória de curto prazo por telefone: Map<phone, Array<{role, text}>>
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
      db.saveLocal();
      return entry;
    } catch (e) {
      console.warn('[Gemini] Erro ao registrar feedback:', e.message);
      return null;
    }
  }

  /**
   * Renderiza a resposta formatada do Menu Principal
   */
  renderMainMenu(ctx, customerName, isReactivated = false) {
    this.stats.menuRequests++;
    const nameStr = customerName ? ` ${customerName}` : '';
    const reactivationNotice = isReactivated ? '🔄 *Atendimento automático do bot reativado!*\n\n' : '';

    // Mensagem calorosa, acolhedora e agradável quando a loja estiver fechada
    if (!ctx.isOpen) {
      return `${reactivationNotice}🌙 *Olá${nameStr}! No momento nossa cozinha está descansando.* 😴✨
Nosso horário de funcionamento é: *${ctx.openingHours}*.

🍧 *Mas fique super à vontade!* Continuo 100% online por aqui para:
• Tirar qualquer dúvida sobre sabores, adicionais, frutas e tamanhos de copos!
• Te informar sobre valores de frete, lactose, veganos e entrega
• Registrar sua sugestão ou reclamação para a gerência
👉 *Você já pode ir montando seu açaí no cardápio digital:*
👉 ${ctx.publicUrl}

🛵 *2️⃣ Rastrear meu Pedido*
🍧 *3️⃣ Combos & Promoções da Semana*
📍 *4️⃣ Horário de Funcionamento & Endereço*
👤 *5️⃣ Falar com um Atendente Humano*
📝 *6️⃣ Enviar Sugestão ou Reclamação (Ouvidoria)*

💡 _Dica: Digite *menu* ou *0* a qualquer momento para voltar aqui!_`;
    }

    return `${reactivationNotice}🍇 *Menu Principal — Explosão Açaí* 🍇
🟢 *Loja Aberta e Entregando a Todo Vapor!* 🛵💨

Olá${nameStr}! Como posso te ajudar hoje?${ctx.customerPrefGreeting ? '\n' + ctx.customerPrefGreeting : ''}

📱 *1️⃣ Cardápio Digital Completo:*
👉 ${ctx.publicUrl}
_(Monte seu açaí, escolha acompanhamentos e pague no Pix ou Cartão)_

🛵 *2️⃣ Rastrear meu Pedido*
🍧 *3️⃣ Combos & Promoções da Semana*
📍 *4️⃣ Horário de Funcionamento & Endereço*
👤 *5️⃣ Falar com um Atendente Humano*
📝 *6️⃣ Enviar Sugestão ou Reclamação (Ouvidoria)*

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
            customerPrefGreeting = `✨ *Que bom ter você de volta!* Vai querer seu copo de *${favoriteSize}ml* de costume ou quer experimentar uma novidade hoje?`;
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
    const ctx = this.buildLiveContext(phone);

    // 0. DIREITO AO ESQUECIMENTO (LGPD - ART. 18)
    const forgetKeywords = ['esquecer', 'apagar dados', 'limpar dados', 'limpar historico', 'limpar histórico', 'esquecer meus dados', 'privacidade lgpd'];
    if (forgetKeywords.some(k => t === k || t.includes(k))) {
      this.clearHistory(phone);
      const reply = `🔒 *Privacidade & LGPD — Explosão Açaí*\n\nSeus dados de histórico e preferências temporárias de atendimento foram totalmente apagados da nossa memória em estrita conformidade com a LGPD!\n\nSeus direitos de privacidade são respeitados com total rigor. Quando quiser nos chamar novamente, estaremos por aqui! 🍇\n\n💡 _Digite *menu* para ver opções._`;
      return {
        reply,
        needsHumanTakeover: false,
        isForget: true
      };
    }

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

    // 2. COMANDO DE VOLTAR AO MENU PRINCIPAL (COM ENVIO DA LOGO)
    if (this.isMenuCommand(cleanText)) {
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

    // 3. OPÇÃO 6 OU FEEDBACK / SUGESTÃO / RECLAMAÇÃO (OUVIDORIA)
    if (t === '6' || t === 'ouvidoria' || t === 'feedback') {
      const reply = `📝 *Ouvidoria & Feedback — Explosão Açaí* 🍇\n\nA sua opinião é fundamental para nós! Se você tiver uma *sugestão*, *elogio* ou *reclamação*, pode digitar aqui mesmo que nosso sistema registra diretamente para a gerência.\n\nE se for um problema com seu pedido, nossa equipe humana já assume para te ajudar! Como podemos te ouvir hoje?\n\n💡 _Digite *menu* para voltar._`;
      return { reply, needsHumanTakeover: false, isFeedbackPrompt: true };
    }

    // Detecção de sugestão ou elogio do cliente
    if (t.includes('sugiro') || t.includes('sugestão') || t.includes('sugestao') || t.includes('parabens') || t.includes('parabéns') || t.includes('adorei') || t.includes('minha sugestao') || t.includes('minha sugestão') || t.includes('gostaria que tivessem')) {
      this.saveFeedback({ phone, customerName, type: 'sugestao', message: cleanText });
      const reply = `Muito obrigado pelo seu carinho e pela sua sugestão${customerName ? ` ${customerName}` : ''}! 💜 A sua opinião é muito valiosa para continuarmos melhorando a cada dia. Já registrei sua mensagem para a nossa gerência e equipe! ✨\n\n💡 _Digite *menu* para ver outras opções._`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // Detecção de reclamação explícita do cliente
    if (t.includes('reclamacao') || t.includes('reclamação') || t.includes('reclamar') || t.includes('pessimo') || t.includes('péssimo') || t.includes('errado') || t.includes('derretido') || t.includes('faltou') || t.includes('ruim') || t.includes('cancelar')) {
      this.saveFeedback({ phone, customerName, type: 'reclamacao', message: cleanText });
      const reply = `Sinto muito pelo ocorrido${customerName ? ` ${customerName}` : ''}! Peço sinceras desculpas pelo transtorno. 😔 Nós levamos a qualidade do seu açaí muito a sério. Já notifiquei a gerência e o responsável da loja no painel e alguém da nossa equipe vai assumir este chat agora mesmo para te ajudar!`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: true };
    }

    // 4. CONSULTA À BASE DE APRENDIZADO DA IA (FAQ APRENDIDA)
    const learned = this.findLearnedKnowledge(cleanText);
    if (learned) {
      let reply = `💡 *Explosão Açaí Informa:*\n\n${learned.answer}`;
      if (!ctx.isOpen) {
        reply += `\n\n🌙 *(Lembrando que nossa cozinha está fechada no momento e abre às ${ctx.openingHours}, mas você já pode ir escolhendo o seu favorito!)* 🍇`;
      } else {
        reply += `\n\n📱 *Monte seu açaí no cardápio digital:* ${ctx.publicUrl}\n\n💡 _Digite *menu* para mais opções._`;
      }
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return { reply, needsHumanTakeover: false };
    }

    // 5. DETECÇÃO DE PEDIDO EXPLÍCITO DE ATENDENTE HUMANO
    const humanKeywords = ['atendente', 'humano', 'falar com pessoa', 'gerente', 'falar com alguem', 'pessoa real', '5'];
    if (humanKeywords.some(k => t === k || t.includes(k))) {
      const reply = `Entendido${customerName ? `, ${customerName}` : ''}! 👤 Estou transferindo você para um de nossos atendentes humanos agora mesmo. Por favor, aguarde só um momento que já vamos te responder por aqui!\n\n💡 _Se quiser voltar ao atendimento automático, basta digitar *menu*._`;
      this.saveHistory(phone, 'user', cleanText);
      this.saveHistory(phone, 'assistant', reply);
      return {
        reply,
        needsHumanTakeover: true
      };
    }

    // 6. ATENDIMENTO AVANÇADO COM GOOGLE GEMINI 2.0 FLASH (COM MEMÓRIA CONVERSACIONAL)
    if (this.client && this.apiKey) {
      try {
        const systemInstruction = `
Você é a atendente virtual oficial e consultora de açaí da "Explosão Açaí", delivery em Franca - SP.
Seu objetivo é encantar o cliente, tirar dúvidas com simpatia, sugerir produtos (venda ativa / upsell) e orientar no pedido.

INFORMAÇÕES REAIS DO ESTABELECIMENTO EM TEMPO REAL:
- Loja: ${ctx.storeName}
- Status: ${ctx.isOpen ? 'ABERTA AGORA! 🟢 Recebendo pedidos.' : 'FECHADA NO MOMENTO 🔴 (Atenção: responda todas as dúvidas do cliente com muito carinho e gentileza, explicando que a cozinha está descansando e abre às ' + ctx.openingHours + ')'}
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
1. Seja acolhedora, rápida, use emojis típicos de açaí (🍇, 🍧, 🍫, 🛵, ✨) com moderação.
2. Se a loja estiver FECHADA: acolha o cliente, responda todas as perguntas sobre o cardápio e avise que quando a loja abrir às ${ctx.openingHours} ele já pode enviar o pedido pelo link.
3. Se perguntarem sobre lactose/vegano: o açaí puro não contém lactose nem glúten. Sugira montar com frutas, paçoca e granola tradicional sem leite.
4. Se perguntarem sobre status de entrega: informe o status exato e o entregador com base no STATUS DE PEDIDO acima.
5. Sempre que fizer sentido, envie o link do Cardápio Digital (${ctx.publicUrl}) para o cliente finalizar.
6. Sempre inclua ao final de forma sutil: "💡 _Digite *menu* para ver as opções._"
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

    // 7. MOTOR INTELIGENTE LOCAL (CONTINGÊNCIA SEM CUSTO DE API)
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
    const closedReminder = !ctx.isOpen ? `\n\n🌙 *(Lembrando que nossa cozinha está fechada no momento e abre às ${ctx.openingHours}, mas você já pode ir escolhendo o seu favorito!)* 🍇` : '';

    // Opção 1 ou Rastreio de Pedido
    if (t === '1' || t.includes('pedido') || t.includes('rastrear') || t.includes('onde ta') || t.includes('cade') || t.includes('cadê') || t.includes('demorando')) {
      return {
        reply: `🛵 *Status do seu Pedido:*\n\n${ctx.orderStatusText}\n\n📱 Acompanhe o pedido ou monte um novo copo:\n👉 ${ctx.publicUrl}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 2 ou Produtos / Preços / Sabores
    if (t === '2' || t.includes('preco') || t.includes('preço') || t.includes('quanto custa') || t.includes('sabores') || t.includes('cardapio') || t.includes('cardápio') || t.includes('tamanhos') || t.includes('copos')) {
      return {
        reply: `🍧 *Destaques do nosso Cardápio:*\n\n${ctx.productsSummary.split('\n').slice(0, 4).join('\n')}\n\n📱 *Confira todos os tamanhos, adicionais e combos no cardápio digital:*\n👉 ${ctx.publicUrl}${closedReminder}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 3 ou Promoções / Cupons
    if (t === '3' || t.includes('promo') || t.includes('combo') || t.includes('desconto') || t.includes('cupom')) {
      return {
        reply: `🎉 *Promoções & Cupons Ativos:*\n\n🎟️ *Cupons Disponíveis:* ${ctx.couponList}\n\n💥 Temos combos especiais para casal e família com descontos imperdíveis!\n👉 Acesse: ${ctx.publicUrl}${closedReminder}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Opção 4 ou Horários / Endereço / Onde fica
    if (t === '4' || t.includes('horario') || t.includes('horário') || t.includes('onde fica') || t.includes('endereco') || t.includes('endereço') || t.includes('localizacao') || t.includes('localização')) {
      return {
        reply: `📍 *Nossa Localização & Horários:*\n\n🏠 *Endereço:* ${ctx.address}\n🕒 *Horário:* ${ctx.openingHours}\n\n📱 Peça online pelo delivery: ${ctx.publicUrl}${closedReminder}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Dúvidas de Ingredientes / Lactose / Vegano
    if (t.includes('leite') || t.includes('lactose') || t.includes('vegano') || t.includes('intolerante') || t.includes('puro') || t.includes('ingredientes')) {
      return {
        reply: `🍇 *Nosso Açaí é 100% Puro & Natural!*\n\nNão contém leite, lactose nem glúten em sua base tradicional. Se você tiver intolerância, recomendamos pedir com frutas frescas, paçoca e granola tradicional sem leite! 🍧${closedReminder}\n\n📱 Monte do seu jeito: ${ctx.publicUrl}\n\n💡 _Digite *menu* para voltar._`,
        needsHumanTakeover: false
      };
    }

    // Dúvidas de Entrega / Bairros / Frete
    if (t.includes('entrega') || t.includes('frete') || t.includes('taxa') || t.includes('distancia') || t.includes('distância')) {
      return {
        reply: `🛵 *Entregas em toda Franca - SP!*\n\nCobrimos até 25km de distância da loja com frete a partir de R$ 4,50. Você pode colocar seu endereço direto no cardápio digital para calcular o frete exato! 📍\n👉 ${ctx.publicUrl}${closedReminder}\n\n💡 _Digite *menu* para voltar._`,
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

    // Saudações comuns ou intenção inicial de pedir
    const isGreetingOrOrderIntent = /^(oi|ola|olá|bom dia|boa tarde|boa noite|quero pedir|quero açaí|quero acai)\b/i.test(t) ||
      t.includes('boa noite') || t.includes('bom dia') || t.includes('boa tarde') || t.includes('quero pedir') || t.includes('fazer pedido') || t === 'oi' || t === 'ola' || t === 'olá';

    if (isGreetingOrOrderIntent && !t.includes('?')) {
      const greeting = !ctx.isOpen
        ? `Olá${nameStr}! 🌙 No momento nossa cozinha está descansando (abrimos às *${ctx.openingHours}*), mas continuo por aqui para tirar qualquer dúvida sobre o cardápio ou te ajudar a escolher o açaí ideal da *Explosão Açaí*! 🍧\n\n📱 *Acesse nosso cardápio digital:* \n👉 ${ctx.publicUrl}\n\n💡 _Digite *menu* para ver todas as opções!_`
        : `Oi${nameStr}! 🍇 Bem-vindo à *Explosão Açaí*! Como posso te ajudar hoje?\n\n📱 *Para ver o cardápio e fazer seu pedido, acesse:* \n👉 ${ctx.publicUrl}\n\n💡 _Digite *menu* para ver todas as opções disponíveis!_`;

      return {
        reply: greeting,
        needsHumanTakeover: false
      };
    }

    // DÚVIDA NÃO RECONHECIDA OU ESPECÍFICA: TRANSFERE PARA ATENDENTE HUMANO
    const isQuestionOrComplex = t.includes('?') || t.includes('como') || t.includes('qual') || t.includes('onde') || t.includes('quando') || t.includes('aceita') || t.includes('parceria') || t.includes('trabalhar') || t.includes('vaga') || t.length > 20;
    if (isQuestionOrComplex) {
      return {
        reply: `Essa é uma dúvida bem específica e quero te dar a melhor resposta com certeza! 👤 Por isso, estou chamando um atendente humano da nossa equipe agora mesmo para te responder por aqui. Aguarde só um instante!\n\n💡 _Se quiser ver o cardápio enquanto isso, digite *menu*._`,
        needsHumanTakeover: true
      };
    }

    // Saudação padrão simpática
    const closedGreeting = !ctx.isOpen
      ? `Olá${nameStr}! 🌙 No momento nossa cozinha está descansando (abrimos às *${ctx.openingHours}*), mas continuo por aqui para tirar qualquer dúvida sobre o cardápio ou te ajudar a escolher o açaí ideal! 🍧\n\n📱 *Acesse nosso cardápio digital:* \n👉 ${ctx.publicUrl}\n\n💡 _Digite *menu* para ver todas as opções!_`
      : `Oi${nameStr}! 🍇 Como posso te ajudar hoje?\n\n📱 *Para ver o cardápio e fazer seu pedido, acesse:* \n👉 ${ctx.publicUrl}\n\n💡 _Digite *menu* para ver todas as opções disponíveis!_`;

    return {
      reply: closedGreeting,
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
