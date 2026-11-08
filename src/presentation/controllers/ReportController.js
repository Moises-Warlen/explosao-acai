/* =========================================================================
   CONTROLLER DE RELATÓRIOS GERENCIAIS — EXPLOSÃO AÇAÍ
   Suporta filtros por período ('today', 'month', 'year', 'all') e intervalo (startDate, endDate)
   ========================================================================= */

import { reportService } from '../../application/services/ReportService.js';

export class ReportController {
  async getSalesReport(req, res) {
    try {
      const { period, startDate, endDate } = req.query;
      const report = reportService.getSalesReport({
        period: period || 'all',
        startDate: startDate || null,
        endDate: endDate || null
      });
      return res.json({ ok: true, report });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const reportController = new ReportController();
