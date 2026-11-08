import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';
import QRCode from 'qrcode';
import { db } from '../database/JsonDatabase.js';

/**
 * Cálculo do Checksum CRC-16 CCITT (Polinômio 0x1021, valor inicial 0xFFFF)
 * Padrão estrito exigido pelo Banco Central do Brasil para EMVCo Pix BR Code.
 */
function computeCRC16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= (payload.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Formata um campo no padrão EMVCo TLV (Tag, Length, Value)
 */
function formatEMVCoTag(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

/**
 * Gera string Pix Copia e Cola estática válida conforme as normas do Banco Central do Brasil (EMVCo)
 */
export function generatePixStaticEMVCo({ key, name, city, amount, orderNo }) {
  const cleanName = (name || 'EXPLOSAO ACAI')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().substring(0, 25).trim();
  const cleanCity = (city || 'FRANCA')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().substring(0, 15).trim();

  let pixKey = String(key || '16991098863').trim();
  // Se for celular (10 ou 11 dígitos numéricos), formata no padrão E.164 (+55)
  if (/^\d{10,11}$/.test(pixKey)) {
    pixKey = `+55${pixKey}`;
  }

  const amountStr = Number(amount || 0).toFixed(2);
  const txid = String(orderNo || 'PEDIDO').replace(/[^A-Za-z0-9]/g, '').substring(0, 25) || '***';

  const sub26_00 = formatEMVCoTag('00', 'br.gov.bcb.pix');
  const sub26_01 = formatEMVCoTag('01', pixKey);
  const tag26 = formatEMVCoTag('26', `${sub26_00}${sub26_01}`);

  const sub62_05 = formatEMVCoTag('05', txid);
  const tag62 = formatEMVCoTag('62', sub62_05);

  let payload = 
    formatEMVCoTag('00', '01') +             // Payload Format Indicator
    formatEMVCoTag('01', '12') +             // Point of Initiation (12 = dinâmico / valor fixo)
    tag26 +                                  // Conta Pix recebedora
    formatEMVCoTag('52', '0000') +           // Merchant Category Code
    formatEMVCoTag('53', '986') +            // Moeda BRL
    formatEMVCoTag('54', amountStr) +        // Valor da cobrança
    formatEMVCoTag('58', 'BR') +             // País
    formatEMVCoTag('59', cleanName) +        // Nome recebedor
    formatEMVCoTag('60', cleanCity) +        // Cidade
    tag62 +                                  // Referência / Pedido
    '6304';                                  // Início do Checksum CRC16

  const crc = computeCRC16(payload);
  return `${payload}${crc}`;
}

export class MercadoPagoService {
  constructor() {
    this.refreshClient();
  }

  refreshClient() {
    const settings = db.get()?.settings || {};
    this.accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || settings.mercadoPagoAccessToken || '';
    this.publicKey = process.env.MERCADO_PAGO_PUBLIC_KEY || settings.mercadoPagoPublicKey || '';

    // Se o token for o placeholder de teste padrão ou vazio, opera com chave Pix direta
    const isPlaceholder = !this.accessToken || this.accessToken === 'TEST-1234567890-abcdef-0987654321' || !this.accessToken.trim();

    if (!isPlaceholder) {
      try {
        this.client = new MercadoPagoConfig({
          accessToken: this.accessToken.trim(),
          options: { timeout: 6000 }
        });
        this.paymentClient = new Payment(this.client);
        this.preferenceClient = new Preference(this.client);
      } catch (err) {
        console.warn('Aviso: Não foi possível instanciar MercadoPagoConfig:', err.message);
        this.client = null;
        this.paymentClient = null;
      }
    } else {
      this.client = null;
      this.paymentClient = null;
    }
  }

  async createPixPayment({ orderNo, total, customer, items = [] }) {
    this.refreshClient();

    // 1. Se cliente oficial do Mercado Pago estiver disponível, tenta gerar Pix oficial
    if (this.paymentClient) {
      try {
        const cleanName = (customer.name || 'Cliente').trim();
        const [firstName, ...rest] = cleanName.split(/\s+/);
        const lastName = rest.join(' ') || 'Delivery';
        const cleanPhone = String(customer.phone || '').replace(/\D/g, '');

        const paymentData = {
          transaction_amount: Number(total.toFixed(2)),
          description: `Explosão Açaí - Pedido #${orderNo}`,
          payment_method_id: 'pix',
          payer: {
            email: customer.email || `${cleanPhone || 'cliente'}@explosaoacai.com.br`,
            first_name: firstName,
            last_name: lastName,
            phone: {
              area_code: cleanPhone.substring(0, 2) || '16',
              number: cleanPhone.substring(2) || '991098863'
            }
          },
          external_reference: String(orderNo)
        };

        const result = await this.paymentClient.create({ body: paymentData });

        let qrCode = result.point_of_interaction?.transaction_data?.qr_code || '';
        let qrCodeBase64 = result.point_of_interaction?.transaction_data?.qr_code_base64 || '';

        // Se o MP retornou a string Pix mas não a imagem, gera o QR Code em alta resolução
        if (qrCode && !qrCodeBase64) {
          qrCodeBase64 = await QRCode.toDataURL(qrCode, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 300,
            color: { dark: '#2a0a3d', light: '#ffffff' }
          });
        }

        return {
          id: String(result.id),
          status: result.status || 'pending',
          paymentMethod: 'Pix',
          qrCode,
          qrCodeBase64,
          ticketUrl: result.point_of_interaction?.transaction_data?.ticket_url || '',
          isMock: false
        };
      } catch (err) {
        console.warn('Mercado Pago API indisponível ou recusou criação, utilizando Pix Direto Seguro:', err.message);
      }
    }

    // 2. Fallback de Alta Fidelidade: Gera EMVCo BR Code e QR Code 100% válido para qualquer banco
    return await this.createPixDirect({ orderNo, total });
  }

  async createPixDirect({ orderNo, total }) {
    const settings = db.get()?.settings || {};
    const pixKey = settings.pixKey || settings.wpp || '16991098863';
    const storeName = settings.storeName || 'Explosão Açaí';
    const city = settings.city || 'Franca';

    const pixCode = generatePixStaticEMVCo({
      key: pixKey,
      name: storeName,
      city,
      amount: total,
      orderNo
    });

    const qrCodeDataUrl = await QRCode.toDataURL(pixCode, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: {
        dark: '#2a0a3d',
        light: '#ffffff'
      }
    });

    return {
      id: `pix_${Date.now()}_${orderNo}`,
      status: 'pending',
      paymentMethod: 'Pix',
      qrCode: pixCode,
      qrCodeBase64: qrCodeDataUrl,
      ticketUrl: '',
      isMock: true
    };
  }

  async processCardPayment({ orderNo, total, token, paymentMethodId, installments = 1, issuerId, customer }) {
    this.refreshClient();

    if (!this.paymentClient) {
      return {
        id: `card_${Date.now()}`,
        status: 'approved',
        statusDetail: 'accredited',
        paymentMethod: paymentMethodId || 'Cartão',
        isMock: true
      };
    }

    try {
      const paymentData = {
        transaction_amount: Number(total.toFixed(2)),
        token,
        description: `Explosão Açaí - Pedido #${orderNo}`,
        installments: Number(installments),
        payment_method_id: paymentMethodId,
        issuer_id: issuerId,
        payer: {
          email: `${customer.phone}@explosaoacai.com.br`,
          first_name: customer.name
        },
        external_reference: String(orderNo)
      };

      const result = await this.paymentClient.create({ body: paymentData });
      return {
        id: String(result.id),
        status: result.status,
        statusDetail: result.status_detail,
        paymentMethod: result.payment_method_id,
        isMock: false
      };
    } catch (err) {
      console.error('Erro ao processar cartão com Mercado Pago:', err);
      throw new Error(err.message || 'Falha ao processar pagamento com cartão.');
    }
  }

  async getPaymentStatus(paymentId) {
    this.refreshClient();

    if (!this.paymentClient || !paymentId || !/^\d+$/.test(String(paymentId))) {
      return { status: 'pending', id: paymentId };
    }

    try {
      const p = await this.paymentClient.get({ id: String(paymentId) });
      return { status: p.status, id: String(p.id) };
    } catch (err) {
      console.error('Erro ao consultar status no Mercado Pago:', err.message);
      return { status: 'pending', id: paymentId };
    }
  }
}

export const mercadoPagoService = new MercadoPagoService();
