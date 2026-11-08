import { couponService } from '../../application/services/CouponService.js';

export class CouponController {
  async validate(req, res) {
    try {
      const { code, subtotal } = req.body;
      const result = couponService.validateCoupon(code, Number(subtotal || 0));
      return res.json({ ok: result.valid, ...result });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async getAll(req, res) {
    try {
      const coupons = couponService.getCoupons();
      return res.json({ ok: true, coupons });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async create(req, res) {
    try {
      const coupon = couponService.createCoupon(req.body);
      return res.status(201).json({ ok: true, coupon });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async update(req, res) {
    try {
      const coupon = couponService.updateCoupon(req.params.id, req.body);
      return res.json({ ok: true, coupon });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async delete(req, res) {
    try {
      const removed = couponService.deleteCoupon(req.params.id);
      return res.json({ ok: true, removed });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
}

export const couponController = new CouponController();
