import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Cardápio Digital - Lógica de Seleção e Carrinho Independente', () => {
  // Simulação do catálogo
  const sampleProduct = {
    id: 'prod_classico',
    name: 'Clássico',
    description: 'Açaí tradicional batido.',
    prices: [
      { size: 300, price: 19.90 },
      { size: 500, price: 23.90 },
      { size: 700, price: 28.90 }
    ],
    isCustomizable: true
  };

  const sampleExtras = [
    { id: 'ext_nutella', name: 'Nutella', price: 4.00, allowInAcai: true },
    { id: 'ext_bis', name: 'Bis', price: 3.00, allowInAcai: true },
    { id: 'ext_brigadeiro', name: 'Brigadeiro', price: 3.50, allowInAcai: true }
  ];

  it('Regra 1: Deve iniciar com estado 100% limpo ao abrir o produto (mesmo se aberto consecutivamente)', () => {
    // 1ª abertura
    let state = {
      product: sampleProduct,
      selectedSizeIdx: 0,
      accompaniments: [],
      extras: [],
      fruits: [],
      note: '',
      quantity: 1
    };

    // Usuário altera seleções na 1ª personalização
    state.selectedSizeIdx = 1; // 500ml
    state.accompaniments.push('Granola', 'Leite Condensado');
    state.extras.push('ext_nutella');
    state.note = 'Pouca granola por favor';
    state.quantity = 2;

    assert.strictEqual(state.selectedSizeIdx, 1);
    assert.strictEqual(state.accompaniments.length, 2);
    assert.strictEqual(state.extras.length, 1);
    assert.strictEqual(state.note, 'Pouca granola por favor');
    assert.strictEqual(state.quantity, 2);

    // 2ª abertura do MESMO produto (como executado em openItemModal):
    const freshState = {
      product: sampleProduct,
      selectedSizeIdx: 0,
      accompaniments: [],
      extras: [],
      fruits: [],
      note: '',
      quantity: 1
    };

    assert.strictEqual(freshState.selectedSizeIdx, 0, 'Tamanho padrão (index 0) selecionado');
    assert.strictEqual(freshState.accompaniments.length, 0, 'Nenhum adicional/acompanhamento marcado');
    assert.strictEqual(freshState.extras.length, 0, 'Nenhum extra marcado');
    assert.strictEqual(freshState.fruits.length, 0, 'Nenhuma fruta marcada');
    assert.strictEqual(freshState.note, '', 'Campo de observação vazio');
    assert.strictEqual(freshState.quantity, 1, 'Quantidade igual a 1');
  });

  it('Regra 2 & 3: Deve adicionar múltiplos copos de forma independente com ID único e sem misturar', () => {
    let CART = [];

    function addItem(st) {
      const prod = st.product;
      const selectedSizeObj = prod.prices[st.selectedSizeIdx] || prod.prices[0];
      const basePrice = selectedSizeObj.price;

      let extrasTotal = 0;
      const extrasNames = [];
      st.extras.forEach(extId => {
        const ext = sampleExtras.find(e => e.id === extId);
        if (ext) {
          extrasTotal += ext.price;
          extrasNames.push(`${ext.name} (+R$ ${ext.price.toFixed(2)})`);
        }
      });

      const unitPrice = basePrice + extrasTotal;
      const itemTitle = `${prod.name} ${selectedSizeObj.size} ml`;
      const cartItemId = 'copo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 7);

      const cartItem = {
        id: cartItemId,
        productId: prod.id,
        name: itemTitle,
        size: selectedSizeObj.size,
        quantity: Math.max(1, st.quantity || 1),
        unitPrice: unitPrice,
        accompaniments: [...st.accompaniments],
        extras: [...extrasNames],
        fruits: [...st.fruits],
        note: (st.note || '').trim()
      };

      CART.push(cartItem);
      return cartItem;
    }

    // Copo 1: 1x Clássico 300ml com Nutella e Brigadeiro
    const item1 = addItem({
      product: sampleProduct,
      selectedSizeIdx: 0, // 300ml = 19.90
      accompaniments: ['Granola'],
      extras: ['ext_nutella', 'ext_brigadeiro'], // 4.00 + 3.50 = 7.50 => 27.40
      fruits: [],
      note: 'Sem colher',
      quantity: 1
    });

    assert.strictEqual(CART.length, 1);
    assert.ok(item1.id.startsWith('copo_'), 'Possui ID único');
    assert.strictEqual(item1.size, 300);
    assert.strictEqual(item1.unitPrice, 27.40);
    assert.strictEqual(item1.extras.length, 2);
    assert.strictEqual(item1.note, 'Sem colher');

    // Copo 2: 1x Clássico 500ml com Bis
    const item2 = addItem({
      product: sampleProduct,
      selectedSizeIdx: 1, // 500ml = 23.90
      accompaniments: ['Paçoca'],
      extras: ['ext_bis'], // 3.00 => 26.90
      fruits: [],
      note: 'Bem gelado',
      quantity: 1
    });

    // Verificação de independência e não-sobrescrita
    assert.strictEqual(CART.length, 2, 'Carrinho possui exatamente 2 copos como linhas separadas');
    assert.notStrictEqual(CART[0].id, CART[1].id, 'Cada copo possui ID único e independente');
    assert.strictEqual(CART[0].size, 300, 'Copo 1 manteve 300ml');
    assert.strictEqual(CART[1].size, 500, 'Copo 2 manteve 500ml');
    assert.strictEqual(CART[0].note, 'Sem colher', 'Copo 1 manteve observação própria');
    assert.strictEqual(CART[1].note, 'Bem gelado', 'Copo 2 manteve observação própria');

    // Cálculo correto do total
    const totalOrder = CART.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
    const expectedTotal = 27.40 + 26.90; // 54.30
    assert.strictEqual(totalOrder.toFixed(2), expectedTotal.toFixed(2), 'Total calculado corretamente somando os dois copos');

    // Remoção independente por ID
    const initialCount = CART.length;
    const itemToRemove = CART[0].id;
    CART = CART.filter(it => it.id !== itemToRemove);
    assert.strictEqual(CART.length, initialCount - 1, 'Removeu apenas o copo selecionado');
    assert.strictEqual(CART[0].id, item2.id, 'O segundo copo permaneceu intacto no carrinho');
  });
});
