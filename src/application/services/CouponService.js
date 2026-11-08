import { db } from '../../infrastructure/database/JsonDatabase.js';
import { Coupon } from '../../domain/entities/Coupon.js';

export class CouponService {
  constructor() {
    this.db = db;
  }

  getCoupons() {
    return this.db.get().coupons || [];
  }

  getCouponByCode(code) {
    if (!code) return null;
    const cleanCode = code.toUpperCase().trim();
    const raw = this.getCoupons().find(c => c.code === cleanCode);
    return raw ? new Coupon(raw) : null;
  }

  validateCoupon(code, subtotal) {
    const coupon = this.getCouponByCode(code);
    if (!coupon) {
      return { valid: false, error: 'Cupom não encontrado.' };
    }

    const check = coupon.isValid(subtotal);
    if (!check.valid) {
      return { valid: false, error: check.reason };
    }

    const discount = coupon.calculateDiscount(subtotal);
    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        discount
      }
    };
  }

  createCoupon(data) {
    const dbData = this.db.get();
    const code = (data.code || '').toUpperCase().trim();

    if (!code) throw new Error('Código do cupom é obrigatório.');
    if (dbData.coupons.some(c => c.code === code)) {
      throw new Error('Já existe um cupom com este código.');
    }

    const newCoupon = {
      id: `cp_${Date.now()}`,
      code,
      type: data.type || 'percent',
      value: Number(data.value || 0),
      minOrder: Number(data.minOrder || 0),
      maxDiscount: data.maxDiscount ? Number(data.maxDiscount) : null,
      active: data.active !== undefined ? !!data.active : true,
      uses: 0,
      maxUses: data.maxUses ? Number(data.maxUses) : null,
      expiresAt: data.expiresAt || null
    };

    dbData.coupons.push(newCoupon);
    this.db.save();
    return newCoupon;
  }

  updateCoupon(id, updates) {
    const dbData = this.db.get();
    const idx = dbData.coupons.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Cupom não encontrado.');

    if (updates.code) updates.code = updates.code.toUpperCase().trim();

    dbData.coupons[idx] = { ...dbData.coupons[idx], ...updates, id };
    this.db.save();
    return dbData.coupons[idx];
  }

  deleteCoupon(id) {
    const dbData = this.db.get();
    const idx = dbData.coupons.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Cupom não encontrado.');

    const removed = dbData.coupons.splice(idx, 1);
    this.db.save();
    return removed[0];
  }

  incrementUsage(code) {
    const dbData = this.db.get();
    const cleanCode = (code || '').toUpperCase().trim();
    const coupon = dbData.coupons.find(c => c.code === cleanCode);
    if (coupon) {
      coupon.uses = (coupon.uses || 0) + 1;
      this.db.save();
    }
  }
}

export const couponService = new CouponService();
