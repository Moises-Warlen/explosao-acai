import { chatService } from '../../application/services/ChatService.js';

export class ChatController {
  async getMessages(req, res) {
    try {
      const phone = req.params.phone || req.query.phone;
      const messages = chatService.getMessages(phone);
      if (phone && req.query.markRead === 'true') {
        chatService.markAsRead(phone);
      }
      return res.json({ ok: true, messages });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async getConversations(req, res) {
    try {
      const conversations = chatService.getAllConversations();
      return res.json({ ok: true, conversations });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async sendMessage(req, res) {
    try {
      const { sender, customerPhone, customerName, message } = req.body;
      const newMsg = chatService.sendMessage({ sender, customerPhone, customerName, message });
      return res.status(201).json({ ok: true, message: newMsg });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
}

export const chatController = new ChatController();
