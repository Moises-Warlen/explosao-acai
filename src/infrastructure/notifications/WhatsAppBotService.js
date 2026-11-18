import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { geminiAssistantService } from '../../application/services/GeminiAssistantService.js';
import { wsHub } from '../websockets/WebSocketHub.js';
import { db } from '../database/JsonDatabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WhatsAppBotService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.connectedPhone = null;
    this.qrCodeDataUrl = null;
    this.aiEnabled = true;
    this.humanTakeoverPhones = new Set();
    this.optOutPhones = new Set();
    this.campaignInProgress = false;
    this._scheduleInterval = null;
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      aiReplies: 0,
      humanTransfers: 0,
      connectedSince: null
    };

    this.authDir = path.resolve(__dirname, '../../../data/baileys_auth');
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    this.loadBotSettings();
    this.startScheduleChecker();
  }

  loadBotSettings() {
    try {
      const botData = db.get()?.botSettings || {};
      if (Array.isArray(botData.optOutPhones)) {
        this.optOutPhones = new Set(botData.optOutPhones.map(p => String(p).replace(/\D/g, '')));
      }
    } catch (e) {
      console.warn('[WhatsApp Bot] Erro ao carregar botSettings:', e.message);
    }
  }

  saveBotSettings() {
    try {
      const data = db.get();
      if (!data.botSettings) data.botSettings = {};
      data.botSettings.optOutPhones = Array.from(this.optOutPhones);
      if (!data.botSettings.weeklyCampaign) {
        data.botSettings.weeklyCampaign = {
          enabled: false,
          scheduledDay: 5, // Sexta-feira
          scheduledHour: 17, // 17h
          customMessage: '',
          lastDispatchedAt: null,
          lastDispatchedCount: 0
        };
      }
      db.saveLocal();
    } catch (e) {
      console.warn('[WhatsApp Bot] Erro ao salvar botSettings:', e.message);
    }
  }

  getCampaignSettings() {
    const botData = db.get()?.botSettings?.weeklyCampaign || {};
    return {
      enabled: Boolean(botData.enabled),
      scheduledDay: Number.isInteger(botData.scheduledDay) ? botData.scheduledDay : 5,
      scheduledHour: Number.isInteger(botData.scheduledHour) ? botData.scheduledHour : 17,
      customMessage: botData.customMessage || '',
      lastDispatchedAt: botData.lastDispatchedAt || null,
      lastDispatchedCount: botData.lastDispatchedCount || 0
    };
  }

  updateCampaignSettings(settings = {}) {
    const data = db.get();
    if (!data.botSettings) data.botSettings = {};
    data.botSettings.weeklyCampaign = {
      ...this.getCampaignSettings(),
      ...settings
    };
    db.saveLocal();
    this.broadcastStatus();
    return data.botSettings.weeklyCampaign;
  }

  getEligibleCustomers() {
    try {
      const orders = db.get()?.orders || [];
      const customerMap = new Map();

      for (const order of orders) {
        const rawPhone = order.customer?.phone;
        if (!rawPhone) continue;
        const clean = rawPhone.replace(/\D/g, '');
        if (clean.length < 10) continue; // Mínimo DDD + 8 dígitos

        // Respeito à LGPD: se o cliente solicitou saída da lista de promoções
        if (this.optOutPhones.has(clean)) continue;

        const name = order.customer?.name || 'Cliente';
        customerMap.set(clean, { phone: clean, name });
      }

      return Array.from(customerMap.values());
    } catch (err) {
      console.warn('[WhatsApp Bot] Erro ao listar clientes elegíveis:', err.message);
      return [];
    }
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      phone: this.connectedPhone,
      qrCode: this.qrCodeDataUrl,
      aiEnabled: this.aiEnabled,
      stats: {
        ...this.stats,
        profanityBlocked: geminiAssistantService.stats?.profanityBlocked || 0,
        menuRequests: geminiAssistantService.stats?.menuRequests || 0
      },
      humanTakeoverCount: this.humanTakeoverPhones.size,
      optOutCount: this.optOutPhones.size,
      eligibleCustomersCount: this.getEligibleCustomers().length,
      weeklyCampaign: this.getCampaignSettings(),
      campaignInProgress: this.campaignInProgress
    };
  }

  toggleAI(enabled) {
    this.aiEnabled = typeof enabled === 'boolean' ? enabled : !this.aiEnabled;
    this.broadcastStatus();
    return this.aiEnabled;
  }

  releaseHumanTakeover(phone) {
    const clean = (phone || '').replace(/\D/g, '');
    this.humanTakeoverPhones.delete(clean);
    this.broadcastStatus();
  }

  broadcastStatus() {
    try {
      if (wsHub && typeof wsHub.broadcast === 'function') {
        wsHub.broadcast({
          type: 'BOT_STATUS_CHANGED',
          payload: this.getStatus()
        });
      }
    } catch (e) {}
  }

  /**
   * Inicializa a conexão com o WhatsApp
   */
  async startConnection() {
    if (this.sock && this.status === 'connected') {
      return this.getStatus();
    }

    this.status = 'connecting';
    this.broadcastStatus();

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ['Explosão Açaí Gestor', 'Chrome', '120.0.0']
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
            this.status = 'qr_ready';
            this.broadcastStatus();
          } catch (err) {
            console.error('[WhatsApp Bot] Erro ao gerar imagem QR Code:', err.message);
          }
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
          this.status = 'disconnected';
          this.connectedPhone = null;
          this.qrCodeDataUrl = null;
          this.broadcastStatus();

          if (shouldReconnect) {
            console.log('[WhatsApp Bot] Conexão encerrada temporariamente. Reconectando em 5 segundos...');
            setTimeout(() => this.startConnection(), 5000);
          } else {
            console.log('[WhatsApp Bot] Sessão desconectada pelo usuário.');
            this.clearAuthFiles();
          }
        } else if (connection === 'open') {
          this.status = 'connected';
          this.qrCodeDataUrl = null;
          const userJid = this.sock.user?.id || '';
          this.connectedPhone = userJid.split(':')[0] || userJid.split('@')[0];
          this.stats.connectedSince = new Date().toISOString();
          console.log(`[WhatsApp Bot] 🚀 Conectado com sucesso ao WhatsApp! Número: +${this.connectedPhone}`);
          this.broadcastStatus();
        }
      });

      // Receptor de mensagens
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;
          
          const remoteJid = msg.key.remoteJid;
          if (!remoteJid || remoteJid.endsWith('@g.us')) continue; // ignora grupos

          const senderPhone = remoteJid.replace('@s.whatsapp.net', '');
          const cleanPhone = senderPhone.replace(/\D/g, '');
          const pushName = msg.pushName || 'Cliente';

          const isAudio = Boolean(msg.message.audioMessage);
          const isImageNoCaption = Boolean(msg.message.imageMessage && !msg.message.imageMessage.caption);
          const isSticker = Boolean(msg.message.stickerMessage);
          const isDocument = Boolean(msg.message.documentMessage);

          let textMessage = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            '';

          // Se for áudio, foto sem legenda, figurinha ou documento, mapeia marcador para atendimento inteligente
          if (isAudio) {
            textMessage = '[MENSAGEM_DE_AUDIO]';
          } else if (isImageNoCaption) {
            textMessage = '[MENSAGEM_DE_FOTO]';
          } else if (isSticker) {
            textMessage = '[MENSAGEM_DE_FIGURINHA]';
          } else if (isDocument) {
            textMessage = '[MENSAGEM_DE_DOCUMENTO]';
          }

          if (!textMessage.trim()) continue;

          this.stats.messagesReceived++;

          // 1. LGPD: Descadastro / Opt-out de ofertas promocionais ("sair", "cancelar", "parar", etc.)
          const isOptOut = /^(sair|cancelar|descadastrar|parar|stop|remover|desinscrever)\b/i.test(textMessage.trim());
          if (isOptOut) {
            this.optOutPhones.add(cleanPhone);
            this.saveBotSettings();
            const reply = "Tudo bem! Você foi removido da lista de novidades e promoções da *Explosão Açaí*. 🍇\n\nCaso queira fazer um pedido ou ver o cardápio no futuro, basta digitar *menu* a qualquer momento!";
            await this.sendTextMessage(remoteJid, reply);
            continue;
          }

          // 2. Retorno ao Menu Principal (reativa o bot se estava em transbordo humano)
          const isMenu = geminiAssistantService.isMenuCommand(textMessage);
          const wasInHuman = this.humanTakeoverPhones.has(cleanPhone);
          if (wasInHuman && isMenu) {
            this.releaseHumanTakeover(cleanPhone);
          }

          // Se este telefone ainda estiver em atendimento humano e não pediu menu, não interfere
          if (this.humanTakeoverPhones.has(cleanPhone)) {
            continue;
          }

          // Se a IA estiver desativada pelo administrador
          if (!this.aiEnabled) {
            continue;
          }

          try {
            // Processa com a IA do Gemini ou motor de contingência
            const aiResponse = await geminiAssistantService.processMessage({
              phone: cleanPhone,
              customerName: pushName,
              text: textMessage,
              wasInHumanTakeover: wasInHuman
            });

            if (aiResponse && aiResponse.reply) {
              if (aiResponse.sendWithLogo) {
                const logoPng = path.resolve(__dirname, '../../../public/imagens/Logo.png');
                const logoWebp = path.resolve(__dirname, '../../../public/imagens/Logo.webp');
                const finalLogoPath = fs.existsSync(logoPng) ? logoPng : logoWebp;
                await this.sendImageMessage(remoteJid, finalLogoPath, aiResponse.reply);
              } else {
                await this.sendTextMessage(remoteJid, aiResponse.reply);
              }
              this.stats.aiReplies++;

              if (aiResponse.needsHumanTakeover) {
                this.humanTakeoverPhones.add(cleanPhone);
                this.stats.humanTransfers++;
                this.broadcastStatus();

                // Notifica o painel administrativo
                if (wsHub && typeof wsHub.broadcast === 'function') {
                  wsHub.broadcast({
                    type: 'HUMAN_TAKEOVER_REQUESTED',
                    payload: {
                      phone: cleanPhone,
                      customerName: pushName,
                      lastMessage: textMessage
                    }
                  });
                }
              }
            }
          } catch (err) {
            console.error('[WhatsApp Bot] Erro ao responder mensagem:', err.message);
          }
        }
      });

      return this.getStatus();
    } catch (err) {
      this.status = 'disconnected';
      console.error('[WhatsApp Bot] Falha ao iniciar Baileys:', err.message);
      this.broadcastStatus();
      throw err;
    }
  }

  /**
   * Envia uma mensagem com imagem (ex: Logo oficial da loja) e legenda opcional
   */
  async sendImageMessage(toJid, imagePath, caption = '') {
    if (!this.sock || this.status !== 'connected') {
      return false;
    }
    const target = toJid.includes('@') ? toJid : `${toJid.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      if (fs.existsSync(imagePath)) {
        const imageBuffer = fs.readFileSync(imagePath);
        await this.sock.sendMessage(target, {
          image: imageBuffer,
          caption
        });
        this.stats.messagesSent++;
        return true;
      }
    } catch (err) {
      console.warn(`[WhatsApp Bot] Falha ao enviar imagem para ${target}, tentando como texto puro:`, err.message);
    }
    // Fallback gracioso para texto caso ocorra qualquer problema com a imagem
    return this.sendTextMessage(target, caption);
  }

  /**
   * Envia uma mensagem de texto direta para um contato
   */
  async sendTextMessage(toJid, text) {
    if (!this.sock || this.status !== 'connected') {
      return false;
    }
    const target = toJid.includes('@') ? toJid : `${toJid.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      await this.sock.sendMessage(target, { text });
      this.stats.messagesSent++;
      return true;
    } catch (err) {
      console.error(`[WhatsApp Bot] Erro ao enviar mensagem para ${target}:`, err.message);
      return false;
    }
  }

  /**
   * Disparo automático proativo de status de pedidos
   */
  async sendOrderStatusNotification(order, eventType) {
    if (!this.sock || this.status !== 'connected' || !order?.customer?.phone) {
      return false;
    }

    const cleanPhone = order.customer.phone.replace(/\D/g, '');
    const ddiPhone = cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone;
    const targetJid = `${ddiPhone}@s.whatsapp.net`;
    const customerName = order.customer.name || 'Cliente';
    const publicUrl = process.env.BASE_URL || 'http://localhost:3000';

    let msg = '';
    if (eventType === 'in_preparation') {
      msg = `Olá ${customerName}! 🍇💥\n\nSeu *Pedido #${order.orderNo}* foi confirmado e nossa equipe já começou a preparar seu açaí com todo capricho! 🥣✨\n\nAssim que sair para entrega te avisamos por aqui!`;
    } else if (eventType === 'out_for_delivery') {
      const motoboy = order.delivery?.motoboyName ? ` pelo entregador *${order.delivery.motoboyName}*` : '';
      msg = `🛵 *Seu açaí saiu para entrega!*\n\nOlá ${customerName}, seu *Pedido #${order.orderNo}* já está a caminho${motoboy}! Fique atento ao interfone ou portão. 💨\n\n📍 Destino: ${order.delivery?.street || ''}, ${order.delivery?.number || ''}\n💳 Pagamento: ${order.payment?.method || 'Confirmado'}`;
    } else if (eventType === 'delivered') {
      msg = `✅ *Pedido Entregue!*\n\nEsperamos que seu açaí esteja delicioso, ${customerName}! Muito obrigado pela preferência e bom apetite! 🍧💜\n\nQueremos te ver de novo em breve: ${publicUrl}`;
    }

    if (msg) {
      return this.sendTextMessage(targetJid, msg);
    }
    return false;
  }

  /**
   * Disparo seguro de campanhas promocionais semanais e reengajamento
   */
  async sendWeeklyPromotionCampaign({ message = '', productName = '', couponCode = '', testPhone = null, dryRun = false } = {}) {
    const eligible = this.getEligibleCustomers();

    let finalMessage = (message || '').trim();
    if (!finalMessage) {
      finalMessage = await geminiAssistantService.generateWeeklyPromotionText({ productName, couponCode });
    }

    // Garante a cláusula de descadastro da LGPD
    if (!finalMessage.toLowerCase().includes('sair')) {
      finalMessage += "\n\n_(Caso não queira mais receber nossas ofertas, responda 'sair')_";
    }

    if (dryRun) {
      return {
        dryRun: true,
        totalEligible: eligible.length,
        optOutCount: this.optOutPhones.size,
        sampleMessage: finalMessage
      };
    }

    if (this.status !== 'connected' || !this.sock) {
      throw new Error('O bot do WhatsApp não está conectado. Conecte antes de disparar a campanha.');
    }

    if (this.campaignInProgress) {
      throw new Error('Uma campanha já está em andamento. Aguarde a conclusão do disparo atual.');
    }

    // Se for teste, envia apenas para o telefone informado
    const targetList = testPhone
      ? [{ phone: testPhone.replace(/\D/g, ''), name: 'Teste' }]
      : eligible;

    if (targetList.length === 0) {
      return {
        ok: true,
        message: 'Nenhum cliente elegível encontrado na base para disparo.',
        sentCount: 0,
        totalEligible: 0
      };
    }

    this.campaignInProgress = true;
    this.broadcastStatus();

    // Executa em segundo plano com intervalo seguro de 2s para evitar restrições do WhatsApp
    (async () => {
      let sentCount = 0;
      let failedCount = 0;

      for (const client of targetList) {
        try {
          const ddiPhone = client.phone.startsWith('55') ? client.phone : '55' + client.phone;
          const targetJid = `${ddiPhone}@s.whatsapp.net`;
          const personalizedMsg = finalMessage.replace(/\{nome\}/gi, client.name || 'Cliente');

          await this.sock.sendMessage(targetJid, { text: personalizedMsg });
          this.stats.messagesSent++;
          sentCount++;

          // Intervalo anti-spam de 2 segundos
          await new Promise(r => setTimeout(r, 2000));
        } catch (sendErr) {
          console.warn(`[WhatsApp Bot Campaign] Falha ao enviar para ${client.phone}:`, sendErr.message);
          failedCount++;
        }
      }

      this.campaignInProgress = false;

      // Se não for teste, atualiza o histórico do último disparo
      if (!testPhone) {
        const data = db.get();
        if (!data.botSettings) data.botSettings = {};
        if (!data.botSettings.weeklyCampaign) data.botSettings.weeklyCampaign = this.getCampaignSettings();
        data.botSettings.weeklyCampaign.lastDispatchedAt = new Date().toISOString();
        data.botSettings.weeklyCampaign.lastDispatchedCount = sentCount;
        db.saveLocal();
      }

      this.broadcastStatus();
      console.log(`[WhatsApp Bot Campaign] Disparo finalizado: ${sentCount} enviados com sucesso, ${failedCount} falhas.`);
    })().catch(err => {
      this.campaignInProgress = false;
      this.broadcastStatus();
      console.error('[WhatsApp Bot Campaign] Erro inesperado no ciclo de disparo:', err);
    });

    return {
      ok: true,
      message: `Disparo da campanha iniciado para ${targetList.length} clientes. As mensagens estão sendo enviadas com segurança.`,
      totalEligible: targetList.length
    };
  }

  /**
   * Monitora e dispara campanhas semanais agendadas automaticamente
   */
  startScheduleChecker() {
    if (this._scheduleInterval) return;
    // Checagem a cada 30 minutos
    this._scheduleInterval = setInterval(() => {
      try {
        this.checkWeeklyCampaignSchedule();
      } catch (e) {
        console.warn('[WhatsApp Bot] Erro na verificação de agendamento:', e.message);
      }
    }, 30 * 60 * 1000);

    if (this._scheduleInterval && typeof this._scheduleInterval.unref === 'function') {
      this._scheduleInterval.unref();
    }
  }

  checkWeeklyCampaignSchedule() {
    const settings = this.getCampaignSettings();
    if (!settings.enabled || this.status !== 'connected' || this.campaignInProgress) {
      return;
    }

    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();

    if (currentDay === settings.scheduledDay && currentHour === settings.scheduledHour) {
      if (settings.lastDispatchedAt) {
        const last = new Date(settings.lastDispatchedAt);
        const diffDays = (now - last) / (1000 * 60 * 60 * 24);
        if (diffDays < 5) {
          return; // Já enviado nos últimos 5 dias
        }
      }

      console.log('[WhatsApp Bot] ⏰ Horário da campanha semanal atingido! Iniciando disparo programado...');
      this.sendWeeklyPromotionCampaign({
        message: settings.customMessage
      }).catch(err => {
        console.error('[WhatsApp Bot] Falha no disparo programado semanal:', err.message);
      });
    }
  }

  /**
   * Desconecta e limpa credenciais da sessão
   */
  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {}
    this.status = 'disconnected';
    this.connectedPhone = null;
    this.qrCodeDataUrl = null;
    this.clearAuthFiles();
    this.broadcastStatus();
    return true;
  }

  clearAuthFiles() {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
        fs.mkdirSync(this.authDir, { recursive: true });
      }
    } catch (e) {}
  }
}

export const whatsAppBotService = new WhatsAppBotService();
