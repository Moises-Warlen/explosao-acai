import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('Validação de Ajustes Mobile Cardápio & Estoque e Tela do Motoboy', async (t) => {
  const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
  const adminCss = fs.readFileSync('public/css/admin.css', 'utf8');
  const adminJs = fs.readFileSync('public/js/admin.js', 'utf8');
  const motoboyHtml = fs.readFileSync('public/motoboy.html', 'utf8');

  await t.test('1. Motoboy HTML: Não deve conter botão nem link para Google Maps / GPS', () => {
    assert.strictEqual(motoboyHtml.includes('btn-maps'), false, 'Não deve conter #btn-maps');
    assert.strictEqual(motoboyHtml.includes('📍 Google Maps'), false, 'Não deve conter texto 📍 Google Maps');
    assert.strictEqual(motoboyHtml.includes('maps.google.com'), false, 'Não deve conter link de maps.google.com');
  });

  await t.test('2. Admin HTML: Deve possuir containers separados para Desktop e Mobile no Cardápio', () => {
    assert.ok(adminHtml.includes('prod-header-desktop'), 'Deve conter .prod-header-desktop');
    assert.ok(adminHtml.includes('prod-header-mobile'), 'Deve conter .prod-header-mobile');
    assert.ok(adminHtml.includes('products-cards-mobile-view'), 'Deve conter #products-cards-mobile-view');
    assert.ok(adminHtml.includes('products-pagination-mobile'), 'Deve conter #products-pagination-mobile');
    assert.ok(adminHtml.includes('prod-bestsellers-box'), 'Deve conter .prod-bestsellers-box');
  });

  await t.test('3. Admin CSS: Regras de visibilidade mobile e desktop', () => {
    // Desktop esconde elementos exclusivos de mobile
    assert.ok(adminCss.includes('.prod-header-mobile'), 'CSS deve referenciar .prod-header-mobile');
    assert.ok(adminCss.includes('#products-cards-mobile-view'), 'CSS deve referenciar #products-cards-mobile-view');
    assert.ok(adminCss.includes('#products-pagination-mobile'), 'CSS deve referenciar #products-pagination-mobile');

    // Mobile esconde subnav pills e seletor tabela/cards
    assert.ok(adminCss.includes('#tab-products .catalog-subnav-bar'), 'Deve esconder .catalog-subnav-bar no mobile');
    assert.ok(adminCss.includes('#tab-products .prod-view-switcher'), 'Deve esconder .prod-view-switcher no mobile');
  });

  await t.test('4. Admin JS: Renderiza cards móveis e paginação de 4 itens no mobile', () => {
    assert.ok(adminJs.includes('products-cards-mobile-view'), 'admin.js deve renderizar em #products-cards-mobile-view');
    assert.ok(adminJs.includes('products-pagination-mobile'), 'admin.js deve renderizar em #products-pagination-mobile');
    assert.ok(adminJs.includes('isMobile ? 4 :'), 'admin.js deve usar 4 itens por página no mobile');
    assert.ok(adminJs.includes('btn-card-bestseller'), 'admin.js deve incluir botão ★ Mais Vendido');
    assert.ok(adminJs.includes('btn-card-recipe'), 'admin.js deve incluir botão Receita & PDF');
    assert.ok(adminJs.includes('btn-card-edit'), 'admin.js deve incluir botão Editar');
    assert.ok(adminJs.includes('btn-card-delete'), 'admin.js deve incluir botão Excluir');
  });
});
