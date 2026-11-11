import { db } from '../../infrastructure/database/JsonDatabase.js';
import { wsHub } from '../../infrastructure/websockets/WebSocketHub.js';
import { storeService } from './StoreService.js';

export class ChatService {
  constructor() {
    this.db = db;
  }

  getMessages(customerPhone) {
    const raw = String(customerPhone || '').trim();
    if (!raw) {
      // Regra de privacidade estrita: sem identificador do cliente, não expõe conversas de ninguém
      return [];
    }

    const chats = this.db.get().chats || [];
    const cleanDigits = raw.replace(/\D/g, '');

    return chats.filter(m => {
      const mPhone = String(m.customerPhone || '').trim();
      const mDigits = mPhone.replace(/\D/g, '');
      if (cleanDigits && mDigits && cleanDigits.length >= 8 && mDigits.length >= 8) {
        return mDigits === cleanDigits;
      }
      return mPhone.toLowerCase() === raw.toLowerCase();
    });
  }

  getAllConversations() {
    const data = this.db.get();
    const chats = data.chats || [];
    const orders = data.orders || [];
    const map = new Map();

    for (const msg of chats) {
      const p = msg.customerPhone;
      if (!p) continue;

      if (!map.has(p)) {
        // Tenta descobrir o nome real do cliente a partir de pedidos anteriores
        let resolvedName = msg.customerName;
        if (!resolvedName || resolvedName === 'Cliente') {
          const cleanP = String(p).replace(/\D/g, '');
          const prevOrder = orders.find(o => {
            const oPhone = String(o.customer?.phone || '').replace(/\D/g, '');
            return cleanP && oPhone && cleanP === oPhone;
          });
          if (prevOrder && prevOrder.customer?.name) {
            resolvedName = prevOrder.customer.name;
          } else {
            resolvedName = 'Cliente';
          }
        }

        map.set(p, {
          customerPhone: p,
          customerName: resolvedName,
          lastMessage: msg.message,
          lastTimestamp: msg.timestamp,
          isSystemClose: !!msg.isSystemClose,
          unreadCount: 0
        });
      }
      const conv = map.get(p);
      conv.lastMessage = msg.message;
      conv.lastTimestamp = msg.timestamp;
      conv.isSystemClose = !!msg.isSystemClose;
      if (msg.customerName && msg.customerName !== 'Cliente') {
        conv.customerName = msg.customerName;
      }
      if (!msg.read && msg.sender === 'customer') {
        conv.unreadCount++;
      }
    }

    // Exclui conversas já finalizadas pelo operador (onde a última mensagem é isSystemClose)
    return Array.from(map.values())
      .filter(c => !c.isSystemClose)
      .sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));
  }

  sendMessage({ sender, customerPhone, customerName, message }) {
    if (!message || !message.trim()) throw new Error('Mensagem vazia.');
    const raw = String(customerPhone || '').trim();
    if (!raw) throw new Error('Identificação do cliente é obrigatória para o chat.');

    const data = this.db.get();
    const cleanDigits = raw.replace(/\D/g, '');
    const cleanPhone = (cleanDigits && cleanDigits.length >= 8) ? cleanDigits : raw;

    // Se o cliente não passou nome ou passou 'Cliente', verifica se já tem pedidos no histórico
    let finalCustomerName = customerName || 'Cliente';
    if ((!customerName || customerName === 'Cliente') && sender !== 'admin') {
      const orders = data.orders || [];
      const prevOrder = orders.find(o => {
        const oPhone = String(o.customer?.phone || '').replace(/\D/g, '');
        return cleanDigits && oPhone && cleanDigits === oPhone;
      });
      if (prevOrder && prevOrder.customer?.name) {
        finalCustomerName = prevOrder.customer.name;
      }
    }

    const storeSenderName = data.settings?.chatSenderName || 'Delivery';
    const finalSender = sender || 'customer';

    // Se a conversa anterior deste cliente já havia sido finalizada pelo operador, limpa as mensagens antigas para começar limpo
    if (finalSender === 'customer') {
      const hasPreviousClosed = (data.chats || []).some(m => {
        const mDigits = String(m.customerPhone || '').replace(/\D/g, '');
        const match = (cleanDigits && mDigits && cleanDigits.length >= 8 && mDigits.length >= 8)
          ? cleanDigits === mDigits
          : String(m.customerPhone || '').toLowerCase() === raw.toLowerCase();
        return match && m.isSystemClose;
      });

      if (hasPreviousClosed) {
        data.chats = (data.chats || []).filter(m => {
          const mDigits = String(m.customerPhone || '').replace(/\D/g, '');
          const match = (cleanDigits && mDigits && cleanDigits.length >= 8 && mDigits.length >= 8)
            ? cleanDigits === mDigits
            : String(m.customerPhone || '').toLowerCase() === raw.toLowerCase();
          return !match;
        });
      }
    }

    const newMsg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender: finalSender, // 'customer' ou 'admin'
      senderName: finalSender === 'admin' ? storeSenderName : finalCustomerName,
      customerPhone: cleanPhone,
      customerName: finalCustomerName,
      message: message.trim(),
      timestamp: new Date().toISOString(),
      read: finalSender === 'admin'
    };

    if (!data.chats) data.chats = [];
    data.chats.push(newMsg);
    this.db.save();

    // Notifica instantaneamente clientes conectados via WebSocket
    wsHub.notifyChatMessage(newMsg);

    // Se a mensagem partiu do cliente, verifica se a loja está fechada para envio de auto-resposta inteligente
    if (finalSender === 'customer') {
      try {
        const storeStatus = storeService.isStoreOpen();
        const isClosed = !storeStatus.isOpen;
        const autoReplyEnabled = data.settings?.autoReplyClosedEnabled !== false;

        if (isClosed && autoReplyEnabled) {
          // Previne repetições desnecessárias: verifica se já enviamos auto-resposta para este cliente nos últimos 20 minutos
          const now = Date.now();
          const customerMessages = (data.chats || []).filter(m => {
            const mDigits = String(m.customerPhone || '').replace(/\D/g, '');
            return cleanDigits && mDigits && cleanDigits.length >= 8 && mDigits.length >= 8
              ? cleanDigits === mDigits
              : String(m.customerPhone || '').toLowerCase() === raw.toLowerCase();
          });

          const lastAutoReply = customerMessages.slice().reverse().find(m => m.isAutoReply);
          const recentlySent = lastAutoReply && (now - new Date(lastAutoReply.timestamp).getTime() < 20 * 60 * 1000);

          if (!recentlySent) {
            const customMsg = (data.settings?.autoReplyClosedMessage || '').trim();
            const closedNotice = storeStatus.message || 'No momento a loja está fechada.';

            let autoText = '';
            if (customMsg) {
              autoText = customMsg.replace(/{horario}/g, closedNotice).replace(/{status}/g, closedNotice);
            } else {
              autoText = `Olá! 🍧 Agradecemos a sua mensagem. No momento a Explosão Açaí está fechada (${closedNotice}). Seu recado foi registrado com sucesso e responderemos assim que abrirmos nosso atendimento! Agradecemos o carinho e a preferência.`;
            }

            const autoMsg = {
              id: `msg_${Date.now()}_auto`,
              sender: 'admin',
              senderName: storeSenderName || 'Explosão Açaí',
              customerPhone: cleanPhone,
              customerName: finalCustomerName,
              message: autoText,
              timestamp: new Date(Date.now() + 150).toISOString(),
              read: true,
              isAutoReply: true
            };

            data.chats.push(autoMsg);
            this.db.save();

            // Notifica via WebSocket tanto o cardápio do cliente quanto o painel administrativo
            wsHub.notifyChatMessage(autoMsg);
          }
        }
      } catch (err) {
        console.warn('Aviso: Falha ao avaliar auto-resposta de chat fechado:', err.message);
      }
    }

    return newMsg;
  }

  closeConversation(customerPhone) {
    const raw = String(customerPhone || '').trim();
    if (!raw) throw new Error('Telefone do cliente é obrigatório.');

    const data = this.db.get();
    const storeSenderName = data.settings?.chatSenderName || 'Delivery';

    // Cria mensagem de encerramento amigável
    const closeMsg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender: 'admin',
      senderName: storeSenderName,
      customerPhone: raw,
      customerName: 'Cliente',
      message: '✓ Atendimento finalizado pelo operador. Agradecemos o contato com o Explosão Açaí! Se precisar de algo, envie uma nova mensagem.',
      timestamp: new Date().toISOString(),
      read: true,
      isSystemClose: true
    };

    if (!data.chats) data.chats = [];
    data.chats.push(closeMsg);

    // Marca todas as mensagens anteriores como lidas e fechadas
    const cleanDigits = raw.replace(/\D/g, '');
    data.chats.forEach(m => {
      const mDigits = String(m.customerPhone || '').replace(/\D/g, '');
      if ((cleanDigits && mDigits && cleanDigits === mDigits) || m.customerPhone === raw) {
        m.read = true;
        m.closed = true;
      }
    });

    this.db.save();
    wsHub.notifyChatMessage(closeMsg);
    wsHub.broadcast({
      event: 'CHAT_CLOSED',
      payload: { customerPhone: raw }
    });

    return { ok: true, message: closeMsg };
  }

  updateCustomerName(customerPhone, newName) {
    const raw = String(customerPhone || '').trim();
    const name = String(newName || '').trim();
    if (!raw || !name) throw new Error('Telefone e nome são obrigatórios.');

    const data = this.db.get();
    const cleanDigits = raw.replace(/\D/g, '');

    if (data.chats) {
      data.chats.forEach(m => {
        const mDigits = String(m.customerPhone || '').replace(/\D/g, '');
        if ((cleanDigits && mDigits && cleanDigits === mDigits) || m.customerPhone === raw) {
          m.customerName = name;
          if (m.sender === 'customer') {
            m.senderName = name;
          }
        }
      });
    }

    this.db.save();
    return { ok: true, customerPhone: raw, customerName: name };
  }

  markAsRead(customerPhone) {
    const raw = String(customerPhone || '').trim();
    if (!raw) return;
    const cleanDigits = raw.replace(/\D/g, '');

    const data = this.db.get();
    if (!data.chats) return;

    data.chats.forEach(m => {
      const mPhone = String(m.customerPhone || '').trim();
      const mDigits = mPhone.replace(/\D/g, '');
      const match = (cleanDigits && mDigits && cleanDigits.length >= 8 && mDigits.length >= 8)
        ? cleanDigits === mDigits 
        : mPhone.toLowerCase() === raw.toLowerCase();
      if (match && m.sender === 'customer') {
        m.read = true;
      }
    });

    this.db.save();
  }
}

export const chatService = new ChatService();
