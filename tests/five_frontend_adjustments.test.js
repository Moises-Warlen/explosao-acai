import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('Validação dos 5 Ajustes Visuais e Funcionais de Front-end', async (t) => {
  const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
  const adminCss = fs.readFileSync('public/css/admin.css', 'utf8');
  const adminJs = fs.readFileSync('public/js/admin.js', 'utf8');
  const styleCss = fs.readFileSync('public/css/style.css', 'utf8');
  const indexHtml = fs.readFileSync('public/index.html', 'utf8');

  await t.test('1. Menu de Opções / Categorias no Tema Escuro (Imagem 1)', () => {
    // Regras exclusivas para tema escuro
    assert.ok(
      styleCss.includes(':root[data-theme="dark"] .categories-drawer-item') ||
      styleCss.includes('.categories-drawer-item {\n    background: #2b0f47;') ||
      styleCss.includes('.categories-drawer-item {\r\n    background: #2b0f47;'),
      'Deve conter fundo escuro para itens da gaveta de categorias no tema dark'
    );
    assert.ok(
      styleCss.includes(':root[data-theme="dark"] .categories-drawer-card') ||
      styleCss.includes('.categories-drawer-card {\n    background: #1e0933;') ||
      styleCss.includes('.categories-drawer-card {\r\n    background: #1e0933;'),
      'Deve conter fundo escuro para o card modal de categorias no tema dark'
    );
    assert.ok(
      styleCss.includes(':root[data-theme="dark"] .app-modal-card'),
      'Deve conter regra dark para .app-modal-card'
    );

    // O tema claro padrão deve continuar usando #faf5ff
    assert.ok(
      styleCss.includes('.categories-drawer-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 12px 16px;\n  background: #faf5ff;') ||
      styleCss.includes('background: #faf5ff;'),
      'Tema claro padrão deve permanecer intacto com #faf5ff'
    );
  });

  await t.test('2. Tela de Cupons no Painel Gestor — Mobile/Responsivo (Imagem 2 -> Imagem 3)', () => {
    // Cabeçalho da seção
    assert.ok(adminHtml.includes('Cupons de Desconto & Compartilhamento'), 'Deve ter o título no HTML');
    assert.ok(adminHtml.includes('Gere cupons e copie a mensagem formatada'), 'Deve ter o subtítulo explicativo');
    assert.ok(adminHtml.includes('+ Criar Novo Cupom'), 'Deve ter o botão verde de criar novo cupom');

    // Estrutura de container mobile e desktop
    assert.ok(adminHtml.includes('coupons-desktop-table'), 'Deve ter container de tabela desktop');
    assert.ok(adminHtml.includes('id="coupons-cards-list"'), 'Deve ter container de cards mobile');

    // Renderização JS dos cards mobile
    assert.ok(adminJs.includes('coupon-mobile-card'), 'Deve renderizar cards individuais mobile no JS');
    assert.ok(adminJs.includes('coupon-card-code'), 'Deve exibir código do cupom');
    assert.ok(adminJs.includes('coupon-card-badge'), 'Deve exibir badge de status');
    assert.ok(adminJs.includes('coupon-detail-col'), 'Deve exibir colunas de detalhes (desconto, mín, usos)');
    assert.ok(adminJs.includes('btn-coupon-chat'), 'Deve conter botão Enviar no Chat');
    assert.ok(adminJs.includes('btn-coupon-copy'), 'Deve conter botão Copiar Texto');
    assert.ok(adminJs.includes('btn-coupon-delete'), 'Deve conter botão Excluir');

    // Regras CSS responsivas
    assert.ok(adminCss.includes('.coupons-mobile-cards-wrap {\n  display: none;') ||
      adminCss.includes('.coupons-mobile-cards-wrap {\r\n  display: none;'), 'Cards mobile ocultos no desktop');
    assert.ok(adminCss.includes('.coupons-desktop-table {\n    display: none !important;') ||
      adminCss.includes('.coupons-desktop-table {\r\n    display: none !important;'), 'Tabela oculta no mobile');
  });

  await t.test('3. Paginação nas Colunas de Pedidos (Máximo 5 pedidos por página) (Imagem 4)', () => {
    // Limite máximo de 5 por página
    assert.ok(adminJs.includes('const KANBAN_PER_PAGE = 5;'), 'KANBAN_PER_PAGE deve ser exatamente 5');
    assert.ok(adminJs.includes('effectivePerPage = KANBAN_PER_PAGE;'), 'effectivePerPage deve utilizar o limite 5');

    // Todas as 7 colunas possuem container de paginação
    const columns = ['received', 'preparing', 'ready', 'delivered', 'history', 'returned', 'cancelled'];
    columns.forEach(col => {
      assert.ok(
        adminHtml.includes(`id="cards-${col}-pagination"`),
        `Coluna ${col} deve possuir container de paginação`
      );
    });
  });

  await t.test('4. Layout de Adicionais e Frutas Compactado no Desktop (Imagem 5 -> Imagem 6)', () => {
    // HTML / JS estruturado com .fruit-card-header-row
    assert.ok(adminJs.includes('fruit-card-header-row'), 'Cards de adicionais e frutas devem ter linha de cabeçalho');

    // No CSS desktop (min-width: 861px): linha superior com ações à direita e linha inferior com preços em 1 linha
    assert.ok(adminCss.includes('@media (min-width: 861px)'), 'Deve conter media query para desktop');
    assert.ok(
      adminCss.includes('.fruit-card-pricing-block {\n    display: flex !important;\n    flex-direction: row !important;') ||
      adminCss.includes('.fruit-card-pricing-block {\r\n    display: flex !important;\r\n    flex-direction: row !important;'),
      'Bloco de preços deve ser uma linha horizontal única no desktop'
    );

    // No CSS mobile (max-width: 860px): layout preservado com 3 botões na base
    assert.ok(
      adminCss.includes('.fruit-card-actions {\n    order: 3 !important;') ||
      adminCss.includes('.fruit-card-actions {\r\n    order: 3 !important;'),
      'Ações devem ficar na base no mobile'
    );
  });

  await t.test('5. Scroll Horizontal e Zoom no Modal de Produto — Mobile (Imagem 7)', () => {
    // No .sheet deve ter overflow-x: hidden e max-width: 100vw
    assert.ok(styleCss.includes('overflow-x: hidden !important;'), '.sheet deve ter overflow-x: hidden');
    assert.ok(styleCss.includes('max-width: 100vw;'), '.sheet deve ter max-width: 100vw');

    // Font-size 16px no mobile para inputs e textarea
    assert.ok(styleCss.includes('font-size: 16px;'), 'Inputs/textarea devem ter 16px para evitar auto-zoom mobile');

    // Viewport meta tag correta
    assert.ok(indexHtml.includes('width=device-width'), 'Viewport deve ter width=device-width');
    assert.ok(indexHtml.includes('user-scalable=no') || indexHtml.includes('initial-scale=1'), 'Viewport configurada');
  });
});
