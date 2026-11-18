import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Validação da Mensagem de Rota para WhatsApp do Entregador', async (t) => {
  const adminJsPath = path.join(__dirname, '..', 'public', 'js', 'admin.js');
  const adminJsContent = fs.readFileSync(adminJsPath, 'utf8');

  await t.test('1. admin.js NÃO deve conter bloco GPS ROTA COMPLETA na mensagem de WhatsApp', () => {
    assert.strictEqual(
      adminJsContent.includes('*GPS ROTA COMPLETA (GOOGLE MAPS):*'),
      false,
      'A mensagem de rota não deve conter o texto *GPS ROTA COMPLETA (GOOGLE MAPS):*'
    );
  });

  await t.test('2. generateRouteWhatsAppText deve formatar paradas e link de entrega sem link de rota completa', () => {
    // Simula ambiente global mínimo do navegador
    const mockWindow = {
      location: { origin: 'https://cardapioexplosaoacai.com.br' }
    };
    const CURRENT_SELECTED_ROUTE_LABEL = 'Rota 2';
    const R = (val) => `R$ ${Number(val).toFixed(2).replace('.', ',')}`;

    // Extrai a função window.generateRouteWhatsAppText
    const funcMatch = adminJsContent.match(/window\.generateRouteWhatsAppText\s*=\s*function\(selected\)\s*\{([\s\S]*?)\};\s*window\.openSendRouteToMotoboyModal/);
    assert.ok(funcMatch, 'Função window.generateRouteWhatsAppText encontrada');

    const fnBody = funcMatch[1];
    const generateFn = new Function('selected', 'window', 'CURRENT_SELECTED_ROUTE_LABEL', 'R', fnBody);

    const sampleOrders = [
      {
        id: 'ord_123',
        orderNo: '838346',
        customer: { name: 'Manoel' },
        delivery: { street: 'Rua Carlos Milani', number: '890', bairro: 'Recanto Fortuna' },
        total: 69.90,
        payment: { method: 'Cartão de débito', timing: 'delivery' }
      },
      {
        id: 'ord_456',
        orderNo: '701483',
        customer: { name: 'Cleomar' },
        delivery: { street: 'Rua Carlos Gomes', number: '989', bairro: 'Miramontes' },
        total: 50.60,
        payment: { method: 'Dinheiro', timing: 'delivery' }
      }
    ];

    const result = generateFn(sampleOrders, mockWindow, CURRENT_SELECTED_ROUTE_LABEL, R);

    // Verificações obrigatórias
    assert.ok(result.includes('ROTA 2 - EXPLOSÃO AÇAÍ'), 'Contém cabeçalho da rota');
    assert.ok(result.includes('Total: 2 entregas'), 'Contém contagem de entregas');
    assert.ok(result.includes('Parada 1 · Pedido #838346'), 'Contém Parada 1');
    assert.ok(result.includes('Manoel'), 'Contém nome do cliente');
    assert.ok(result.includes('Rua Carlos Milani, 890, Recanto Fortuna'), 'Contém endereço');
    assert.ok(result.includes('Passar na Maquininha: R$ 69,90'), 'Contém informação de pagamento');
    assert.ok(result.includes('Link da Entrega: https://cardapioexplosaoacai.com.br/motoboy?id=ord_123'), 'Contém link individual da entrega');

    assert.ok(result.includes('Parada 2 · Pedido #701483'), 'Contém Parada 2');
    assert.ok(result.includes('Link da Entrega: https://cardapioexplosaoacai.com.br/motoboy?id=ord_456'), 'Contém link individual da entrega 2');

    // Regra principal: NÃO PODE conter GPS Rota Completa nem o link de direções do Google Maps
    assert.strictEqual(result.includes('GPS ROTA COMPLETA'), false, 'NÃO deve conter GPS ROTA COMPLETA');
    assert.strictEqual(result.includes('google.com/maps/dir'), false, 'NÃO deve conter link google.com/maps/dir');
  });
});
