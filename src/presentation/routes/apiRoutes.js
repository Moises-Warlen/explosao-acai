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
import { userController } from '../controllers/UserController.js';
import { userService } from '../../application/services/UserService.js';
import {
  adminAuthMiddleware,
  requireAdminOnlyMiddleware,
  requirePermission,
  motoboyOrAdminAuthMiddleware,
  verifyAndMigratePassword,
  createAdminToken
} from '../middlewares/authMiddleware.js';
import { upload } from '../../infrastructure/storage/UploadService.js';
import { db } from '../../infrastructure/database/JsonDatabase.js';
import { securityAuditService, SecurityEventType, SecuritySeverity } from '../../infrastructure/security/SecurityAuditService.js';

const router = Router();

// ================= PEDIDOS =================
router.post('/orders', (req, res) => orderController.create(req, res));
router.get('/orders', (req, res) => orderController.getAll(req, res));
router.get('/orders/:id', (req, res) => orderController.getById(req, res));
router.patch('/orders/:id/status', requirePermission(['orders.accept', 'orders.dispatch', 'orders.complete', 'orders.cancel', 'orders']), (req, res) => orderController.updateStatus(req, res));
router.post('/orders/:id/assign-motoboy', requirePermission(['motoboys.dispatch', 'orders.dispatch', 'orders', 'motoboys']), (req, res) => orderController.assignMotoboy(req, res));
router.post('/orders/:id/confirm-delivery', motoboyOrAdminAuthMiddleware, (req, res) => orderController.confirmDelivery(req, res));
router.post('/orders/:id/return', motoboyOrAdminAuthMiddleware, (req, res) => orderController.returnOrder(req, res));
router.post('/orders/:id/print', requirePermission(['orders.print', 'orders']), (req, res) => orderController.printTicket(req, res));
router.post('/orders/archive-daily-completed', requirePermission(['orders.complete', 'orders']), (req, res) => orderController.archiveDaily(req, res));
router.post('/admin/customers/anonymize', requirePermission(['security.anonymize', 'orders']), (req, res) => orderController.anonymizeCustomer(req, res));

// ================= CARDÁPIO & PRODUTOS =================
router.all('/catalog/sync-flyer', (req, res) => catalogController.syncFlyer(req, res));
router.get('/catalog', (req, res) => catalogController.getCatalog(req, res));
router.get('/catalog/best-sellers', (req, res) => catalogController.getBestSellers(req, res));
router.put('/catalog/best-sellers', requirePermission(['catalog.products.manage', 'catalog']), (req, res) => catalogController.updateBestSellers(req, res));
router.post('/catalog/products', requirePermission(['catalog.products.manage', 'catalog']), (req, res) => catalogController.createProduct(req, res));
router.put('/catalog/products/:id', requirePermission(['catalog.products.manage', 'catalog']), (req, res) => catalogController.updateProduct(req, res));
router.patch('/catalog/products/:id/toggle', requirePermission(['catalog.products.manage', 'catalog']), (req, res) => catalogController.toggleActive(req, res));
router.delete('/catalog/products/:id', requirePermission(['catalog.products.manage', 'catalog']), (req, res) => catalogController.deleteProduct(req, res));

// ================= CATEGORIAS =================
router.get('/catalog/categories', (req, res) => catalogController.getCategories(req, res));
router.post('/catalog/categories', requirePermission(['catalog.categories.manage', 'catalog']), (req, res) => catalogController.createCategory(req, res));
router.put('/catalog/categories/:id', requirePermission(['catalog.categories.manage', 'catalog']), (req, res) => catalogController.updateCategory(req, res));
router.delete('/catalog/categories/:id', requirePermission(['catalog.categories.manage', 'catalog']), (req, res) => catalogController.deleteCategory(req, res));

// ================= ACOMPANHAMENTOS / COMPLEMENTOS =================
router.get('/catalog/accompaniments', (req, res) => catalogController.getAccompaniments(req, res));
router.post('/catalog/accompaniments', requirePermission(['catalog.accompaniments.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.createAccompaniment(req, res));
router.put('/catalog/accompaniments/:id', requirePermission(['catalog.accompaniments.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.updateAccompaniment(req, res));
router.delete('/catalog/accompaniments/:id', requirePermission(['catalog.accompaniments.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.deleteAccompaniment(req, res));

// ================= ADICIONAIS / EXTRAS =================
router.post('/catalog/extras', requirePermission(['catalog.extras.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.createExtra(req, res));
router.put('/catalog/extras/:id', requirePermission(['catalog.extras.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.updateExtra(req, res));
router.delete('/catalog/extras/:id', requirePermission(['catalog.extras.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.deleteExtra(req, res));

// ================= FRUTAS ADICIONAIS =================
router.get('/catalog/fruits', (req, res) => catalogController.getFruits(req, res));
router.post('/catalog/fruits', requirePermission(['catalog.fruits.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.createFruit(req, res));
router.put('/catalog/fruits/:id', requirePermission(['catalog.fruits.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.updateFruit(req, res));
router.delete('/catalog/fruits/:id', requirePermission(['catalog.fruits.manage', 'accompaniments', 'catalog']), (req, res) => catalogController.deleteFruit(req, res));

// ================= UPLOAD DE FOTOS DO COMPUTADOR =================
router.post('/upload', requirePermission(['catalog.products.manage', 'catalog']), upload.single('image'), (req, res) => catalogController.uploadPhoto(req, res));

// ================= RELATÓRIOS GERENCIAIS =================
router.get('/reports/sales', requirePermission(['reports.view', 'reports']), (req, res) => reportController.getSalesReport(req, res));
router.get('/reports/deliveries', requirePermission(['motoboys.reports', 'reports.view', 'reports']), (req, res) => reportController.getDeliveryReport(req, res));

// ================= CUPONS DE DESCONTO =================
router.post('/coupons/validate', (req, res) => couponController.validate(req, res));
router.get('/coupons', requirePermission(['coupons.view', 'coupons']), (req, res) => couponController.getAll(req, res));
router.post('/coupons', requirePermission(['coupons.manage', 'coupons']), (req, res) => couponController.create(req, res));
router.put('/coupons/:id', requirePermission(['coupons.manage', 'coupons']), (req, res) => couponController.update(req, res));
router.delete('/coupons/:id', requirePermission(['coupons.manage', 'coupons']), (req, res) => couponController.delete(req, res));

// ================= STATUS & HORÁRIO DA LOJA =================
router.get('/store/status', (req, res) => storeController.getStatus(req, res));
router.get('/store/settings', (req, res) => storeController.getSettings(req, res));
router.put('/store/settings', requirePermission(['store.manage', 'store']), (req, res) => storeController.updateSettings(req, res));
router.post('/store/toggle-status', requirePermission(['orders.store_toggle', 'store.manage', 'orders', 'store']), (req, res) => storeController.toggleStatus(req, res));
router.post('/store/calculate-freight', (req, res) => storeController.calculateFreight(req, res));

// ================= IMPRESSORAS DE COMANDA =================
router.get('/printers', requirePermission(['printers.view', 'printers']), (req, res) => printerController.getAll(req, res));
router.put('/printers', requirePermission(['printers.manage', 'printers']), (req, res) => printerController.saveAll(req, res));

// ================= CHAT EM TEMPO REAL =================
router.get('/chat', (req, res) => chatController.getMessages(req, res));
router.get('/chat/conversations', requirePermission(['chat.view', 'chat']), (req, res) => chatController.getConversations(req, res));
router.post('/chat', (req, res) => chatController.sendMessage(req, res));
router.post('/chat/close', requirePermission(['chat.reply', 'chat']), (req, res) => chatController.closeConversation(req, res));
router.put('/chat/customer-name', requirePermission(['chat.edit_customer', 'chat']), (req, res) => chatController.updateCustomerName(req, res));

// ================= GATEWAY & WEBHOOKS =================
router.post('/webhooks/mercadopago', (req, res) => webhookController.handleMercadoPago(req, res));
router.get('/webhooks/mercadopago', (req, res) => webhookController.handleMercadoPago(req, res));
router.post('/test/simulate-payment/:orderId', adminAuthMiddleware, (req, res) => webhookController.simulatePaymentApproval(req, res));

// ================= BOT WHATSAPP & IA =================
router.get('/bot/status', requirePermission(['bot.view', 'bot']), (req, res) => botController.getStatus(req, res));
router.post('/bot/connect', requirePermission(['bot.connect', 'bot']), (req, res) => botController.connect(req, res));
router.post('/bot/disconnect', requirePermission(['bot.connect', 'bot']), (req, res) => botController.disconnect(req, res));
router.post('/bot/toggle-ai', requirePermission(['bot.toggle_ai', 'bot']), (req, res) => botController.toggleAI(req, res));
router.post('/bot/set-gemini-key', requirePermission(['bot.set_key', 'bot']), (req, res) => botController.setGeminiKey(req, res));
router.post('/bot/release-human/:phone', requirePermission(['bot.view', 'bot']), (req, res) => botController.releaseHuman(req, res));
router.post('/bot/test-message', requirePermission(['bot.test_message', 'bot']), (req, res) => botController.sendTestMessage(req, res));
router.get('/bot/campaign/info', requirePermission(['bot.campaigns', 'bot']), (req, res) => botController.getCampaignInfo(req, res));
router.post('/bot/campaign/preview', requirePermission(['bot.campaigns', 'bot']), (req, res) => botController.previewCampaign(req, res));
router.post('/bot/campaign/send', requirePermission(['bot.campaigns', 'bot']), (req, res) => botController.sendCampaign(req, res));
router.put('/bot/campaign/settings', requirePermission(['bot.campaigns', 'bot']), (req, res) => botController.saveCampaignSettings(req, res));
router.get('/bot/feedbacks', requirePermission(['bot.feedbacks', 'bot']), (req, res) => botController.getFeedbacks(req, res));
router.put('/bot/feedbacks/:id/resolve', requirePermission(['bot.feedbacks', 'bot']), (req, res) => botController.resolveFeedback(req, res));
router.get('/bot/knowledge', requirePermission(['bot.knowledge', 'bot']), (req, res) => botController.getKnowledge(req, res));
router.post('/bot/knowledge', requirePermission(['bot.knowledge', 'bot']), (req, res) => botController.addKnowledge(req, res));
router.delete('/bot/knowledge/:id', requirePermission(['bot.knowledge', 'bot']), (req, res) => botController.deleteKnowledge(req, res));

// ================= GESTÃO DE MOTOBOYS =================
router.get('/store/motoboys', (req, res) => storeController.getMotoboys(req, res));
router.post('/store/motoboys', requirePermission(['motoboys.manage', 'store.manage', 'store']), (req, res) => storeController.addMotoboy(req, res));
router.delete('/store/motoboys/:name', requirePermission(['motoboys.manage', 'store.manage', 'store']), (req, res) => storeController.removeMotoboy(req, res));

// ================= LOGS DE SEGURANÇA & AUDITORIA =================
router.get('/admin/security-logs', requirePermission(['security.view', 'security']), (req, res) => {
  try {
    const { limit, severity, type } = req.query;
    const result = securityAuditService.getLogs({ limit, severity, type });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/admin/security-logs/clear', requirePermission(['security.clear_logs', 'security']), (req, res) => {
  try {
    securityAuditService.clearLogs();
    return res.json({ ok: true, message: 'Logs de auditoria e segurança limpos com sucesso.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ================= AUTENTICAÇÃO DO ADMIN & OPERADORES =================
router.post('/admin/auth', (req, res) => {
  const { password, login, email } = req.body || {};
  const rawPass = typeof password === 'string' ? password.trim() : '';
  const loginUser = (login || email || '').trim();

  // 1. Tenta autenticar por usuário específico cadastrado ou senha mestre
  const authenticatedUser = userService.authenticate(loginUser, rawPass);
  if (authenticatedUser) {
    if (!authenticatedUser.active) {
      return res.status(403).json({
        ok: false,
        error: 'Este usuário está inativo no momento. Entre em contato com o Administrador.'
      });
    }

    const token = createAdminToken(authenticatedUser);
    return res.json({
      ok: true,
      token,
      user: typeof authenticatedUser.toDTO === 'function' ? authenticatedUser.toDTO() : {
        id: authenticatedUser.id,
        name: authenticatedUser.name,
        email: authenticatedUser.email,
        role: authenticatedUser.role,
        permissions: authenticatedUser.permissions
      }
    });
  }

  // 2. Validação direta contra senha administrativa armazenada (compatibilidade total legada e testes)
  const stored = db.get()?.settings?.adminPassword || process.env.ADMIN_PASSWORD;
  if (verifyAndMigratePassword(rawPass, stored)) {
    const adminUser = userService.getDefaultAdmin();
    const token = createAdminToken(adminUser);
    return res.json({
      ok: true,
      token,
      user: adminUser.toDTO()
    });
  }

  try {
    securityAuditService.recordEvent({
      type: SecurityEventType.AUTH_FAILURE,
      severity: SecuritySeverity.HIGH,
      ip: securityAuditService.extractClientIp(req),
      endpoint: '/api/admin/auth',
      method: 'POST',
      details: `Falha na autenticação do painel administrativo para "${loginUser || 'admin'}".`,
      userAgent: req.headers['user-agent']
    });
  } catch (e) {}

  return res.status(401).json({ ok: false, error: 'Credenciais inválidas.' });
});

router.post('/admin/change-password', requirePermission(['store.change_master_password', 'store']), (req, res) => storeController.changePassword(req, res));

// ================= GERENCIAMENTO DE USUÁRIOS & PERMISSÕES (RBAC) =================
router.get('/auth/me', adminAuthMiddleware, (req, res) => userController.me(req, res));
router.get('/users', requirePermission(['users.view', 'users']), (req, res) => userController.list(req, res));
router.post('/users', requirePermission(['users.create', 'users']), (req, res) => userController.create(req, res));
router.get('/users/:id', requirePermission(['users.view', 'users']), (req, res) => userController.getById(req, res));
router.put('/users/:id', requirePermission(['users.edit', 'users']), (req, res) => userController.update(req, res));
router.patch('/users/:id/toggle-status', requirePermission(['users.toggle_status', 'users']), (req, res) => userController.toggleStatus(req, res));
router.delete('/users/:id', requirePermission(['users.delete', 'users']), (req, res) => userController.delete(req, res));

export default router;
