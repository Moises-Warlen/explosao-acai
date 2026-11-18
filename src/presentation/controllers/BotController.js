import { whatsAppBotService } from '../../infrastructure/notifications/WhatsAppBotService.js';
import { geminiAssistantService } from '../../application/services/GeminiAssistantService.js';

class BotController {
  getStatus(req, res) {
    try {
      const status = whatsAppBotService.getStatus();
      return res.json({
        ok: true,
        ...status,
        hasGeminiKey: Boolean(geminiAssistantService.apiKey)
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async connect(req, res) {
    try {
      // Inicia a conexão em segundo plano para não travar a requisição HTTP
      whatsAppBotService.startConnection().catch(err => {
        console.error('[BotController] Erro na inicialização do WhatsApp:', err.message);
      });
      return res.json({
        ok: true,
        message: 'Iniciando conexão com o WhatsApp. Aguarde a leitura do QR Code.',
        ...whatsAppBotService.getStatus()
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async disconnect(req, res) {
    try {
      await whatsAppBotService.disconnect();
      return res.json({
        ok: true,
        message: 'WhatsApp desconectado com sucesso.',
        ...whatsAppBotService.getStatus()
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  toggleAI(req, res) {
    try {
      const enabled = whatsAppBotService.toggleAI(req.body?.enabled);
      return res.json({
        ok: true,
        aiEnabled: enabled,
        message: enabled ? 'Inteligência Artificial ativada!' : 'Inteligência Artificial pausada.'
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  setGeminiKey(req, res) {
    try {
      const { apiKey } = req.body || {};
      geminiAssistantService.setApiKey(apiKey);
      return res.json({
        ok: true,
        hasGeminiKey: Boolean(geminiAssistantService.apiKey),
        message: 'Chave da API do Gemini atualizada com sucesso!'
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  releaseHuman(req, res) {
    try {
      const { phone } = req.params;
      whatsAppBotService.releaseHumanTakeover(phone);
      return res.json({
        ok: true,
        message: `Atendimento automático via IA reativado para o número ${phone}.`
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async sendTestMessage(req, res) {
    try {
      const { phone, text } = req.body || {};
      if (!phone || !text) {
        return res.status(400).json({ ok: false, error: 'Telefone e mensagem são obrigatórios.' });
      }
      const sent = await whatsAppBotService.sendTextMessage(phone, text);
      if (!sent) {
        return res.status(400).json({
          ok: false,
          error: 'Não foi possível enviar a mensagem. Verifique se o bot está conectado ao WhatsApp.'
        });
      }
      return res.json({ ok: true, message: 'Mensagem de teste enviada com sucesso!' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  getCampaignInfo(req, res) {
    try {
      const eligible = whatsAppBotService.getEligibleCustomers();
      const settings = whatsAppBotService.getCampaignSettings();
      return res.json({
        ok: true,
        eligibleCount: eligible.length,
        optOutCount: whatsAppBotService.optOutPhones.size,
        campaignInProgress: whatsAppBotService.campaignInProgress,
        settings
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async previewCampaign(req, res) {
    try {
      const { productName, discount, couponCode } = req.body || {};
      const message = await geminiAssistantService.generateWeeklyPromotionText({
        productName,
        discount,
        couponCode
      });
      return res.json({ ok: true, message });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  async sendCampaign(req, res) {
    try {
      const { message, productName, couponCode, testPhone, dryRun } = req.body || {};
      const result = await whatsAppBotService.sendWeeklyPromotionCampaign({
        message,
        productName,
        couponCode,
        testPhone,
        dryRun: Boolean(dryRun)
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  saveCampaignSettings(req, res) {
    try {
      const updated = whatsAppBotService.updateCampaignSettings(req.body);
      return res.json({
        ok: true,
        message: 'Configurações de disparo semanal atualizadas com sucesso!',
        settings: updated
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}

export const botController = new BotController();
