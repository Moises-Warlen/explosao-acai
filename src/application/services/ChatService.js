import { db } from '../../infrastructure/database/JsonDatabase.js';
import { wsHub } from '../../infrastructure/websockets/WebSocketHub.js';

export class ChatService {
  constructor() {
    this.db = db;
  }

  getMessages(customerPhone) {
    const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
    const chats = this.db.get().chats || [];
    if (!cleanPhone) return chats;
    return chats.filter(m => m.customerPhone === cleanPhone);
  }

  getAllConversations() {
    const chats = this.db.get().chats || [];
    const map = new Map();

    for (const msg of chats) {
      const p = msg.customerPhone;
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
      if (!msg.read && msg.sender === 'customer') {
        conv.unreadCount++;
      }
    }

    return Array.from(map.values()).sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));
  }

  sendMessage({ sender, customerPhone, customerName, message }) {
    if (!message || !message.trim()) throw new Error('Mensagem vazia.');
    const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
    if (!cleanPhone) throw new Error('Telefone do cliente é obrigatório para o chat.');

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
    const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
    const data = this.db.get();
    if (!data.chats) return;

    data.chats.forEach(m => {
      if (m.customerPhone === cleanPhone && m.sender === 'customer') {
        m.read = true;
      }
    });

    this.db.save();
  }
}

export const chatService = new ChatService();
