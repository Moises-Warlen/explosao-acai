/* =========================================================================
   CONTROLLER DE WEBHOOKS — MERCADO PAGO
   - Recebe notificações em tempo real do Mercado Pago (Webhooks & IPN)
   - Ao aprovar Pix ou Cartão: confirma status automaticamente e libera comanda
   ========================================================================= */

import { orderService } from '../../application/services/OrderService.js';
import { mercadoPagoService } from '../../infrastructure/payment/MercadoPagoService.js';

export class WebhookController {
  async handleMercadoPago(req, res) {
    try {
      const body = req.body || {};
      const query = req.query || {};

      // Extrai o ID do pagamento de qualquer formato de notificação do Mercado Pago
      let paymentId = body?.data?.id || body?.id || query?.id || query?.['data.id'];
      if (!paymentId && query?.resource) {
        paymentId = String(query.resource).split('/').pop();
      }

      const externalRef = body?.external_reference || query?.external_reference;

      console.log('[Webhook Mercado Pago] Notificação recebida:', { paymentId, externalRef, type: body?.type || query?.topic });

      if (paymentId) {
        const paymentInfo = await mercadoPagoService.getPaymentStatus(paymentId);

        if (paymentInfo && paymentInfo.status === 'approved') {
          const orders = orderService.getOrders();
          const order = orders.find(o => 
            String(o.payment?.transactionId) === String(paymentId) || 
            (externalRef && o.orderNo === String(externalRef))
          );

          if (order) {
            console.log(`[Webhook Mercado Pago] Pagamento aprovado para o Pedido #${order.orderNo}! Confirmando pedido no sistema...`);
            orderService.confirmPaymentApproved(order.id);
          }
        }
      }

      return res.status(200).send('OK');
    } catch (err) {
      console.error('[Webhook Mercado Pago] Erro ao processar:', err.message);
      return res.status(200).send('OK');
    }
  }

  /**
   * Endpoint de simulação / confirmação administrativa imediata
   */
  async simulatePaymentApproval(req, res) {
    try {
      const { orderId } = req.params;
      const updated = orderService.confirmPaymentApproved(orderId);
      if (!updated) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });

      return res.json({
        ok: true,
        message: 'Pagamento confirmado com sucesso! Pedido marcado como Pago no painel.',
        order: updated
      });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
}

export const webhookController = new WebhookController();
