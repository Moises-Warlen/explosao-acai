/* =========================================================================
   SERVIÇO DE IMPRESSÃO TÉRMICA ESC/POS & COMANDAS — EXPLOSÃO AÇAÍ
   - Formatação clara de Pagamento Online vs Cobrança na Entrega
   - Alerta destacado de Troco em dinheiro
   - Separação Cozinha (Produção limpa) vs Balcão (Entrega / Motoboy)
   ========================================================================= */

import { db } from '../database/JsonDatabase.js';

export class ThermalPrinterService {
  constructor() {
    this.db = db;
  }

  getPrinters() {
    return this.db.get().printers || [];
  }

  getPrinterById(id) {
    return this.getPrinters().find(p => p.id === id);
  }

  savePrinters(printers) {
    const data = this.db.get();
    data.printers = printers;
    this.db.save();
    return printers;
  }

  /**
   * Gera o cupom formatado de acordo com a estação de destino (cozinha ou balcão)
   */
  generateTicket(order, target = 'counter', paperWidth = 80) {
    const isKitchen = target === 'kitchen';
    const store = this.db.get().settings;
    const cols = paperWidth === 58 ? 32 : 48;
    const divider = '='.repeat(cols);
    const thinDivider = '-'.repeat(cols);

    const pad = (left, right) => {
      const space = cols - left.length - right.length;
      return left + ' '.repeat(Math.max(1, space)) + right;
    };

    const center = (text) => {
      const padLen = Math.floor((cols - text.length) / 2);
      return ' '.repeat(Math.max(0, padLen)) + text;
    };

    const money = (val) => 'R$ ' + Number(val || 0).toFixed(2).replace('.', ',');

    const lines = [];

    // CABEÇALHO
    lines.push(divider);
    lines.push(center('EXPLOSÃO AÇAÍ - DELIVERY'));
    lines.push(center('Especialidades, Copos & Combos'));
    if (isKitchen) {
      lines.push(center('*** VIA DE PRODUÇÃO / COZINHA ***'));
    } else {
      lines.push(center('*** VIA CLIENTE / ENTREGA ***'));
    }
    lines.push(center(`PEDIDO #${order.orderNo}`));
    lines.push(center(new Date(order.createdAt).toLocaleString('pt-BR')));
    lines.push(divider);

    // DADOS DO CLIENTE
    lines.push(`CLIENTE: ${order.customer.name.toUpperCase()}`);
    lines.push(`TELEFONE: ${order.customer.phone}`);
    if (order.delivery?.type === 'delivery') {
      lines.push(`TIPO: ENTREGA EM DOMICÍLIO`);
      if (!isKitchen) {
        lines.push(thinDivider);
        lines.push('ENDEREÇO DE ENTREGA:');
        lines.push(`${order.delivery.street}, ${order.delivery.number}`);
        lines.push(`Bairro: ${order.delivery.bairro}`);
        lines.push(`Cidade: ${order.delivery.city} - ${order.delivery.state}`);
        if (order.delivery.cep) lines.push(`CEP: ${order.delivery.cep}`);
        if (order.delivery.reference) lines.push(`Ref/Comp: ${order.delivery.reference}`);
      }
    } else {
      lines.push(`TIPO: *** RETIRADA NO BALCÃO ***`);
    }
    lines.push(divider);

    // ITENS DO PEDIDO
    lines.push(center(isKitchen ? '--- ITENS PARA PREPARO ---' : '--- ITENS DO PEDIDO ---'));
    lines.push(thinDivider);

    order.items.forEach((item) => {
      const itemHeader = `${item.quantity}x ${item.name}`;
      if (isKitchen) {
        lines.push(itemHeader);
      } else {
        lines.push(pad(itemHeader, money(item.subtotal || (item.unitPrice * item.quantity))));
      }

      // Detalhes / Acompanhamentos
      if (item.accompaniments && item.accompaniments.length > 0) {
        lines.push(`  * Acomp: ${item.accompaniments.join(', ')}`);
      }

      // Extras e Adicionais
      if (item.extras && item.extras.length > 0) {
        item.extras.forEach(ext => {
          lines.push(`  + Extra: ${typeof ext === 'string' ? ext : ext.name}`);
        });
      }

      // Frutas Adicionais
      if (item.fruits && item.fruits.length > 0) {
        lines.push(`  + Frutas: ${item.fruits.join(', ')}`);
      }

      // Observações
      if (item.note && item.note.trim()) {
        lines.push(`  >> OBS: ${item.note.toUpperCase()}`);
      }
      lines.push('');
    });

    lines.push(divider);

    // SEÇÃO FINANCEIRA (apenas na via de balcão / entrega)
    if (!isKitchen) {
      lines.push(pad('Subtotal:', money(order.subtotal)));
      if (order.discount > 0) {
        lines.push(pad(`Desconto (${order.coupon?.code || 'Cupom'}):`, `-${money(order.discount)}`));
      }
      if (order.delivery?.type === 'delivery') {
        lines.push(pad(`Taxa de Entrega (${(order.delivery.km || 0).toFixed(1)} km):`, money(order.freight)));
      }
      lines.push(thinDivider);
      lines.push(pad('VALOR TOTAL:', money(order.total)));
      lines.push(divider);

      // STATUS DE COBRANÇA CLARO
      const isMoney = order.payment.method === 'Dinheiro';
      const isDeliveryPayment = order.payment.timing === 'delivery' || isMoney;

      if (isDeliveryPayment) {
        if (isMoney) {
          lines.push(center('*** COBRAR NA ENTREGA EM DINHEIRO ***'));
          lines.push(pad('Valor a cobrar:', money(order.total)));
          const trocoValue = order.calculateChange();
          if (trocoValue > 0) {
            lines.push(thinDivider);
            lines.push('********************************');
            lines.push(`* PAGO COM: ${money(order.payment.changeFor)}`);
            lines.push(`* LEVAR TROCO: ${money(trocoValue)}`);
            lines.push('********************************');
          } else {
            lines.push('Troco: NÃO PRECISA DE TROCO (Valor Exato)');
          }
        } else {
          lines.push('********************************');
          lines.push(center('*** COBRAR NA ENTREGA ***'));
          lines.push(center(`LEVAR MAQUININHA DE CARTÃO (${order.payment.method.toUpperCase()})`));
          lines.push(pad('Valor a cobrar:', money(order.total)));
          lines.push('********************************');
        }
      } else {
        lines.push(center('*** PAGO ONLINE - NÃO COBRAR DO CLIENTE ***'));
        lines.push(`FORMA: ${order.payment.method.toUpperCase()}`);
        lines.push(`STATUS: PAGO E APROVADO PELO BANCO`);
      }
    } else {
      lines.push(center('PRODUZIR COM QUALIDADE'));
    }

    lines.push(divider);
    lines.push(center('Explosão Açaí · Delivery Oficial'));
    lines.push(center('Franca/SP · WhatsApp: (16) 99109-8863'));
    lines.push(center('Agradecemos a sua preferência!'));
    lines.push('\n\n\n');

    return lines.join('\n');
  }

  toEscPosBuffer(plainText) {
    const INIT = Buffer.from([0x1B, 0x40]);
    const ALIGN_LEFT = Buffer.from([0x1B, 0x61, 0x00]);
    const CUT = Buffer.from([0x1D, 0x56, 0x41, 0x10]);
    const TEXT = Buffer.from(plainText, 'latin1');
    return Buffer.concat([INIT, ALIGN_LEFT, TEXT, CUT]);
  }
}

export const thermalPrinterService = new ThermalPrinterService();
