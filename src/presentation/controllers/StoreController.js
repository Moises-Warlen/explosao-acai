import { storeService } from '../../application/services/StoreService.js';
import { freightService } from '../../application/services/FreightService.js';
import { isValidAdminToken } from '../middlewares/authMiddleware.js';

// Nunca devolve a senha do painel (nem outros segredos) em respostas de configurações
function publicSettings(settings) {
  const { adminPassword, ...safe } = settings || {};
  return safe;
}

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
      return res.json({ ok: true, settings: publicSettings(settings) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async updateSettings(req, res) {
    try {
      const settings = storeService.updateSettings(req.body);
      return res.json({ ok: true, settings: publicSettings(settings) });
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

      if (!isValidAdminToken(currentPassword)) {
        return res.status(400).json({ ok: false, error: 'A senha atual informada está incorreta.' });
      }

      if (currentPassword === newPassword.trim()) {
        return res.status(400).json({ ok: false, error: 'A nova senha não pode ser igual à senha atual.' });
      }

      storeService.updateSettings({ adminPassword: newPassword.trim() });
      return res.json({ ok: true, message: 'Senha administrativa atualizada com sucesso!', newToken: newPassword.trim() });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const storeController = new StoreController();
