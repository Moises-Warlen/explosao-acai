import { thermalPrinterService } from '../../infrastructure/printing/ThermalPrinterService.js';

export class PrinterController {
  async getAll(req, res) {
    try {
      const printers = thermalPrinterService.getPrinters();
      return res.json({ ok: true, printers });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async saveAll(req, res) {
    try {
      const { printers } = req.body;
      if (!Array.isArray(printers)) {
        return res.status(400).json({ ok: false, error: 'Lista de impressoras inválida.' });
      }
      const saved = thermalPrinterService.savePrinters(printers);
      return res.json({ ok: true, printers: saved });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
}

export const printerController = new PrinterController();
