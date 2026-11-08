import { WebSocketServer, WebSocket } from 'ws';

export class WebSocketHub {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
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
    // Pode repassar eventos ou rotear por tipo
    if (data.type === 'PING') {
      senderWs.send(JSON.stringify({ type: 'PONG' }));
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
    this.broadcast('NEW_ORDER', order);
  }

  notifyOrderStatus(order) {
    this.broadcast('ORDER_STATUS_CHANGED', order);
  }

  notifyChatMessage(chatMessage) {
    this.broadcast('CHAT_MESSAGE', chatMessage);
  }

  notifyPrintJob(printJob) {
    this.broadcast('PRINT_JOB', printJob);
  }
}

export const wsHub = new WebSocketHub();
