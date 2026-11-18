/* =========================================================================
   ROTAS DA API RESTful — EXPLOSÃO AÇAÍ
   Todas as rotas mapeadas e protegidas para o painel administrativo
   ========================================================================= */

import { Router } from 'express';
import { orderController } from '../controllers/OrderController.js';
import { catalogController } from '../controllers/CatalogController.js';
import { couponController } from '../controllers/CouponController.js';
import { storeController } from '../controllers/StoreController.js';
import { printerController } from '../controllers/PrinterController.js';
import { chatController } from '../controllers/ChatController.js';
import { webhookController } from '../controllers/WebhookController.js';
import { reportController } from '../controllers/ReportController.js';
import { botController } from '../controllers/BotController.js';
import {
  adminAuthMiddleware,
  motoboyOrAdminAuthMiddleware,
  verifyAndMigratePassword,
  createAdminToken
} from '../middlewares/authMiddleware.js';
import { upload } from '../../infrastructure/storage/UploadService.js';
import { db } from '../../infrastructure/database/JsonDatabase.js';

const router = Router();

// ================= PEDIDOS =================
router.post('/orders', (req, res) => orderController.create(req, res));
router.get('/orders', (req, res) => orderController.getAll(req, res));
router.get('/orders/:id', (req, res) => orderController.getById(req, res));
router.patch('/orders/:id/status', adminAuthMiddleware, (req, res) => orderController.updateStatus(req, res));
router.post('/orders/:id/assign-motoboy', adminAuthMiddleware, (req, res) => orderController.assignMotoboy(req, res));
router.post('/orders/:id/confirm-delivery', motoboyOrAdminAuthMiddleware, (req, res) => orderController.confirmDelivery(req, res));
router.post('/orders/:id/return', motoboyOrAdminAuthMiddleware, (req, res) => orderController.returnOrder(req, res));
router.post('/orders/:id/print', adminAuthMiddleware, (req, res) => orderController.printTicket(req, res));
router.post('/orders/archive-daily-completed', adminAuthMiddleware, (req, res) => orderController.archiveDaily(req, res));
router.post('/admin/customers/anonymize', adminAuthMiddleware, (req, res) => orderController.anonymizeCustomer(req, res));

// ================= CARDÁPIO & PRODUTOS =================
router.all('/catalog/sync-flyer', (req, res) => catalogController.syncFlyer(req, res));
router.get('/catalog', (req, res) => catalogController.getCatalog(req, res));
router.get('/catalog/best-sellers', (req, res) => catalogController.getBestSellers(req, res));
router.put('/catalog/best-sellers', adminAuthMiddleware, (req, res) => catalogController.updateBestSellers(req, res));
router.post('/catalog/products', adminAuthMiddleware, (req, res) => catalogController.createProduct(req, res));
router.put('/catalog/products/:id', adminAuthMiddleware, (req, res) => catalogController.updateProduct(req, res));
router.patch('/catalog/products/:id/toggle', adminAuthMiddleware, (req, res) => catalogController.toggleActive(req, res));
router.delete('/catalog/products/:id', adminAuthMiddleware, (req, res) => catalogController.deleteProduct(req, res));

// ================= CATEGORIAS =================
router.get('/catalog/categories', (req, res) => catalogController.getCategories(req, res));
router.post('/catalog/categories', adminAuthMiddleware, (req, res) => catalogController.createCategory(req, res));
router.put('/catalog/categories/:id', adminAuthMiddleware, (req, res) => catalogController.updateCategory(req, res));
router.delete('/catalog/categories/:id', adminAuthMiddleware, (req, res) => catalogController.deleteCategory(req, res));

// ================= ACOMPANHAMENTOS / COMPLEMENTOS =================
router.get('/catalog/accompaniments', (req, res) => catalogController.getAccompaniments(req, res));
router.post('/catalog/accompaniments', adminAuthMiddleware, (req, res) => catalogController.createAccompaniment(req, res));
router.put('/catalog/accompaniments/:id', adminAuthMiddleware, (req, res) => catalogController.updateAccompaniment(req, res));
router.delete('/catalog/accompaniments/:id', adminAuthMiddleware, (req, res) => catalogController.deleteAccompaniment(req, res));

// ================= ADICIONAIS / EXTRAS =================
router.post('/catalog/extras', adminAuthMiddleware, (req, res) => catalogController.createExtra(req, res));
router.put('/catalog/extras/:id', adminAuthMiddleware, (req, res) => catalogController.updateExtra(req, res));
router.delete('/catalog/extras/:id', adminAuthMiddleware, (req, res) => catalogController.deleteExtra(req, res));

// ================= FRUTAS ADICIONAIS =================
router.get('/catalog/fruits', (req, res) => catalogController.getFruits(req, res));
router.post('/catalog/fruits', adminAuthMiddleware, (req, res) => catalogController.createFruit(req, res));
router.put('/catalog/fruits/:id', adminAuthMiddleware, (req, res) => catalogController.updateFruit(req, res));
router.delete('/catalog/fruits/:id', adminAuthMiddleware, (req, res) => catalogController.deleteFruit(req, res));

// ================= UPLOAD DE FOTOS DO COMPUTADOR =================
router.post('/upload', adminAuthMiddleware, upload.single('image'), (req, res) => catalogController.uploadPhoto(req, res));

// ================= RELATÓRIOS GERENCIAIS =================
router.get('/reports/sales', adminAuthMiddleware, (req, res) => reportController.getSalesReport(req, res));
router.get('/reports/deliveries', adminAuthMiddleware, (req, res) => reportController.getDeliveryReport(req, res));

// ================= CUPONS DE DESCONTO =================
router.post('/coupons/validate', (req, res) => couponController.validate(req, res));
router.get('/coupons', adminAuthMiddleware, (req, res) => couponController.getAll(req, res));
router.post('/coupons', adminAuthMiddleware, (req, res) => couponController.create(req, res));
router.put('/coupons/:id', adminAuthMiddleware, (req, res) => couponController.update(req, res));
router.delete('/coupons/:id', adminAuthMiddleware, (req, res) => couponController.delete(req, res));

// ================= STATUS & HORÁRIO DA LOJA =================
router.get('/store/status', (req, res) => storeController.getStatus(req, res));
router.get('/store/settings', (req, res) => storeController.getSettings(req, res));
router.put('/store/settings', adminAuthMiddleware, (req, res) => storeController.updateSettings(req, res));
router.post('/store/toggle-status', adminAuthMiddleware, (req, res) => storeController.toggleStatus(req, res));
router.post('/store/calculate-freight', (req, res) => storeController.calculateFreight(req, res));

// ================= IMPRESSORAS DE COMANDA =================
router.get('/printers', adminAuthMiddleware, (req, res) => printerController.getAll(req, res));
router.put('/printers', adminAuthMiddleware, (req, res) => printerController.saveAll(req, res));

// ================= CHAT EM TEMPO REAL =================
router.get('/chat', (req, res) => chatController.getMessages(req, res));
router.get('/chat/conversations', adminAuthMiddleware, (req, res) => chatController.getConversations(req, res));
router.post('/chat', (req, res) => chatController.sendMessage(req, res));
router.post('/chat/close', adminAuthMiddleware, (req, res) => chatController.closeConversation(req, res));
router.put('/chat/customer-name', adminAuthMiddleware, (req, res) => chatController.updateCustomerName(req, res));

// ================= GATEWAY & WEBHOOKS =================
router.post('/webhooks/mercadopago', (req, res) => webhookController.handleMercadoPago(req, res));
router.get('/webhooks/mercadopago', (req, res) => webhookController.handleMercadoPago(req, res));
router.post('/test/simulate-payment/:orderId', adminAuthMiddleware, (req, res) => webhookController.simulatePaymentApproval(req, res));

// ================= BOT WHATSAPP & IA =================
router.get('/bot/status', adminAuthMiddleware, (req, res) => botController.getStatus(req, res));
router.post('/bot/connect', adminAuthMiddleware, (req, res) => botController.connect(req, res));
router.post('/bot/disconnect', adminAuthMiddleware, (req, res) => botController.disconnect(req, res));
router.post('/bot/toggle-ai', adminAuthMiddleware, (req, res) => botController.toggleAI(req, res));
router.post('/bot/set-gemini-key', adminAuthMiddleware, (req, res) => botController.setGeminiKey(req, res));
router.post('/bot/release-human/:phone', adminAuthMiddleware, (req, res) => botController.releaseHuman(req, res));
router.post('/bot/test-message', adminAuthMiddleware, (req, res) => botController.sendTestMessage(req, res));
router.get('/bot/campaign/info', adminAuthMiddleware, (req, res) => botController.getCampaignInfo(req, res));
router.post('/bot/campaign/preview', adminAuthMiddleware, (req, res) => botController.previewCampaign(req, res));
router.post('/bot/campaign/send', adminAuthMiddleware, (req, res) => botController.sendCampaign(req, res));
router.put('/bot/campaign/settings', adminAuthMiddleware, (req, res) => botController.saveCampaignSettings(req, res));
router.get('/bot/feedbacks', adminAuthMiddleware, (req, res) => botController.getFeedbacks(req, res));
router.put('/bot/feedbacks/:id/resolve', adminAuthMiddleware, (req, res) => botController.resolveFeedback(req, res));
router.get('/bot/knowledge', adminAuthMiddleware, (req, res) => botController.getKnowledge(req, res));
router.post('/bot/knowledge', adminAuthMiddleware, (req, res) => botController.addKnowledge(req, res));
router.delete('/bot/knowledge/:id', adminAuthMiddleware, (req, res) => botController.deleteKnowledge(req, res));

// ================= AUTENTICAÇÃO DO ADMIN =================
router.post('/admin/auth', (req, res) => {
  const { password } = req.body || {};
  const raw = typeof password === 'string' ? password.trim() : '';
  const stored = db.get()?.settings?.adminPassword || process.env.ADMIN_PASSWORD;

  if (verifyAndMigratePassword(raw, stored)) {
    const token = createAdminToken();
    return res.json({ ok: true, token });
  }
  return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
});

router.post('/admin/change-password', adminAuthMiddleware, (req, res) => storeController.changePassword(req, res));

export default router;
