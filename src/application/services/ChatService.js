import { db } from '../../infrastructure/database/JsonDatabase.js';
import { wsHub } from '../../infrastructure/websockets/WebSocketHub.js';

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
    const chats = this.db.get().chats || [];
    const map = new Map();

    for (const msg of chats) {
      const p = msg.customerPhone;
      if (!p) continue;

      if (!map.has(p)) {
        map.set(p, {
          customerPhone: p,
          customerName: msg.customerName || 'Cliente',
          lastMessage: msg.message,
          lastTimestamp: msg.timestamp,
          unreadCount: 0
        });
      }
      const conv = map.get(p);
      conv.lastMessage = msg.message;
      conv.lastTimestamp = msg.timestamp;
      if (msg.customerName && conv.customerName === 'Cliente') {
        conv.customerName = msg.customerName;
      }
      if (!msg.read && msg.sender === 'customer') {
        conv.unreadCount++;
      }
    }

    return Array.from(map.values()).sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));
  }

  sendMessage({ sender, customerPhone, customerName, message }) {
    if (!message || !message.trim()) throw new Error('Mensagem vazia.');
    const raw = String(customerPhone || '').trim();
    if (!raw) throw new Error('Identificação do cliente é obrigatória para o chat.');

    const cleanDigits = raw.replace(/\D/g, '');
    const cleanPhone = (cleanDigits && cleanDigits.length >= 8) ? cleanDigits : raw;

    const newMsg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender: sender || 'customer', // 'customer' ou 'admin'
      customerPhone: cleanPhone,
      customerName: customerName || 'Cliente',
      message: message.trim(),
      timestamp: new Date().toISOString(),
      read: sender === 'admin'
    };

    const data = this.db.get();
    if (!data.chats) data.chats = [];
    data.chats.push(newMsg);
    this.db.save();

    // Notifica instantaneamente clientes conectados via WebSocket
    wsHub.notifyChatMessage(newMsg);

    return newMsg;
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
