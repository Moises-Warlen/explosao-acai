/* =========================================================================
   CONTROLLER DE WEBHOOKS — MERCADO PAGO
   - Recebe notificações em tempo real do Mercado Pago
   - Ao aprovar Pix ou Cartão: confirma status e libera impressão automática imediata
   ========================================================================= */

import { orderService } from '../../application/services/OrderService.js';
import { mercadoPagoService } from '../../infrastructure/payment/MercadoPagoService.js';

export class WebhookController {
  async handleMercadoPago(req, res) {
    try {
      const { type, data, action } = req.body;
      console.log('Webhook recebido do Mercado Pago:', { type, action, data });

      if (type === 'payment' && data?.id) {
        const paymentInfo = await mercadoPagoService.getPaymentStatus(data.id);

        if (paymentInfo.status === 'approved') {
          const orders = orderService.getOrders();
          const order = orders.find(o => 
            o.payment?.transactionId === String(data.id) || 
            o.orderNo === String(req.body.external_reference)
          );

          if (order) {
            console.log(`Pagamento confirmado pelo banco para o Pedido #${order.orderNo}! Liberando impressão...`);
            orderService.confirmPaymentApproved(order.id);
          }
        }
      }

      return res.status(200).send('OK');
    } catch (err) {
      console.error('Erro ao processar Webhook do Mercado Pago:', err);
      return res.status(200).send('OK');
    }
  }

  /**
   * Endpoint de simulação para desenvolvimento/portfólio
   * Permite simular a confirmação bancária imediata
   */
  async simulatePaymentApproval(req, res) {
    try {
      const { orderId } = req.params;
      const updated = orderService.confirmPaymentApproved(orderId);
      if (!updated) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });

      return res.json({
        ok: true,
        message: 'Pagamento confirmado com sucesso! Comanda enviada para impressão.',
        order: updated
      });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
}

export const webhookController = new WebhookController();
