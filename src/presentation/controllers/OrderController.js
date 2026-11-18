import { orderService } from '../../application/services/OrderService.js';
import {
  isValidAdminToken,
  getAdminTokenFromRequest,
  verifyMotoboyToken,
  getMotoboyTokenFromRequest
} from '../middlewares/authMiddleware.js';
import { db } from '../../infrastructure/database/JsonDatabase.js';
import crypto from 'crypto';

/**
 * Função utilitária de conformidade LGPD:
 * Mascara dados pessoais sensíveis (endereço exato e telefone) para consultas anônimas
 */
export function maskSensitiveOrderData(order) {
  if (!order) return order;
  const clone = JSON.parse(JSON.stringify(order));

  // Nome do cliente: exibe apenas o primeiro nome
  if (clone.customer?.name) {
    const parts = clone.customer.name.trim().split(/\s+/);
    clone.customer.name = parts[0] || 'Cliente';
  }

  // Telefone: oculta dígitos intermediários mantendo apenas DDD e final
  if (clone.customer?.phone) {
    const clean = String(clone.customer.phone).replace(/\D/g, '');
    if (clean.length >= 10) {
      const ddd = clean.substring(0, 2);
      const last4 = clean.slice(-4);
      clone.customer.phone = `(${ddd}) 9****-${last4}`;
    } else {
      clone.customer.phone = 'Telefone protegido';
    }
  }

  // Endereço residencial: oculta número exato, referências e CEP
  if (clone.delivery) {
    if (clone.delivery.number) clone.delivery.number = '***';
    if (clone.delivery.reference) clone.delivery.reference = '***';
    if (clone.delivery.cep) clone.delivery.cep = '*****-***';
  }

  return clone;
}

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

      const isAdmin = isValidAdminToken(getAdminTokenFromRequest(req));
      const isMotoboy = verifyMotoboyToken(getMotoboyTokenFromRequest(req));

      // Se for motoboy buscando entregas pendentes em rota:
      if (motoboy === 'pending' || motoboy === 'true') {
        if (!isMotoboy && !isAdmin) {
          return res.status(401).json({
            ok: false,
            error: 'Acesso restrito ao entregador ou administrador. Token de motoboy inválido ou ausente.'
          });
        }
        const orders = orderService.getOrders({
          status: status || undefined
        }).filter(o => o.delivery?.type === 'delivery' && o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'returned');
        return res.json({ ok: true, orders });
      }

      // Se for consulta de histórico por telefone específico do cliente:
      if (phone) {
        const orders = orderService.getOrders({ customerPhone: phone, status });
        if (!isAdmin) {
          const masked = orders.map(o => maskSensitiveOrderData(o));
          return res.json({ ok: true, orders: masked });
        }
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

      const isAdmin = isValidAdminToken(getAdminTokenFromRequest(req));
      const isMotoboy = verifyMotoboyToken(getMotoboyTokenFromRequest(req));

      if (isAdmin || isMotoboy) {
        return res.json({ ok: true, order });
      }

      // Cliente anônimo ou rastreamento web: retorna com mascaramento defensivo
      return res.json({ ok: true, order: maskSensitiveOrderData(order) });
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

  /**
   * Endpoint LGPD: Anonimiza dados pessoais de um cliente preservando totais fiscais e financeiros
   */
  async anonymizeCustomer(req, res) {
    try {
      const { phone, customerPhone, orderId } = req.body || {};
      const targetPhone = String(customerPhone || phone || '').trim();
      const targetOrderId = String(orderId || '').trim();

      if (!targetPhone && !targetOrderId) {
        return res.status(400).json({ ok: false, error: 'Informe o telefone ou o ID do pedido do cliente para anonimização.' });
      }

      const data = db.get();
      const cleanTargetDigits = targetPhone.replace(/\D/g, '');
      let affectedOrders = 0;
      let affectedChats = 0;

      // 1. Anonimizar pedidos
      if (Array.isArray(data.orders)) {
        data.orders.forEach(o => {
          const oPhone = String(o.customer?.phone || '').replace(/\D/g, '');
          const match = (cleanTargetDigits && oPhone && cleanTargetDigits === oPhone) || (targetOrderId && o.id === targetOrderId);
          if (match) {
            affectedOrders++;
            o.customer = {
              name: 'Cliente Anonimizado (LGPD)',
              phone: '00000000000'
            };
            if (o.delivery) {
              o.delivery.street = 'Endereço Removido (LGPD)';
              o.delivery.number = '***';
              o.delivery.bairro = 'Bairro Removido';
              o.delivery.reference = '';
              o.delivery.cep = '00000-000';
            }
          }
        });
      }

      // 2. Anonimizar ou remover mensagens de chat
      if (Array.isArray(data.chats)) {
        data.chats.forEach(m => {
          const mDigits = String(m.customerPhone || '').replace(/\D/g, '');
          if (cleanTargetDigits && mDigits && cleanTargetDigits === mDigits) {
            affectedChats++;
            m.customerName = 'Cliente Anonimizado (LGPD)';
            m.customerPhone = '00000000000';
            m.message = '[Mensagem anonimizada em conformidade com a LGPD]';
          }
        });
      }

      db.save();

      return res.json({
        ok: true,
        message: 'Dados do titular anonimizados com sucesso em conformidade com a LGPD.',
        affectedOrders,
        affectedChats
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const orderController = new OrderController();
