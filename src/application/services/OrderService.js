/* =========================================================================
   SERVIÇO DE PROCESSAMENTO DE PEDIDOS — EXPLOSÃO AÇAÍ
   - Regra de Impressão Rígida: Só imprime Pix e Cartão após confirmação bancária
   - Dinheiro com troco: impressão liberada imediatamente
   - Cálculo automático do custo de insumos do pedido para relatório de lucro
   - Sincronização em tempo real via WebSockets
   ========================================================================= */

import { db } from '../../infrastructure/database/JsonDatabase.js';
import { Order, OrderStatus, PaymentMethod, PaymentStatus } from '../../domain/entities/Order.js';
import { mercadoPagoService } from '../../infrastructure/payment/MercadoPagoService.js';
import { thermalPrinterService } from '../../infrastructure/printing/ThermalPrinterService.js';
import { couponService } from './CouponService.js';
import { storeService } from './StoreService.js';
import { wsHub } from '../../infrastructure/websockets/WebSocketHub.js';
import { whatsAppNotificationService } from '../../infrastructure/notifications/WhatsAppNotificationService.js';

export class OrderService {
  constructor() {
    this.db = db;
  }

  getOrders(filters = {}) {
    let orders = this.db.get().orders || [];
    if (filters.status) {
      orders = orders.filter(o => o.status === filters.status);
    }
    if (filters.customerPhone) {
      orders = orders.filter(o => o.customer.phone === filters.customerPhone);
    }
    return orders.map(o => new Order(o)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getOrderById(id) {
    const orders = this.db.get().orders || [];
    const found = orders.find(o => o.id === id || o.orderNo === String(id));
    return found ? new Order(found) : null;
  }

  async createOrder({ customer, delivery, items, payment, couponCode, bypassStoreClosed = false }) {
    // 1. Verifica status de funcionamento da loja
    const storeStatus = storeService.isStoreOpen();
    if (!storeStatus.isOpen && !bypassStoreClosed) {
      throw new Error(`A loja está fechada no momento: ${storeStatus.message}`);
    }

    // 2. Valida cliente
    if (!customer || !customer.name || !customer.phone) {
      throw new Error('Nome e telefone do cliente são obrigatórios.');
    }
    const cleanPhone = String(customer.phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      throw new Error('Telefone do cliente inválido.');
    }

    // 3. Valida itens, calcula subtotal e calcula custo total de insumos
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('O carrinho está vazio.');
    }

    const catalog = this.db.get();
    let subtotal = 0;
    let orderCostTotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const quantity = Math.max(1, Number(item.quantity || 1));
      let unitPrice = Number(item.unitPrice || 0);
      let itemCost = 0;

      // Busca custo cadastrado do produto
      const baseProduct = (catalog.products || []).find(p => item.name.includes(p.name));
      if (baseProduct && item.size) {
        const sizePrice = (baseProduct.prices || []).find(pr => pr.size === Number(item.size));
        if (sizePrice && sizePrice.costPrice) {
          itemCost += sizePrice.costPrice;
        }
      }

      const itemSubtotal = unitPrice * quantity;
      subtotal += itemSubtotal;
      orderCostTotal += itemCost * quantity;

      validatedItems.push({
        name: item.name,
        size: item.size || null,
        quantity,
        unitPrice,
        costPrice: itemCost,
        subtotal: itemSubtotal,
        accompaniments: item.accompaniments || [],
        extras: item.extras || [],
        fruits: item.fruits || [],
        note: item.note || ''
      });
    }

    // 4. Aplica Cupom de Desconto se houver
    let discount = 0;
    let appliedCoupon = null;
    if (couponCode) {
      const check = couponService.validateCoupon(couponCode, subtotal);
      if (check.valid) {
        discount = check.coupon.discount;
        appliedCoupon = { code: check.coupon.code, discountValue: discount };
        couponService.incrementUsage(couponCode);
      }
    }

    // 5. Calcula Frete (Regra: Até 2 km a entrega é GRÁTIS!)
    let freight = 0;
    if (delivery && delivery.type === 'delivery') {
      const km = Number(delivery.km || 0);
      const freeKmThreshold = catalog.settings?.freeKmThreshold !== undefined ? Number(catalog.settings.freeKmThreshold) : 2.0;

      if (km > 0 && km <= freeKmThreshold) {
        freight = 0; // Entrega GRÁTIS até 2 km
      } else {
        freight = Number(delivery.freight || 0);
        const minFreight = catalog.settings?.minFreight || 4.5;
        if (freight < minFreight && freight > 0) {
          freight = minFreight;
        } else if (freight === 0 && km > freeKmThreshold) {
          freight = minFreight;
        }
      }
    }

    // 6. Total Geral
    const total = Math.max(0, subtotal - discount + freight);

    // 7. Processa Pagamento
    const orderNo = String(Math.floor(100000 + Math.random() * 900000));
    const timing = payment.timing === 'delivery' || payment.method === PaymentMethod.MONEY ? 'delivery' : 'online';

    let paymentDetails = {
      method: payment.method || PaymentMethod.MONEY,
      timing, // 'online' ou 'delivery'
      status: timing === 'delivery' ? PaymentStatus.PAY_ON_DELIVERY : PaymentStatus.PENDING,
      changeFor: payment.changeFor || null,
      trocoValue: 0
    };

    if (timing === 'online' && payment.method === PaymentMethod.PIX) {
      const pixResult = await mercadoPagoService.createPixPayment({
        orderNo,
        total,
        customer,
        items: validatedItems
      });

      paymentDetails.status = pixResult.status || PaymentStatus.PENDING;
      paymentDetails.qrCode = pixResult.qrCode;
      paymentDetails.qrCodeBase64 = pixResult.qrCodeBase64;
      paymentDetails.transactionId = pixResult.id;
      paymentDetails.ticketUrl = pixResult.ticketUrl;
      paymentDetails.isMock = pixResult.isMock;

    } else if (timing === 'online' && (payment.method === PaymentMethod.CREDIT_CARD || payment.method === PaymentMethod.DEBIT_CARD)) {
      if (payment.cardToken) {
        const cardResult = await mercadoPagoService.processCardPayment({
          orderNo,
          total,
          token: payment.cardToken,
          paymentMethodId: payment.paymentMethodId,
          customer
        });
        paymentDetails.status = cardResult.status;
        paymentDetails.transactionId = cardResult.id;
      } else {
        paymentDetails.status = PaymentStatus.PENDING;
      }

    } else if (payment.method === PaymentMethod.MONEY) {
      // Dinheiro: cobrança na entrega com troco calculado
      paymentDetails.timing = 'delivery';
      paymentDetails.status = PaymentStatus.PAY_ON_DELIVERY;
      const changeNum = parseFloat(String(payment.changeFor || '').replace(',', '.').replace(/[^\d.]/g, ''));
      if (changeNum && changeNum > total) {
        paymentDetails.trocoValue = Number((changeNum - total).toFixed(2));
      }
    } else if (timing === 'delivery') {
      // Cartão na maquininha levada pelo motoboy
      paymentDetails.status = PaymentStatus.PAY_ON_DELIVERY;
    }

    // 8. Cria entidade Order
    const newOrder = new Order({
      orderNo,
      customer: {
        name: customer.name.trim(),
        phone: cleanPhone
      },
      delivery: delivery?.type === 'delivery' ? {
        type: 'delivery',
        street: delivery.street || '',
        number: delivery.number || '',
        bairro: delivery.bairro || '',
        city: delivery.city || 'Franca',
        state: delivery.state || 'SP',
        cep: delivery.cep || '',
        reference: delivery.reference || '',
        km: Number(delivery.km || 0),
        freight
      } : { type: 'pickup' },
      items: validatedItems,
      payment: paymentDetails,
      coupon: appliedCoupon,
      subtotal,
      discount,
      freight,
      total,
      costTotal: Number(orderCostTotal.toFixed(2)),
      status: OrderStatus.RECEIVED
    });

    // 9. Persiste no banco de dados
    const data = this.db.get();
    data.orders.push(newOrder);
    this.db.save();

    // 10. Emite evento em tempo real via WebSocket para o Painel Administrativo
    wsHub.notifyNewOrder(newOrder);

    // 11. Dispara cópia do pedido no WhatsApp se Gateway configurado
    whatsAppNotificationService.notifyNewOrder(newOrder).catch(() => {});

    // 12. REGRA DE IMPRESSÃO: Auto-impressão imediata se for Dinheiro ou Cartão na Entrega!
    // Pagamentos online (Pix e Cartão Online) SÓ IMPRIMEM depois que o banco confirmar o pagamento!
    if (newOrder.canPrint().allowed) {
      this.autoPrintIfConfigured(newOrder);
    }

    return newOrder;
  }

  updateOrderStatus(orderId, newStatus, cancellationReason = null) {
    const data = this.db.get();
    const orderIndex = data.orders.findIndex(o => o.id === orderId || o.orderNo === String(orderId));
    if (orderIndex === -1) throw new Error('Pedido não encontrado.');

    const order = data.orders[orderIndex];
    const now = new Date();

    // Rastreia tempos de produção e logística para relatórios executivos
    if ((newStatus === OrderStatus.READY || newStatus === OrderStatus.OUT_FOR_DELIVERY) && !order.preparedAt) {
      order.preparedAt = now.toISOString();
      const createdTime = new Date(order.createdAt).getTime();
      order.preparationTimeMinutes = Math.max(1, Math.round((now.getTime() - createdTime) / 60000));
    }

    if (newStatus === OrderStatus.DELIVERED && !order.deliveredAt) {
      order.deliveredAt = now.toISOString();
      const baseTime = order.preparedAt ? new Date(order.preparedAt).getTime() : new Date(order.createdAt).getTime();
      order.deliveryTimeMinutes = Math.max(1, Math.round((now.getTime() - baseTime) / 60000));
    }

    if (newStatus === OrderStatus.CANCELLED) {
      order.cancellationReason = cancellationReason || 'Cancelado pelo operador';
      order.cancelledAt = now.toISOString();
    }

    if (newStatus === OrderStatus.RETURNED) {
      order.returnReason = cancellationReason || 'Devolvido pelo entregador / não entregue';
      order.returnedAt = now.toISOString();
    }

    order.status = newStatus;
    order.updatedAt = now.toISOString();

    this.db.save();

    const updated = new Order(order);
    wsHub.notifyOrderStatus(updated);
    whatsAppNotificationService.notifyStatusChange(updated).catch(() => {});

    return updated;
  }

  returnOrder(orderId, returnReason = null) {
    return this.updateOrderStatus(orderId, OrderStatus.RETURNED, returnReason || 'Devolvido pelo entregador / não entregue');
  }

  cancelOrder(orderId, cancellationReason = null) {
    return this.updateOrderStatus(orderId, OrderStatus.CANCELLED, cancellationReason || 'Cancelado pelo operador');
  }

  /**
   * Confirmação de Pagamento aprovado pelo Banco / Webhook
   * Dispara a impressão térmica de imediato!
   */
  confirmPaymentApproved(orderId) {
    const data = this.db.get();
    const orderIndex = data.orders.findIndex(o => o.id === orderId || o.orderNo === String(orderId));
    if (orderIndex === -1) return null;

    data.orders[orderIndex].payment.status = PaymentStatus.APPROVED;
    data.orders[orderIndex].status = OrderStatus.PREPARING;
    data.orders[orderIndex].updatedAt = new Date().toISOString();
    this.db.save();

    const updated = new Order(data.orders[orderIndex]);
    wsHub.notifyOrderStatus(updated);

    // AGORA QUE O BANCO CONFIRMOU: DISPARA A IMPRESSÃO!
    this.autoPrintIfConfigured(updated);

    return updated;
  }

  /**
   * Confirmação de Entrega & Recebimento pelo Entregador ou Operador
   * Marca o pedido como entregue (DELIVERED) e pagamento como aprovado (APPROVED).
   */
  confirmDeliveryAndPayment(orderId) {
    const data = this.db.get();
    const orderIndex = data.orders.findIndex(o => o.id === orderId || o.orderNo === String(orderId));
    if (orderIndex === -1) throw new Error('Pedido não encontrado.');

    const order = data.orders[orderIndex];
    const now = new Date();

    order.status = OrderStatus.DELIVERED;
    order.deliveredAt = now.toISOString();

    const baseTime = order.preparedAt ? new Date(order.preparedAt).getTime() : new Date(order.createdAt).getTime();
    order.deliveryTimeMinutes = Math.max(1, Math.round((now.getTime() - baseTime) / 60000));

    // Confirma pagamento
    if (order.payment) {
      order.payment.status = PaymentStatus.APPROVED;
      order.payment.paidAt = now.toISOString();
    }
    order.updatedAt = now.toISOString();
    this.db.save();

    const updated = new Order(order);
    wsHub.notifyOrderStatus(updated);
    whatsAppNotificationService.notifyStatusChange(updated).catch(() => {});

    return updated;
  }

  /**
   * Dispara impressão para impressoras configuradas (cozinha ou balcão)
   * APLICA REGRA RÍGIDA: Só imprime Pix e Cartão após confirmação bancária!
   */
  printOrder(orderId, target = 'counter', printerId = null) {
    const order = this.getOrderById(orderId);
    if (!order) throw new Error('Pedido não encontrado.');

    // VERIFICAÇÃO DE REGRA DE NEGÓCIO DE IMPRESSÃO
    const printCheck = order.canPrint();
    if (!printCheck.allowed) {
      throw new Error(printCheck.reason);
    }

    let paperWidth = 80;
    if (printerId) {
      const printer = thermalPrinterService.getPrinterById(printerId);
      if (printer) {
        paperWidth = printer.paperWidth || 80;
        target = printer.target || target;
      }
    }

    const ticketText = thermalPrinterService.generateTicket(order, target, paperWidth);
    const escposBuffer = thermalPrinterService.toEscPosBuffer(ticketText);

    const data = this.db.get();
    const idx = data.orders.findIndex(o => o.id === order.id);
    if (idx !== -1) {
      if (!data.orders[idx].printedStations) data.orders[idx].printedStations = [];
      if (!data.orders[idx].printedStations.includes(target)) {
        data.orders[idx].printedStations.push(target);
      }
      data.orders[idx].printed = true;
      this.db.save();
    }

    const printJob = {
      orderId: order.id,
      orderNo: order.orderNo,
      target,
      paperWidth,
      ticketText,
      escposHex: escposBuffer.toString('hex')
    };

    wsHub.notifyPrintJob(printJob);

    return printJob;
  }

  autoPrintIfConfigured(order) {
    try {
      // Confere se está liberado para imprimir
      if (!order.canPrint().allowed) {
        return;
      }

      const printers = thermalPrinterService.getPrinters();
      for (const printer of printers) {
        if (printer.autoPrintOnApproved) {
          const target = printer.target === 'all' ? 'counter' : printer.target;
          this.printOrder(order.id, target, printer.id);
        }
      }
    } catch (err) {
      console.warn('Auto-impressão aguardando:', err.message);
    }
  }
}

export const orderService = new OrderService();
