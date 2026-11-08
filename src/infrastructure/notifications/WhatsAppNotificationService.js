import { db } from '../database/JsonDatabase.js';

export class WhatsAppNotificationService {
  constructor() {
    this.db = db;
  }

  /**
   * Formata mensagem amigável de atualização de status do pedido
   */
  formatStatusMessage(order) {
    const custName = order.customer?.name || 'Cliente';
    const orderNo = order.orderNo || '';
    const isDelivery = order.delivery?.type === 'delivery';

    switch (order.status) {
      case 'received':
        return `Olá, *${custName}*! 🍧\nSeu pedido *#${orderNo}* foi recebido com sucesso no *Explosão Açaí*!\nJá estamos na fila para prepará-lo.`;
      case 'preparing':
        return `Olá, *${custName}*! 🍧\nSeu pedido *#${orderNo}* no *Explosão Açaí* já começou a ser *PREPARADO* com todo capricho pela nossa cozinha!`;
      case 'out_for_delivery':
        return `Olá, *${custName}*! 🛵💨\nBoas notícias! Seu pedido *#${orderNo}* no *Explosão Açaí* acabou de *SAIR PARA ENTREGA* com nosso entregador! Fique atento ao portão / interfone.`;
      case 'ready':
        return `Olá, *${custName}*! 🛍️\nSeu pedido *#${orderNo}* no *Explosão Açaí* já está *PRONTO NO BALCÃO* aguardando sua retirada! Te esperamos na loja.`;
      case 'delivered':
        return `Olá, *${custName}*! ✅\nSeu pedido *#${orderNo}* foi entregue e finalizado com sucesso!\nMuito obrigado pela preferência no *Explosão Açaí* e tenha um ótimo momento! 💜`;
      case 'returned':
        return `Olá, *${custName}*. ↩️\nSeu pedido *#${orderNo}* retornou para a loja (${order.returnReason || 'cliente não localizado'}).\nEntre em contato conosco pelo chat ou WhatsApp para combinarmos o reenvio!`;
      case 'cancelled':
        return `Olá, *${custName}*. ⚠️\nInformamos que seu pedido *#${orderNo}* no *Explosão Açaí* foi cancelado (${order.cancellationReason || 'motivo operacional'}).\nEstamos à disposição para qualquer dúvida.`;
      default:
        return `Olá, *${custName}*! O status do seu pedido *#${orderNo}* na Explosão Açaí foi atualizado para: *${order.status}*.`;
    }
  }

  /**
   * Formata mensagem completa com cópia do pedido
   */
  formatNewOrderReceipt(order) {
    const custName = order.customer?.name || 'Cliente';
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
  async notifyStatusChange(order) {
    if (!order || !order.customer?.phone) return;
    const settings = this.db.get().settings || {};

    const phone = String(order.customer.phone).replace(/\D/g, '');
    if (!phone || phone.length < 10) return;

    const message = this.formatStatusMessage(order);

    // Se houver URL de Gateway de WhatsApp configurada (ex: Evolution API, Z-API, Baileys, etc.)
    if (settings.whatsappApiUrl && settings.whatsappApiToken) {
      try {
        const fullPhone = phone.startsWith('55') ? phone : `55${phone}`;
        await fetch(settings.whatsappApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.whatsappApiToken}`,
            'apikey': settings.whatsappApiToken
          },
          body: JSON.stringify({
            number: fullPhone,
            phone: fullPhone,
            message: message,
            text: message
          })
        });
        console.log(`[WhatsApp Auto Notification] Mensagem de status enviada com sucesso para ${fullPhone}`);
      } catch (err) {
        console.warn(`[WhatsApp Auto Notification] Falha ao enviar para ${phone}:`, err.message);
      }
    }
  }

  /**
   * Dispara cópia automática do pedido para o WhatsApp do cliente se Gateway estiver ativo
   */
  async notifyNewOrder(order) {
    if (!order || !order.customer?.phone) return;
    const settings = this.db.get().settings || {};

    const phone = String(order.customer.phone).replace(/\D/g, '');
    if (!phone || phone.length < 10) return;

    const message = this.formatNewOrderReceipt(order);

    if (settings.whatsappApiUrl && settings.whatsappApiToken) {
      try {
        const fullPhone = phone.startsWith('55') ? phone : `55${phone}`;
        await fetch(settings.whatsappApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.whatsappApiToken}`,
            'apikey': settings.whatsappApiToken
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
        console.warn(`[WhatsApp Auto Notification] Falha ao enviar cópia para ${phone}:`, err.message);
      }
    }
  }
}

export const whatsAppNotificationService = new WhatsAppNotificationService();
