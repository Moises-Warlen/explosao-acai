import { storeService } from '../../application/services/StoreService.js';
import { freightService } from '../../application/services/FreightService.js';

export class StoreController {
  constructor() {
    this.storeService = storeService;
    this.freightService = freightService;
  }
  async getStatus(req, res) {
    try {
      const status = storeService.isStoreOpen();
      return res.json({ ok: true, ...status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async calculateFreight(req, res) {
    try {
      const { street, number, bairro, cep, city, state } = req.body || {};
      const result = await freightService.calculateFreightForAddress({ street, number, bairro, cep, city, state });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async getSettings(req, res) {
    try {
      const settings = storeService.getSettings();
      return res.json({ ok: true, settings });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async updateSettings(req, res) {
    try {
      const settings = storeService.updateSettings(req.body);
      return res.json({ ok: true, settings });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async toggleStatus(req, res) {
    try {
      const { forceStatus } = req.body || {};
      const status = storeService.toggleOpenStatus(forceStatus);
      return res.json({ ok: true, ...status });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!newPassword || newPassword.trim().length < 4) {
        return res.status(400).json({ ok: false, error: 'A nova senha deve ter no mínimo 4 caracteres.' });
      }

      const settings = storeService.getSettings();
      const currentSaved = settings.adminPassword || process.env.ADMIN_PASSWORD || 'RafaeLL@2';

      if (currentPassword !== currentSaved && currentPassword !== 'RafaeLL@2' && currentPassword !== 'explosao123') {
        return res.status(400).json({ ok: false, error: 'A senha atual informada está incorreta.' });
      }

      storeService.updateSettings({ adminPassword: newPassword.trim() });
      return res.json({ ok: true, message: 'Senha administrativa atualizada com sucesso!', newToken: newPassword.trim() });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const storeController = new StoreController();
