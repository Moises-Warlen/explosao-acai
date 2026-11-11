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
      const { status, phone, motoboy } = req.query;

      // Validação de acesso administrativo ou escopo restrito (motoboy / cliente)
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
      const token = req.headers['x-admin-token'] || bearerToken || req.query.t;
      const currentSavedPass = orderService.db.get()?.settings?.adminPassword;
      const adminPass = currentSavedPass || process.env.ADMIN_PASSWORD || 'RafaeLL@2';
      const isTest = process.env.NODE_ENV === 'test';
      const isAdmin = token && (token === adminPass || (isTest && (token === 'RafaeLL@2' || token === 'explosao123')));

      // Se for motoboy buscando entregas pendentes em rota:
      if (motoboy === 'pending' || motoboy === 'true') {
        const orders = orderService.getOrders({
          status: status || undefined
        }).filter(o => o.delivery?.type === 'delivery' && o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'returned');
        return res.json({ ok: true, orders });
      }

      // Se for consulta de histórico por telefone específico do cliente:
      if (phone) {
        const orders = orderService.getOrders({ customerPhone: phone, status });
        return res.json({ ok: true, orders });
      }

      // Para ver todos os pedidos gerais da loja, exige credencial administrativa:
      if (!isAdmin) {
        return res.status(401).json({
          ok: false,
          error: 'Acesso restrito ao painel administrativo da Explosão Açaí.'
        });
      }

      const orders = orderService.getOrders({ status });
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

  async returnOrder(req, res) {
    try {
      const { reason } = req.body;
      const order = orderService.returnOrder(req.params.id, reason);
      return res.json({ ok: true, order });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async archiveDaily(req, res) {
    try {
      const { targetDate } = req.body || {};
      const result = orderService.archiveDailyCompletedOrders(targetDate);
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const orderController = new OrderController();
