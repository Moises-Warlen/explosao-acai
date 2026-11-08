import { orderService } from '../../application/services/OrderService.js';

export class OrderController {
  async create(req, res) {
    try {
      const order = await orderService.createOrder(req.body);
      return res.status(201).json({ ok: true, order });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async getAll(req, res) {
    try {
      const { status, phone } = req.query;
      const orders = orderService.getOrders({ status, customerPhone: phone });
      return res.json({ ok: true, orders });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async getById(req, res) {
    try {
      const order = orderService.getOrderById(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
      return res.json({ ok: true, order });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const { status, reason } = req.body;
      if (!status) return res.status(400).json({ ok: false, error: 'Status é obrigatório.' });
      const order = orderService.updateOrderStatus(req.params.id, status, reason);
      return res.json({ ok: true, order });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async printTicket(req, res) {
    try {
      const { target, printerId } = req.body;
      const printJob = orderService.printOrder(req.params.id, target || 'counter', printerId);
      return res.json({ ok: true, printJob });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async confirmDelivery(req, res) {
    try {
      const order = orderService.confirmDeliveryAndPayment(req.params.id);
      return res.json({ ok: true, order });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
}

export const orderController = new OrderController();
