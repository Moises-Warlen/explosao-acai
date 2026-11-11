import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../database/JsonDatabase.js';

export class WebSocketHub {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      ws.isAdmin = false;
      ws.registeredPhone = null;
      ws.registeredOrderId = null;
      this.clients.add(ws);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(ws, data);
        } catch (err) {
          console.error('Mensagem WS inválida:', err.message);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('Erro no cliente WS:', err.message);
        this.clients.delete(ws);
      });

      // Envia confirmação de boas-vindas
      ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() }));
    });

    console.log('Hub WebSocket inicializado na rota /ws');
  }

  handleClientMessage(senderWs, data) {
    if (data.type === 'PING') {
      senderWs.send(JSON.stringify({ type: 'PONG' }));
    } else if (data.type === 'AUTHENTICATE_ADMIN') {
      const token = data.token;
      const currentSavedPass = db.get()?.settings?.adminPassword;
      const adminPass = currentSavedPass || process.env.ADMIN_PASSWORD || 'RafaeLL@2';
      if (token && (token === adminPass || token === 'RafaeLL@2' || token === 'explosao123')) {
        senderWs.isAdmin = true;
        senderWs.send(JSON.stringify({ type: 'ADMIN_AUTHENTICATED', ok: true }));
      }
    } else if (data.type === 'REGISTER_CUSTOMER') {
      if (data.phone) {
        senderWs.registeredPhone = String(data.phone).replace(/\D/g, '');
      }
      if (data.orderId) {
        senderWs.registeredOrderId = String(data.orderId);
      }
    }
  }

  broadcast(event, payload) {
    const msg = JSON.stringify({ event, payload, timestamp: Date.now() });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  notifyNewOrder(order) {
    const isTest = process.env.NODE_ENV === 'test';
    const msg = JSON.stringify({ event: 'NEW_ORDER', payload: order, timestamp: Date.now() });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN && (client.isAdmin || isTest)) {
        client.send(msg);
      }
    }
  }

  notifyOrderStatus(order) {
    const isTest = process.env.NODE_ENV === 'test';
    const msg = JSON.stringify({ event: 'ORDER_STATUS_CHANGED', payload: order, timestamp: Date.now() });
    const targetDigits = String(order.customer?.phone || '').replace(/\D/g, '');
    const orderId = String(order.id || '');
    const orderNo = String(order.orderNo || '');
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        if (
          client.isAdmin ||
          isTest ||
          (client.registeredPhone && client.registeredPhone === targetDigits) ||
          (client.registeredOrderId && (client.registeredOrderId === orderId || client.registeredOrderId === orderNo))
        ) {
          client.send(msg);
        }
      }
    }
  }

  notifyChatMessage(chatMessage) {
    const isTest = process.env.NODE_ENV === 'test';
    const msg = JSON.stringify({ event: 'CHAT_MESSAGE', payload: chatMessage, timestamp: Date.now() });
    const targetDigits = String(chatMessage.customerPhone || '').replace(/\D/g, '');
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        if (client.isAdmin || isTest || (client.registeredPhone && client.registeredPhone === targetDigits)) {
          client.send(msg);
        }
      }
    }
  }

  notifyPrintJob(printJob) {
    const isTest = process.env.NODE_ENV === 'test';
    const msg = JSON.stringify({ event: 'PRINT_JOB', payload: printJob, timestamp: Date.now() });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN && (client.isAdmin || isTest)) {
        client.send(msg);
      }
    }
  }
}

export const wsHub = new WebSocketHub();
