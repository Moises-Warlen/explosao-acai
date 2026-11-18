import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('Validação dos 4 Ajustes de UI/UX (Mobile e Cabeçalho Global)', async (t) => {
  const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
  const adminCss = fs.readFileSync('public/css/admin.css', 'utf8');
  const adminJs = fs.readFileSync('public/js/admin.js', 'utf8');

  await t.test('1. Remover barra de abas internas SOMENTE no Mobile', () => {
    // Deve conter regra global no mobile
    const mobileQueryMatch = adminCss.includes('.catalog-subnav-bar {\n    display: none !important;') ||
      adminCss.includes('.catalog-subnav-bar {\r\n    display: none !important;');
    assert.ok(mobileQueryMatch, 'catalog-subnav-bar deve ser ocultada no mobile em todas as telas');

    // No desktop deve continuar visível (display: flex)
    assert.ok(adminCss.includes('.catalog-subnav-bar {\n  display: flex;') ||
      adminCss.includes('.catalog-subnav-bar {\r\n  display: flex;'), 'No desktop deve manter display: flex');
  });

  await t.test('2. Ajustar o layout da tela Gestão de Adicionais & Extras', () => {
    // Cabeçalho alinhado com o botão + Novo Adicional na mesma linha do título
    assert.ok(adminHtml.includes('Gestão de Adicionais & Extras'), 'Deve conter título Gestão de Adicionais & Extras');
    assert.ok(adminHtml.includes('extras-header-block'), 'Deve conter bloco extras-header-block');

    // Cards sem avatar quadrado
    assert.strictEqual(adminJs.includes('extra-card-avatar'), false, 'Não deve conter o avatar quadrado extra-card-avatar');

    // Ordem horizontal inferior: [ • Ativo ] [ Editar ] [ Excluir ]
    assert.ok(adminJs.includes('toggleExtraActive'), 'Deve possuir toggleExtraActive para o botão de status');
    assert.ok(adminJs.includes('fruit-card-actions extra-card-actions'), 'Deve usar estrutura de ações com 3 botões');
  });

  await t.test('3. Adicionar ícone de morango no menu lateral/mobile em Frutas', () => {
    assert.ok(
      adminHtml.includes('<span class="mobile-nav-icon">🍓</span> Frutas</span>'),
      'O item Frutas no menu drawer mobile deve conter 🍓'
    );
  });

  await t.test('4. Padronizar barra de ícones do Cabeçalho (Topo): Sino -> Loja -> Rotas -> Chat', () => {
    // No HTML da linha 3 do cabeçalho
    const row3Idx = adminHtml.indexOf('class="header-actions-row3"');
    assert.ok(row3Idx !== -1, 'header-actions-row3 deve existir');
    const row3EndIdx = adminHtml.indexOf('<!-- Busca Rápida', row3Idx);
    const row3Html = adminHtml.substring(row3Idx, row3EndIdx !== -1 ? row3EndIdx : row3Idx + 3000);

    const bellIdx = row3Html.indexOf('btn-sound-toggle');
    const storeIdx = row3Html.indexOf('store-status-glow-btn');
    const routesIdx = row3Html.indexOf('btn-routes-mobile');
    const chatIdx = row3Html.indexOf('btn-notifications-drawer-toggle');

    assert.ok(bellIdx !== -1, 'Sino deve existir em header-actions-row3');
    assert.ok(storeIdx !== -1, 'Loja deve existir em header-actions-row3');
    assert.ok(routesIdx !== -1, 'Rotas deve existir em header-actions-row3');
    assert.ok(chatIdx !== -1, 'Chat deve existir em header-actions-row3');

    assert.ok(bellIdx < storeIdx, 'Sino deve vir antes da Loja no HTML');
    assert.ok(storeIdx < routesIdx, 'Loja deve vir antes de Rotas no HTML');
    assert.ok(routesIdx < chatIdx, 'Rotas deve vir antes do Chat no HTML');

    // No CSS da linha 3 mobile
    assert.ok(adminCss.includes('#btn-sound-toggle.bell-alert-btn {\n    order: 1 !important;') ||
      adminCss.includes('#btn-sound-toggle.bell-alert-btn {\r\n    order: 1 !important;'), 'Sino deve ter order: 1');
    assert.ok(adminCss.includes('.store-glow-pill {\n    order: 2 !important;') ||
      adminCss.includes('.store-glow-pill {\r\n    order: 2 !important;'), 'Loja deve ter order: 2');
    assert.ok(adminCss.includes('.btn-routes-mobile {\n    order: 3 !important;') ||
      adminCss.includes('.btn-routes-mobile {\r\n    order: 3 !important;'), 'Rotas deve ter order: 3');
    assert.ok(adminCss.includes('.notif-center-btn {\n    order: 4 !important;\n    margin-left: auto !important;') ||
      adminCss.includes('.notif-center-btn {\r\n    order: 4 !important;\r\n    margin-left: auto !important;'), 'Chat deve ter order: 4 e margin-left: auto');
  });
});
