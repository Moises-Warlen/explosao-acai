/* =========================================================================
   ENTIDADE ORDER (DOMÍNIO) — EXPLOSÃO AÇAÍ
   - Status formais sem ícones informais
   - Controle claro de Pagamento Online vs Pagamento na Entrega
   - Regra de Impressão Rígida e Tempos Operacionais de Preparo e Entrega
   ========================================================================= */

export const OrderStatus = {
  RECEIVED: 'received',                 // Pedido recebido / aguardando confirmação
  PREPARING: 'preparing',               // Em preparo na cozinha
  READY: 'ready',                       // Pronto para entrega ou retirada
  OUT_FOR_DELIVERY: 'out_for_delivery', // Saiu para entrega (em rota com entregador)
  DELIVERED: 'delivered',               // Entregue / Concluído
  CANCELLED: 'cancelled',               // Cancelado
  RETURNED: 'returned'                  // Devolvido à loja (não entregue)
};

export const PaymentMethod = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  MONEY: 'Dinheiro'
};

export const PaymentStatus = {
  PENDING: 'pending',                   // Aguardando confirmação bancária
  APPROVED: 'approved',                 // Confirmado pelo banco/gateway
  PAY_ON_DELIVERY: 'pay_on_delivery',   // Será cobrado na hora da entrega
  REJECTED: 'rejected'                  // Recusado
};

export class Order {
  constructor({
    id,
    orderNo,
    customer,
    delivery,
    items = [],
    payment,
    coupon = null,
    subtotal = 0,
    discount = 0,
    freight = 0,
    total = 0,
    costTotal = 0,
    status = OrderStatus.RECEIVED,
    printedStations = [],
    preparedAt = null,
    deliveredAt = null,
    preparationTimeMinutes = null,
    deliveryTimeMinutes = null,
    cancellationReason = null,
    cancelledAt = null,
    returnReason = null,
    returnedAt = null,
    notifiedStatuses = [],
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString()
  }) {
    this.id = id || `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.orderNo = orderNo || String(Math.floor(100000 + Math.random() * 900000));
    this.customer = customer; // { name, phone }
    this.delivery = delivery; // { type: 'delivery'|'pickup', street, number, bairro, city, state, cep, reference, km, freight }
    this.items = items;       // [ { name, size, accompaniments, extras, fruits, quantity, unitPrice, costPrice, subtotal, note } ]
    this.payment = payment;   // { method, timing: 'online'|'delivery', changeFor, trocoValue, status, qrCode, qrCodeBase64, transactionId }
    this.coupon = coupon;     // { code, discountValue }
    this.subtotal = Number(subtotal);
    this.discount = Number(discount);
    this.freight = Number(freight);
    this.total = Number(total);
    this.costTotal = Number(costTotal || 0); // Custo dos insumos para relatório financeiro
    this.status = status;
    this.printedStations = printedStations; // ['kitchen', 'counter']
    this.notifiedStatuses = Array.isArray(notifiedStatuses) ? notifiedStatuses : [];
    this.preparedAt = preparedAt;
    this.deliveredAt = deliveredAt;
    this.preparationTimeMinutes = preparationTimeMinutes;
    this.deliveryTimeMinutes = deliveryTimeMinutes;
    this.cancellationReason = cancellationReason;
    this.cancelledAt = cancelledAt;
    this.returnReason = returnReason;
    this.returnedAt = returnedAt;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  isDelivery() {
    return this.delivery && this.delivery.type === 'delivery';
  }

  /**
   * Calcula o valor exato do troco em dinheiro
   */
  calculateChange() {
    if (this.payment.method !== PaymentMethod.MONEY) return 0;
    const changeFor = parseFloat(String(this.payment.changeFor || '').replace(',', '.').replace(/[^\d.]/g, ''));
    if (!changeFor || changeFor <= this.total) return 0;
    return Number((changeFor - this.total).toFixed(2));
  }

  /**
   * REGRA DE NEGÓCIO DE IMPRESSÃO TÉRMICA:
   * 1. Se for Dinheiro: pode imprimir de imediato (paga na entrega)
   * 2. Se for Cartão na Entrega (Maquininha com motoboy): pode imprimir de imediato
   * 3. Se for Pagamento Online (Pix ou Cartão online): SÓ IMPRIME após confirmação do banco!
   */
  canPrint() {
    if (this.payment.method === PaymentMethod.MONEY) {
      return { allowed: true };
    }
    if (this.payment.timing === 'delivery') {
      return { allowed: true };
    }
    if (this.payment.status === PaymentStatus.APPROVED) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Aguardando confirmação do pagamento online via ${this.payment.method} pelo banco para liberar a impressão.`
    };
  }
}
