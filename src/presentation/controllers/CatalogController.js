/* =========================================================================
   CONTROLLER DE CATÁLOGO, PRODUTOS, CATEGORIAS & UPLOAD — EXPLOSÃO AÇAÍ
   ========================================================================= */

import { catalogService } from '../../application/services/CatalogService.js';
import { imageStore, processImage } from '../../infrastructure/storage/ImageStore.js';
import { buildUploadName, writeUploadToDisk } from '../../infrastructure/storage/UploadService.js';

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

  async syncFlyer(req, res) {
    try {
      const result = await catalogService.syncOfficialCatalog();
      return res.json({ ok: true, ...result });
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

  // ================= FRUTAS ADICIONAIS =================
  async getFruits(req, res) {
    try {
      const fruits = catalogService.getFruits();
      return res.json({ ok: true, fruits });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async createFruit(req, res) {
    try {
      const fruit = catalogService.createFruit(req.body);
      return res.status(201).json({ ok: true, fruit });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async updateFruit(req, res) {
    try {
      const fruit = catalogService.updateFruit(req.params.id, req.body);
      return res.json({ ok: true, fruit });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  async deleteFruit(req, res) {
    try {
      const removed = catalogService.deleteFruit(req.params.id);
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
      // Otimiza a foto (WebP, máx. 1200px) e grava no banco (persistente) + disco (cache)
      let processed;
      try {
        processed = await processImage(req.file.buffer);
      } catch (e) {
        return res.status(400).json({ ok: false, error: 'Arquivo de imagem inválido ou corrompido.' });
      }
      const fileName = buildUploadName(req.file.originalname, processed.ext);

      let persistent = false;
      try {
        persistent = await imageStore.save(fileName, processed.mime, processed.buffer);
      } catch (e) {
        console.error('Erro ao salvar foto no PostgreSQL:', e.message);
        return res.status(500).json({ ok: false, error: 'Não foi possível salvar a foto no banco de dados. Tente novamente.' });
      }
      const onDisk = writeUploadToDisk(fileName, processed.buffer);
      if (!persistent && !onDisk) {
        return res.status(500).json({ ok: false, error: 'Não foi possível armazenar a foto.' });
      }
      if (!persistent) {
        console.warn('⚠️ Foto salva apenas em disco (PostgreSQL indisponível): ela pode sumir após um novo deploy.');
      }

      // Caminho relativo para exibição direta no front
      const filePath = `imagens/uploads/${fileName}`;
      return res.json({
        ok: true,
        filePath,
        fileName,
        originalName: req.file.originalname,
        persistent
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const catalogController = new CatalogController();
