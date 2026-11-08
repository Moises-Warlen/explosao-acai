/* =========================================================================
   CONTROLLER DE CATÁLOGO, PRODUTOS, CATEGORIAS & UPLOAD — EXPLOSÃO AÇAÍ
   ========================================================================= */

import { catalogService } from '../../application/services/CatalogService.js';

export class CatalogController {
  // ================= CATÁLOGO GERAL =================
  async getCatalog(req, res) {
    try {
      const data = catalogService.getCatalog();
      return res.json({ ok: true, ...data });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ================= CATEGORIAS =================
  async getCategories(req, res) {
    try {
      const categories = catalogService.getCategories();
      return res.json({ ok: true, categories });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async createCategory(req, res) {
    try {
      const category = catalogService.createCategory(req.body);
      return res.status(201).json({ ok: true, category });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async updateCategory(req, res) {
    try {
      const category = catalogService.updateCategory(req.params.id, req.body);
      return res.json({ ok: true, category });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async deleteCategory(req, res) {
    try {
      const removed = catalogService.deleteCategory(req.params.id);
      return res.json({ ok: true, removed });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  // ================= PRODUTOS =================
  async createProduct(req, res) {
    try {
      const product = catalogService.createProduct(req.body);
      return res.status(201).json({ ok: true, product });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async updateProduct(req, res) {
    try {
      const product = catalogService.updateProduct(req.params.id, req.body);
      return res.json({ ok: true, product });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async toggleActive(req, res) {
    try {
      const product = catalogService.toggleProductActive(req.params.id);
      return res.json({ ok: true, product });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async deleteProduct(req, res) {
    try {
      const removed = catalogService.deleteProduct(req.params.id);
      return res.json({ ok: true, removed });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  // ================= ADICIONAIS / EXTRAS =================
  async createExtra(req, res) {
    try {
      const extra = catalogService.createExtra(req.body);
      return res.status(201).json({ ok: true, extra });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async updateExtra(req, res) {
    try {
      const extra = catalogService.updateExtra(req.params.id, req.body);
      return res.json({ ok: true, extra });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async deleteExtra(req, res) {
    try {
      const removed = catalogService.deleteExtra(req.params.id);
      return res.json({ ok: true, removed });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  // ================= ACOMPANHAMENTOS / COMPLEMENTOS =================
  async getAccompaniments(req, res) {
    try {
      const { productId } = req.query;
      const accompaniments = catalogService.getAccompaniments(productId);
      return res.json({ ok: true, accompaniments });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async createAccompaniment(req, res) {
    try {
      const accompaniment = catalogService.createAccompaniment(req.body);
      return res.status(201).json({ ok: true, accompaniment });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async updateAccompaniment(req, res) {
    try {
      const accompaniment = catalogService.updateAccompaniment(req.params.id, req.body);
      return res.json({ ok: true, accompaniment });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async deleteAccompaniment(req, res) {
    try {
      const removed = catalogService.deleteAccompaniment(req.params.id);
      return res.json({ ok: true, removed });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  // ================= MAIS VENDIDOS =================
  async getBestSellers(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 6;
      const products = catalogService.getBestSellers(limit);
      return res.json({ ok: true, products });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async updateBestSellers(req, res) {
    try {
      const { productIds } = req.body || {};
      const products = catalogService.updateBestSellers(productIds);
      return res.json({ ok: true, products });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ================= UPLOAD DE FOTOS DO COMPUTADOR =================
  async uploadPhoto(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado.' });
      }
      // Caminho relativo para exibição direta no front
      const filePath = `imagens/uploads/${req.file.filename}`;
      return res.json({
        ok: true,
        filePath,
        fileName: req.file.filename,
        originalName: req.file.originalname
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const catalogController = new CatalogController();
