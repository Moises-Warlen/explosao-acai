import { storeService } from '../../application/services/StoreService.js';
import { freightService } from '../../application/services/FreightService.js';
import { verifyAndMigratePassword, hashPassword, createAdminToken } from '../middlewares/authMiddleware.js';
import { db } from '../../infrastructure/database/JsonDatabase.js';

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
      const { currentPassword, newPassword } = req.body || {};
      if (!newPassword || newPassword.trim().length < 4) {
        return res.status(400).json({ ok: false, error: 'A nova senha deve ter no mínimo 4 caracteres.' });
      }

      const stored = db.get()?.settings?.adminPassword;
      if (!verifyAndMigratePassword(currentPassword, stored)) {
        return res.status(400).json({ ok: false, error: 'A senha atual informada está incorreta.' });
      }

      if (currentPassword === newPassword.trim()) {
        return res.status(400).json({ ok: false, error: 'A nova senha não pode ser igual à senha atual.' });
      }

      const newHashed = hashPassword(newPassword.trim());
      storeService.updateSettings({ adminPassword: newHashed });
      const newToken = createAdminToken();
      return res.json({ ok: true, message: 'Senha administrativa atualizada com sucesso!', newToken });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async getMotoboys(req, res) {
    try {
      const motoboys = storeService.getMotoboys();
      return res.json({ ok: true, motoboys });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async addMotoboy(req, res) {
    try {
      const { name } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ ok: false, error: 'Nome do motoboy é obrigatório.' });
      }
      const motoboys = storeService.addMotoboy(name.trim());
      return res.json({ ok: true, motoboys });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async removeMotoboy(req, res) {
    try {
      const name = decodeURIComponent(req.params.name || '');
      if (!name) return res.status(400).json({ ok: false, error: 'Nome é obrigatório.' });
      const motoboys = storeService.removeMotoboy(name);
      return res.json({ ok: true, motoboys });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const storeController = new StoreController();
