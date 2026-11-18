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
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      phone: this.connectedPhone,
      qrCode: this.qrCodeDataUrl,
      aiEnabled: this.aiEnabled,
      stats: this.stats,
      humanTakeoverCount: this.humanTakeoverPhones.size
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

          const textMessage = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            '';

          if (!textMessage.trim()) continue;

          this.stats.messagesReceived++;

          // Se este telefone estiver em atendimento humano, não interfere
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
              text: textMessage
            });

            if (aiResponse && aiResponse.reply) {
              await this.sendTextMessage(remoteJid, aiResponse.reply);
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
