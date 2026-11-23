const fs = require('fs');
const assert = require('assert');

console.log('=== TESTE COMPLETO: MONTE SEU JEITO ESTÁTICO, DROPDOWN DE FRUTAS SEM ÍCONE DE MORANGO E TAMANHO DE FOTOS ===\n');

// 1. Test Database and Official Catalog
const db = JSON.parse(fs.readFileSync('data/database.json', 'utf8'));
const off = JSON.parse(fs.readFileSync('data/official_catalog.json', 'utf8'));

console.log('1. Verificando data/database.json e official_catalog.json...');
const expectedPrices = {
  'Morango': 4.00,
  'Banana': 2.50,
  'Kiwi': 4.00,
  'Manga': 2.50,
  'Uva sem caroço': 3.50,
  'Maracujá': 3.00
};

Object.entries(expectedPrices).forEach(([name, expectedPrice]) => {
  const fDb = db.fruits.find(f => f.name === name);
  const fOff = off.fruits.find(f => f.name === name);
  assert(fDb, `Fruta ${name} não encontrada em database.json`);
  assert(fOff, `Fruta ${name} não encontrada em official_catalog.json`);
  assert.strictEqual(Number(fDb.price), expectedPrice, `Preço incorreto para ${name} no database.json: esperado ${expectedPrice}, obtido ${fDb.price}`);
  assert.strictEqual(Number(fOff.price), expectedPrice, `Preço incorreto para ${name} no official_catalog.json: esperado ${expectedPrice}, obtido ${fOff.price}`);
  console.log(`  ✓ Fruta ${name}: Preço R$ ${fDb.price.toFixed(2)} (Custo: R$ ${fDb.costPrice.toFixed(2)})`);
});

const prodMonteDb = db.products.find(p => p.id === 'prod_monte');
assert(prodMonteDb, 'prod_monte deve existir em database.json');
assert.strictEqual(prodMonteDb.name, 'Monte do seu jeito');
assert.strictEqual(prodMonteDb.image, 'imagens/do seu jeitinho.webp');
assert.strictEqual(prodMonteDb.prices.length, 3);
console.log('  ✓ Produto prod_monte ("Monte do seu jeito") verificado com sucesso!\n');

// 2. Test CSS Rules in public/css/style.css
console.log('2. Verificando regras CSS em public/css/style.css...');
const css = fs.readFileSync('public/css/style.css', 'utf8');

assert(css.includes('.x {'), 'CSS deve conter classe .x');
assert(css.includes('z-index: 10000 !important;'), 'Botão .x deve ter z-index: 10000 !important');
assert(css.includes('cursor: pointer !important;'), 'Botão .x deve ter cursor: pointer !important');
assert(css.includes('pointer-events: auto !important;'), 'Botão .x deve ter pointer-events: auto !important');
console.log('  ✓ Botão .x possui z-index 10000, pointer-events: auto e cursor: pointer');

assert(!css.includes('.dynamic-cup-stage'), 'CSS NÃO deve conter mais .dynamic-cup-stage');
assert(!css.includes('.cup-ingredients-tray'), 'CSS NÃO deve conter mais .cup-ingredients-tray');
console.log('  ✓ Classes do copo dinâmico removidas do CSS conforme solicitado');

assert(css.includes('.sheet-photo-wrap'), 'CSS deve conter .sheet-photo-wrap');
assert(css.includes('.fruit-dropdown-section'), 'CSS deve conter .fruit-dropdown-section');
assert(css.includes('.fruit-dropdown-select'), 'CSS deve conter .fruit-dropdown-select');
assert(css.includes('.fruit-pill'), 'CSS deve conter .fruit-pill');
console.log('  ✓ Foto estática .sheet-photo-wrap, dropdown e tags de frutas estilizados no CSS\n');

// 3. Test JavaScript Logic in public/js/app.js
console.log('3. Verificando lógica em public/js/app.js...');
const js = fs.readFileSync('public/js/app.js', 'utf8');

assert(!js.includes('getBestMatchingCupImage'), 'app.js NÃO deve conter mais getBestMatchingCupImage');
assert(!js.includes('renderDynamicCupStage'), 'app.js NÃO deve conter mais renderDynamicCupStage');
assert(!js.includes('🍓'), 'app.js NÃO deve conter ícones de morango 🍓 em frutas');
assert(js.includes('sheet-photo-wrap'), 'app.js deve renderizar a foto estática do produto');
assert(js.includes('window.addFruit'), 'app.js deve exportar window.addFruit');
assert(js.includes('window.removeFruit'), 'app.js deve exportar window.removeFruit');
assert(js.includes('window.toggleFruit'), 'app.js deve exportar window.toggleFruit');
assert(js.includes('window.getFruitPrice'), 'app.js deve exportar window.getFruitPrice');
assert(js.includes('fruit-dropdown-section'), 'app.js deve renderizar fruit-dropdown-section');
assert(js.includes('fruit-dropdown-select'), 'app.js deve renderizar fruit-dropdown-select');
console.log('  ✓ Foto dinâmica removida, foto estática restabelecida e ícones de morango removidos');

// 4. Test WebP Image Dimensions in public/imagens
console.log('4. Verificando dimensões das fotos do cardápio em public/imagens...');
function getWebPDimensions(buffer) {
  if (buffer.length < 30) return null;
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  } else if (chunkType === 'VP8L') {
    const b0 = buffer[21], b1 = buffer[22], b2 = buffer[23], b3 = buffer[24];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  } else if (chunkType === 'VP8X') {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  return null;
}

const productImages = [
  'do seu jeitinho.webp',
  'classico.webp',
  'combo casal.webp',
  'combo economico.webp',
  'combo familia.webp',
  'combo kids.webp',
  'doce tentacao.webp',
  'granola.webp',
  'mix fini.webp',
  'ninho com morango.webp',
  'nutella.webp',
  'par perfeito.webp',
  'pote 1l e 2 l.webp',
  'Pura Polpa.webp'
];

productImages.forEach(imgName => {
  const buf = fs.readFileSync(`public/imagens/${imgName}`);
  const dims = getWebPDimensions(buf);
  assert(dims, `Não foi possível ler dimensões de ${imgName}`);
  assert.strictEqual(dims.width, 800, `Largura esperada 800 para ${imgName}, obtida ${dims.width}`);
  assert.strictEqual(dims.height, 600, `Altura esperada 600 para ${imgName}, obtida ${dims.height}`);
  console.log(`  ✓ Imagem ${imgName}: Exatamente ${dims.width}x${dims.height} px (Proporção 4:3)`);
});

console.log('\n=== TODOS OS TESTES PASSARAM COM 100% DE SUCESSO! ===');
