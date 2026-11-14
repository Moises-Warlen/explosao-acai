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
import { freightService } from './FreightService.js';
import { wsHub } from '../../infrastructure/websockets/WebSocketHub.js';
import { whatsAppNotificationService } from '../../infrastructure/notifications/WhatsAppNotificationService.js';

export function getBrasiliaDateString(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

export class OrderService {
  constructor() {
    this.db = db;
    this.startPaymentAutoSync();
    this._lastArchivedBrasiliaDate = getBrasiliaDateString(new Date());
    this.archiveDailyCompletedOrders();
    this.startMidnightArchiveScheduler();
  }

  /**
   * Consulta periódica do status de pagamentos Pix pendentes no Mercado Pago como reserva
   */
  startPaymentAutoSync() {
    if (this._syncTimer) return;
    this._syncTimer = setInterval(async () => {
      try {
        const data = this.db.get();
        const pendingPix = (data.orders || []).filter(o =>
          o.payment?.method === PaymentMethod.PIX &&
          o.payment?.timing === 'online' &&
          o.payment?.status !== PaymentStatus.APPROVED &&
          o.status !== OrderStatus.CANCELLED &&
          o.status !== OrderStatus.RETURNED &&
          o.payment?.transactionId &&
          /^\d+$/.test(String(o.payment.transactionId))
        );

        for (const ord of pendingPix) {
          const statusInfo = await mercadoPagoService.getPaymentStatus(ord.payment.transactionId);
          if (statusInfo && statusInfo.status === 'approved') {
            console.log(`[Auto-Sync Reserva] Pix aprovado para o Pedido #${ord.orderNo}`);
            this.confirmPaymentApproved(ord.id);
          }
        }
      } catch (e) {}
    }, 8000);

    // Permite que o processo Node finalize normalmente durante testes
    if (this._syncTimer && typeof this._syncTimer.unref === 'function') {
      this._syncTimer.unref();
    }
  }

  getOrders(filters = {}) {
    let orders = this.db.get().orders || [];
    if (filters.status) {
      orders = orders.filter(o => o.status === filters.status);
    }
    if (filters.customerPhone) {
      orders = orders.filter(o => o.customer.phone === filters.customerPhone);
    }
    if (filters.archivedToHistory !== undefined) {
      orders = orders.filter(o => Boolean(o.archivedToHistory) === Boolean(filters.archivedToHistory));
    }
    return orders.map(o => new Order(o)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Automação Diária: move pedidos de "Entregues Hoje" para "Pedidos Concluídos" (Histórico permanente)
   * Processa todos os pedidos com status 'delivered' cuja data de entrega seja anterior à data atual em Brasília (America/Sao_Paulo).
   * Também atua como rotina de recuperação caso o sistema tenha ficado offline ou reiniciado na virada do dia.
   */
  archiveDailyCompletedOrders(forcedTargetDate = null) {
    const data = this.db.get();
    if (!data.orders || !Array.isArray(data.orders)) return { count: 0, todayBrasilia: '' };

    const todayBrasilia = forcedTargetDate || getBrasiliaDateString(new Date());
    let count = 0;
    const now = new Date();

    for (const order of data.orders) {
      if (order.status === OrderStatus.DELIVERED && !order.archivedToHistory) {
        const orderDate = getBrasiliaDateString(order.deliveredAt || order.createdAt);
        // Se a data de conclusão for anterior ao dia de hoje em Brasília, arquiva para o histórico permanente
        if (orderDate && orderDate < todayBrasilia) {
          order.archivedToHistory = true;
          order.archivedAt = now.toISOString();
          order.updatedAt = now.toISOString();
          count++;
        }
      }
    }

    if (count > 0) {
      this.db.save();
      console.log(`[Automação Diária Brasília] ${count} pedido(s) concluído(s) arquivado(s) permanentemente para a coluna Pedidos Concluídos (${todayBrasilia}).`);
      wsHub.broadcast('ORDERS_ARCHIVED', { todayBrasilia, count });
    }

    return { count, todayBrasilia };
  }

  /**
   * Agendador contínuo para virada do dia à meia-noite (00:00) no fuso horário de Brasília (America/Sao_Paulo)
   */
  startMidnightArchiveScheduler() {
    if (this._midnightTimer) return;
    this._midnightTimer = setInterval(() => {
      try {
        const currentBrasiliaDate = getBrasiliaDateString(new Date());
        if (currentBrasiliaDate && currentBrasiliaDate !== this._lastArchivedBrasiliaDate) {
          console.log(`[Virada de Dia Brasília 00:00] Transição detectada de ${this._lastArchivedBrasiliaDate} para ${currentBrasiliaDate}. Executando arquivamento diário...`);
          this.archiveDailyCompletedOrders(currentBrasiliaDate);
          this._lastArchivedBrasiliaDate = currentBrasiliaDate;
        }
      } catch (e) {
        console.error('[Erro Scheduler Meia-Noite]:', e.message);
      }
    }, 15000);

    if (this._midnightTimer && typeof this._midnightTimer.unref === 'function') {
      this._midnightTimer.unref();
    }
  }

  getOrderById(id) {
    const orders = this.db.get().orders || [];
    const found = orders.find(o => o.id === id || o.orderNo === String(id));
    return found ? new Order(found) : null;
  }

  async createOrder({ customer, delivery, items, payment, couponCode, bypassStoreClosed = false }) {
    // 1. Verifica status de funcionamento da loja
    const storeStatus = storeService.isStoreOpen();
    if (!storeStatus.isOpen && !bypassStoreClosed && process.env.NODE_ENV !== 'test') {
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

      // Busca produto correspondente no catálogo oficial
      const baseProduct = (catalog.products || []).find(p =>
        (item.productId && p.id === item.productId) ||
        (item.id && p.id === item.id) ||
        item.name.includes(p.name) ||
        p.name.includes(item.name)
      );

      if (baseProduct) {
        let sizePrice = null;
        if (item.size && Array.isArray(baseProduct.prices)) {
          sizePrice = baseProduct.prices.find(pr => Number(pr.size) === Number(item.size));
        }
        if (!sizePrice && Array.isArray(baseProduct.prices) && baseProduct.prices.length > 0) {
          sizePrice = baseProduct.prices[0];
        }

        if (sizePrice) {
          if (sizePrice.costPrice) {
            itemCost += sizePrice.costPrice;
          }
          // Preço oficial do cardápio
          const officialBasePrice = sizePrice.promoPrice != null ? sizePrice.promoPrice : sizePrice.price;

          // Adicionais extras oficiais
          let extrasTotal = 0;
          if (Array.isArray(item.extras) && Array.isArray(catalog.extras)) {
            item.extras.forEach(ext => {
              const extId = typeof ext === 'string' ? ext : ext.id;
              const foundExt = catalog.extras.find(e => e.id === extId || e.name === extId || e.name === ext?.name);
              if (foundExt) {
                if (foundExt.isFruitExtra && Array.isArray(item.fruits)) {
                  extrasTotal += Number(foundExt.price || 0) * item.fruits.length;
                } else {
                  extrasTotal += Number(foundExt.price || 0);
                }
              }
            });
          }

          const expectedUnitPrice = officialBasePrice + extrasTotal;
          // Proteção financeira: se o item for enviado com preço zerado ou negativo, assume o preço oficial
          if (!unitPrice || unitPrice <= 0) {
            unitPrice = expectedUnitPrice;
          }
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
      }
    }

    // 5. Calcula Frete (Regra: Até 2 km a entrega é GRÁTIS!)
    let freight = 0;
    if (delivery && delivery.type === 'delivery') {
      const freeKmThreshold = catalog.settings?.freeKmThreshold !== undefined ? Number(catalog.settings.freeKmThreshold) : 2.0;
      const minFreight = catalog.settings?.minFreight !== undefined ? Number(catalog.settings.minFreight) : 4.5;
      const perKmRate = catalog.settings?.perKmRate !== undefined ? Number(catalog.settings.perKmRate) : 1.0;

      let km = Number(delivery.km || 0);

      // Se km não foi fornecido ou precisa ser calculado pelo endereço:
      if (km <= 0 && (delivery.street || delivery.bairro || delivery.cep)) {
        const calc = await freightService.calculateFreightForAddress({
          street: delivery.street,
          number: delivery.number,
          bairro: delivery.bairro,
          cep: delivery.cep,
          city: delivery.city,
          state: delivery.state
        });
        km = calc.km;
        delivery.km = km;
        freight = calc.freight;
      } else if (km > 0 && km <= freeKmThreshold) {
        freight = 0; // Entrega GRÁTIS até 2 km
      } else {
        freight = delivery.freight !== undefined && Number(delivery.freight) >= minFreight
          ? Number(delivery.freight)
          : Math.max(minFreight, Math.ceil(km * perKmRate * 2) / 2);
      }
      delivery.freight = freight;
      delivery.km = km;
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
      status: OrderStatus.RECEIVED,
      notifiedStatuses: ['received']
    });

    // 9. Persiste no banco de dados
    const data = this.db.get();
    data.orders.push(newOrder);
    this.db.save();

    // Incrementa cupom com segurança após pedido salvo
    if (appliedCoupon && appliedCoupon.code) {
      couponService.incrementUsage(appliedCoupon.code);
    }

    // 10. Emite evento em tempo real via WebSocket para o Painel Administrativo
    wsHub.notifyNewOrder(newOrder);

    // 11. Dispara mensagem no WhatsApp do cliente: Pedido feito / aceito
    // Se o pagamento for online (Pix) e ainda estiver pendente, NÃO avisa que foi aceito nem inicia preparo!
    // O pedido só é aceito e enviado para a cozinha após a confirmação bancária do pagamento.
    const isOnlinePending = newOrder.payment?.timing === 'online' && newOrder.payment?.status !== PaymentStatus.APPROVED;
    if (!isOnlinePending) {
      whatsAppNotificationService.notifyStatusChange(newOrder, 'received').catch(() => {});
    }

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

    // Regra de Integridade Financeira: pedidos online (Pix) pendentes NÃO podem avançar para produção sem confirmação bancária
    if (order.payment?.timing === 'online' && order.payment?.status !== PaymentStatus.APPROVED) {
      if (newStatus === OrderStatus.PREPARING || newStatus === OrderStatus.READY || newStatus === OrderStatus.OUT_FOR_DELIVERY) {
        throw new Error('Pagamento Pix pendente. Confirme o pagamento do Pix antes de aceitar o pedido ou enviá-lo para a cozinha.');
      }
    }

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

    // Regra: Cada mensagem é enviada UMA única vez por mudança de status
    if (!Array.isArray(order.notifiedStatuses)) {
      order.notifiedStatuses = [];
    }
    const statusKey = (newStatus === OrderStatus.READY || newStatus === OrderStatus.OUT_FOR_DELIVERY) ? 'out_for_delivery' : newStatus;
    let shouldNotifyWpp = false;
    if (!order.notifiedStatuses.includes(statusKey)) {
      order.notifiedStatuses.push(statusKey);
      shouldNotifyWpp = true;
    }

    this.db.save();

    const updated = new Order(order);
    wsHub.notifyOrderStatus(updated);

    if (shouldNotifyWpp) {
      whatsAppNotificationService.notifyStatusChange(updated, newStatus).catch(() => {});
    }

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
   * Dispara a impressão térmica de imediato e atualiza o status para Pago no painel!
   */
  confirmPaymentApproved(orderId) {
    const data = this.db.get();
    const orderIndex = data.orders.findIndex(o => o.id === orderId || o.orderNo === String(orderId));
    if (orderIndex === -1) return null;

    const order = data.orders[orderIndex];

    // Evita duplicidade: se já aprovado anteriormente, não reprocessa
    if (order.payment?.status === PaymentStatus.APPROVED) {
      return new Order(order);
    }

    order.payment.status = PaymentStatus.APPROVED;
    order.payment.paidAt = new Date().toISOString();
    order.status = OrderStatus.PREPARING;
    order.updatedAt = new Date().toISOString();

    // Notificação WhatsApp para 'Em preparo' (apenas uma única vez)
    if (!Array.isArray(order.notifiedStatuses)) {
      order.notifiedStatuses = [];
    }
    let shouldNotifyWpp = false;
    if (!order.notifiedStatuses.includes('preparing')) {
      order.notifiedStatuses.push('preparing');
      shouldNotifyWpp = true;
    }

    this.db.save();

    const updated = new Order(order);
    wsHub.notifyOrderStatus(updated);

    // AGORA QUE O BANCO CONFIRMOU: DISPARA A IMPRESSÃO!
    this.autoPrintIfConfigured(updated);

    if (shouldNotifyWpp) {
      whatsAppNotificationService.notifyStatusChange(updated, OrderStatus.PREPARING).catch(() => {});
    }

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

    // Notificação WhatsApp para 'Entregue' (apenas uma única vez)
    if (!Array.isArray(order.notifiedStatuses)) {
      order.notifiedStatuses = [];
    }
    let shouldNotifyWpp = false;
    if (!order.notifiedStatuses.includes('delivered')) {
      order.notifiedStatuses.push('delivered');
      shouldNotifyWpp = true;
    }

    this.db.save();

    const updated = new Order(order);
    wsHub.notifyOrderStatus(updated);

    if (shouldNotifyWpp) {
      whatsAppNotificationService.notifyStatusChange(updated, OrderStatus.DELIVERED).catch(() => {});
    }

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
          // Não re-imprime automaticamente se a comanda já foi impressa nesta estação
          if (Array.isArray(order.printedStations) && order.printedStations.includes(target)) {
            continue;
          }
          this.printOrder(order.id, target, printer.id);
        }
      }
    } catch (err) {
      console.warn('Auto-impressão aguardando:', err.message);
    }
  }
}

export const orderService = new OrderService();
