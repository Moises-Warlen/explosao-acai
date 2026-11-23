import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiAssistantService as bot } from '../src/application/services/GeminiAssistantService.js';

test('Delivery: reconhece perguntas sobre delivery/taxa de entrega', () => {
  const sim = [
    'Vocês fazem delivery?',
    'tem delivery?',
    'Qual a taxa de entrega?',
    'quanto é o frete pro bairro Aeroporto',
    'vcs entregam no santa cruz?',
    'Fazem entrega aqui?',
    'Tem entrega pra Elimar?'
  ];
  for (const t of sim) assert.equal(bot.isDeliveryQuestion(t), true, t);
});

test('Delivery: nao captura rastreio, atraso ou conversa comum', () => {
  const nao = [
    'Cadê meu pedido?',
    'minha entrega está atrasada',
    'onde está o motoboy',
    'Quero um açaí de 500ml',
    'Quero pedir um Clássico',
    'status do pedido',
    ''
  ];
  for (const t of nao) assert.equal(bot.isDeliveryQuestion(t), false, t);
});

test('Delivery: resposta padrao com valores das configuracoes e link do cardapio', () => {
  const r = bot.buildDeliveryReply({ publicUrl: 'https://cardapioexplosaoacai.com.br' });
  assert.match(r, /^Oi! 😍 Sim, fazemos delivery! 🛵/);
  assert.match(r, /Até 2 km: entrega grátis!/);
  assert.match(r, /taxa mínima de R\$ 4,50/);
  assert.match(r, /R\$ 1,00 por km rodado/);
  assert.match(r, /🛒 https:\/\/cardapioexplosaoacai\.com\.br\/$/);
  assert.ok(!r.includes('explosaodoacai'), 'dominio correto (sem "do")');
});
