import { db } from '../database/JsonDatabase.js';

export class WhatsAppNotificationService {
  constructor() {
    this.db = db;
  }

  /**
   * Formata número de telefone para o padrão internacional do WhatsApp:
   * DDI 55 + DDD + Número (ex: 5516991098863)
   */
  formatPhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 10) return null;
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
      return digits;
    }
    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }
    return digits;
  }

  /**
   * Formata mensagem amigável de atualização de status do pedido
   * Modelos oficiais sem emojis (evita caracteres corrompidos no WhatsApp)
   */
  formatStatusMessage(order, targetStatus) {
    const status = targetStatus || order.status;
    const nome = (order.customer?.name || 'Cliente').trim();
    const numero = order.orderNo || '';

    switch (status) {
      case 'received':
        return `Olá, ${nome}! Seu pedido #${numero} na Explosão Açaí foi aceito! Já já começamos a preparar.`;
      case 'preparing':
        return `Seu pedido #${numero} já está sendo preparado com muito carinho!`;
      case 'ready':
      case 'out_for_delivery':
        if (order.delivery?.type !== 'delivery') {
          return `Boa notícia, ${nome}! Seu pedido #${numero} está pronto e já pode ser retirado na loja!`;
        }
        return `Boa notícia, ${nome}! Seu pedido #${numero} saiu para entrega e já está a caminho!`;
      case 'delivered':
        return `Obrigado por comprar com a Explosão Açaí, ${nome}! Esperamos que você curta sua explosão de sabor! Nos siga no Instagram: https://www.instagram.com/expl.osaoacai?mdxt=Zm1obWhpaTFhbmV3`;
      default:
        return null;
    }
  }

  /**
   * Formata mensagem completa com cópia do pedido
   */
  formatNewOrderReceipt(order) {
    const custName = (order.customer?.name || 'Cliente').trim();
    const orderNo = order.orderNo || '';
    const isDelivery = order.delivery?.type === 'delivery';

    const itemsSummary = (order.items || []).map(it => {
      let line = `• *${it.quantity}x* ${it.name}`;
      if (it.accompaniments?.length) line += `\n   - Acomp: ${it.accompaniments.join(', ')}`;
      if (it.extras?.length) line += `\n   - Extras: ${it.extras.join(', ')}`;
      if (it.fruits?.length) line += `\n   - Frutas: ${it.fruits.join(', ')}`;
      if (it.note) line += `\n   - Obs: ${it.note}`;
      return line;
    }).join('\n');

    const totalFmt = Number(order.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return `🍧 *COMPROVANTE DO PEDIDO #${orderNo} - EXPLOSÃO AÇAÍ* 🍧\n\n` +
      `Olá, *${custName}*!\n` +
      `Seu pedido foi registrado com sucesso!\n\n` +
      `📋 *ITENS:*\n${itemsSummary}\n\n` +
      `💵 *Total:* ${totalFmt} (${order.payment?.method || 'Pagamento'})\n` +
      `📍 *Entrega:* ${isDelivery ? `${order.delivery.street}, ${order.delivery.number} — ${order.delivery.bairro}` : 'Retirada no Balcão'}\n\n` +
      `Você receberá atualizações em tempo real quando o pedido entrar em preparo e sair para entrega!`;
  }

  /**
   * Dispara notificação automática de mudança de status se houver Gateway configurado
   */
  async notifyStatusChange(order, targetStatus = null) {
    if (!order || !order.customer?.phone) return;
    const settings = this.db.get().settings || {};

    const fullPhone = this.formatPhone(order.customer.phone);
    if (!fullPhone) return;

    const message = this.formatStatusMessage(order, targetStatus);
    if (!message) return;

    const apiUrl = process.env.WHATSAPP_API_URL || settings.whatsappApiUrl;
    const apiToken = process.env.WHATSAPP_API_TOKEN || settings.whatsappApiToken;

    // Se houver URL de Gateway de WhatsApp configurada (ex: Evolution API, Z-API, Baileys, etc.)
    if (apiUrl && apiToken) {
      try {
        await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${apiToken}`,
            'apikey': apiToken
          },
          body: JSON.stringify({
            number: fullPhone,
            phone: fullPhone,
            message: message,
            text: message
          })
        });
        console.log(`[WhatsApp Auto Notification] Mensagem de status (${targetStatus || order.status}) enviada com sucesso para ${fullPhone}`);
      } catch (err) {
        console.warn(`[WhatsApp Auto Notification] Falha ao enviar para ${fullPhone}:`, err.message);
      }
    }
  }

  /**
   * Dispara cópia automática do pedido para o WhatsApp do cliente se Gateway estiver ativo
   */
  async notifyNewOrder(order) {
    if (!order || !order.customer?.phone) return;
    const settings = this.db.get().settings || {};

    const fullPhone = this.formatPhone(order.customer.phone);
    if (!fullPhone) return;

    const message = this.formatNewOrderReceipt(order);
    const apiUrl = process.env.WHATSAPP_API_URL || settings.whatsappApiUrl;
    const apiToken = process.env.WHATSAPP_API_TOKEN || settings.whatsappApiToken;

    if (apiUrl && apiToken) {
      try {
        await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${apiToken}`,
            'apikey': apiToken
          },
          body: JSON.stringify({
            number: fullPhone,
            phone: fullPhone,
            message: message,
            text: message
          })
        });
        console.log(`[WhatsApp Auto Notification] Cópia do pedido enviada com sucesso para ${fullPhone}`);
      } catch (err) {
        console.warn(`[WhatsApp Auto Notification] Falha ao enviar cópia para ${fullPhone}:`, err.message);
      }
    }
  }
}

export const whatsAppNotificationService = new WhatsAppNotificationService();
