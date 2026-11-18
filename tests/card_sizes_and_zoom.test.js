import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('Validação da Exibição Dinâmica de Tamanhos e Zoom Suave nos Cards', async (t) => {
  const appJs = fs.readFileSync('public/js/app.js', 'utf8');
  const styleCss = fs.readFileSync('public/css/style.css', 'utf8');
  const db = JSON.parse(fs.readFileSync('data/database.json', 'utf8'));

  await t.test('1. formatProductSizesText formata dinamicamente e suporta ml, Litros e customizados', () => {
    // Extrai a função formatProductSizesText do app.js para execução isolada
    const funcMatch = appJs.match(/function formatProductSizesText\([\s\S]*?\n\}/);
    assert.ok(funcMatch, 'formatProductSizesText deve estar definida em app.js');

    const formatProductSizesText = new Function('prod', `
      ${funcMatch[0]}
      return formatProductSizesText(prod);
    `);

    // Teste com produto de 3 tamanhos
    const prodMulti = { prices: [{ size: 300 }, { size: 500 }, { size: 700 }] };
    assert.strictEqual(formatProductSizesText(prodMulti), '300ml • 500ml • 700ml');

    // Teste com produto kids 180ml
    const prodKids = { prices: [{ size: 180 }] };
    assert.strictEqual(formatProductSizesText(prodKids), '180ml');

    // Teste com 1 Litro e 2 Litros
    const prod1L = { prices: [{ size: 1000 }] };
    assert.strictEqual(formatProductSizesText(prod1L), '1 Litro');
    const prod2L = { prices: [{ size: 2000 }] };
    assert.strictEqual(formatProductSizesText(prod2L), '2 Litros');

    // Teste com strings customizadas (ex: potes)
    const prodCustom = { sizes: ['Pote 500g', 'Pote 1kg'] };
    assert.strictEqual(formatProductSizesText(prodCustom), 'Pote 500g • Pote 1kg');

    // Teste com item sem tamanhos
    const prodEmpty = { prices: [] };
    assert.strictEqual(formatProductSizesText(prodEmpty), '');
    assert.strictEqual(formatProductSizesText({}), '');
  });

  await t.test('2. renderProductCard insere a faixa de tamanhos com ícone de copo e oculta se vazio', () => {
    assert.ok(appJs.includes('card-sizes-bar'), 'Deve conter a classe card-sizes-bar');
    assert.ok(appJs.includes('card-sizes-icon'), 'Deve conter o ícone do copo card-sizes-icon');
    assert.ok(appJs.includes('card-sizes-text'), 'Deve conter o texto card-sizes-text');
    assert.ok(appJs.includes('Tamanhos: ${esc(sizesText)}'), 'Deve interpolar o texto dinâmico dos tamanhos');

    // Garante que não há strings hardcoded da imagem de referência no código
    assert.strictEqual(
      appJs.includes('Tamanhos: 300ml • 500ml • 700ml'),
      false,
      'Proibido deixar tamanhos fixos hardcoded'
    );
  });

  await t.test('3. Todos os produtos reais do banco possuem tamanhos formatados dinamicamente', () => {
    const funcMatch = appJs.match(/function formatProductSizesText\([\s\S]*?\n\}/);
    const formatProductSizesText = new Function('prod', `
      ${funcMatch[0]}
      return formatProductSizesText(prod);
    `);

    const products = db.products || [];
    assert.ok(products.length > 0, 'Deve haver produtos no banco');

    products.forEach(p => {
      const res = formatProductSizesText(p);
      assert.ok(typeof res === 'string', `Resultado de ${p.name} deve ser string`);
      if (p.prices && p.prices.length > 0) {
        assert.ok(res.length > 0, `Produto ${p.name} deve ter tamanhos exibidos`);
      }
    });

    // Exemplos específicos do banco
    const classico = products.find(p => p.id === 'prod_classico');
    assert.strictEqual(formatProductSizesText(classico), '300ml • 500ml • 700ml');

    const miniKids = products.find(p => p.id === 'prod_kids_mixfini');
    assert.strictEqual(formatProductSizesText(miniKids), '180ml');

    const polpa1L = products.find(p => p.id === 'polpa_1l');
    assert.strictEqual(formatProductSizesText(polpa1L), '1 Litro');

    const polpa2L = products.find(p => p.id === 'polpa_2l');
    assert.strictEqual(formatProductSizesText(polpa2L), '2 Litros');
  });

  await t.test('4. CSS: Moldura com overflow hidden, object-cover e zoom suave exclusivo na foto', () => {
    // Moldura com overflow hidden
    assert.ok(styleCss.includes('.ic {'), 'Deve conter regra .ic');
    assert.ok(styleCss.includes('overflow: hidden;'), 'Container .ic deve ter overflow: hidden');

    // Imagem com object-fit: cover e transition
    assert.ok(styleCss.includes('object-fit: cover;'), '.ic img deve usar object-fit: cover');
    assert.ok(styleCss.includes('transition: transform'), '.ic img deve ter transition suave de transform');

    // Zoom suave exclusivo na foto
    assert.ok(
      styleCss.includes('.card:hover .ic img') || styleCss.includes('.ic:hover img'),
      'Deve aplicar zoom na foto com hover'
    );
    assert.ok(
      styleCss.includes('.card:active .ic img') || styleCss.includes('.ic:active img'),
      'Deve aplicar zoom na foto com active/toque mobile'
    );
    assert.ok(styleCss.includes('scale('), 'Zoom deve utilizar scale()');

    // Faixa discreta de tamanhos estilizada
    assert.ok(styleCss.includes('.card-sizes-bar {'), 'Deve conter estilos para .card-sizes-bar');
    assert.ok(styleCss.includes('.card-sizes-icon {'), 'Deve conter estilos para .card-sizes-icon');
    assert.ok(styleCss.includes('.card-sizes-text {'), 'Deve conter estilos para .card-sizes-text');
  });
});
