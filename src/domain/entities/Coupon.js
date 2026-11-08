export class Coupon {
  constructor({
    id,
    code,
    type = 'percent', // 'percent' | 'fixed'
    value = 0,
    minOrder = 0,
    maxDiscount = null,
    active = true,
    uses = 0,
    maxUses = 100,
    expiresAt = null
  }) {
    this.id = id || `cp_${Date.now()}`;
    this.code = (code || '').toUpperCase().trim();
    this.type = type;
    this.value = Number(value);
    this.minOrder = Number(minOrder || 0);
    this.maxDiscount = maxDiscount ? Number(maxDiscount) : null;
    this.active = !!active;
    this.uses = Number(uses || 0);
    this.maxUses = maxUses ? Number(maxUses) : null;
    this.expiresAt = expiresAt;
  }

  isValid(orderSubtotal) {
    if (!this.active) return { valid: false, reason: "Cupom inativo." };
    if (this.maxUses && this.uses >= this.maxUses) return { valid: false, reason: "Cupom esgotado." };
    if (this.expiresAt && new Date(this.expiresAt) < new Date()) return { valid: false, reason: "Cupom expirado." };
    if (orderSubtotal < this.minOrder) {
      return {
        valid: false,
        reason: `Pedido mínimo para este cupom é de R$ ${this.minOrder.toFixed(2).replace('.', ',')}.`
      };
    }
    return { valid: true };
  }

  calculateDiscount(orderSubtotal) {
    const check = this.isValid(orderSubtotal);
    if (!check.valid) return 0;

    let discount = 0;
    if (this.type === 'percent') {
      discount = (orderSubtotal * this.value) / 100;
    } else {
      discount = this.value;
    }

    if (this.maxDiscount && discount > this.maxDiscount) {
      discount = this.maxDiscount;
    }

    return Math.min(discount, orderSubtotal);
  }
}
