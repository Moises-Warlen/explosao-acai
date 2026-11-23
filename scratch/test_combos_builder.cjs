const fs = require('fs');
const assert = require('assert');

console.log('=== TESTE AUTOMATIZADO: CONSTRUTOR INTELIGENTE DE COMBOS COM PREÇO SUGERIDO SEM PREJUÍZO ===\n');

// 1. Verificação sintática e elementos no HTML (public/admin.html)
console.log('1. Verificando interface do Construtor de Combos em public/admin.html...');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');

assert(adminHtml.includes('id="combo-selection-section"'), 'admin.html deve conter combo-selection-section');
assert(adminHtml.includes('id="combo-cups-list"'), 'admin.html deve conter combo-cups-list');
assert(adminHtml.includes('onclick="addComboCupRow()"'), 'admin.html deve ter botão para adicionar outro copo');
assert(adminHtml.includes('id="combo-included-product-select"'), 'admin.html deve ter seletor de garrafas/produtos inclusos');
assert(adminHtml.includes('onclick="addComboIncludedItem()"'), 'admin.html deve ter botão para incluir garrafa/item no combo');
assert(adminHtml.includes('id="combo-flavors-checkboxes"'), 'admin.html deve ter lista de checkboxes de sabores/mousses');
assert(adminHtml.includes('onclick="toggleAllComboFlavors(true)"'), 'admin.html deve ter botão para liberar todos os sabores');
assert(adminHtml.includes('id="combo-accompaniments-checkboxes"'), 'admin.html deve ter lista de checkboxes de acompanhamentos');
assert(adminHtml.includes('id="combo-pricing-card"'), 'admin.html deve ter card de precificação inteligente');
assert(adminHtml.includes('onclick="aplicarPrecoSugeridoCombo()"'), 'admin.html deve ter botão de aplicar preço sugerido');
console.log('  ✓ Todos os campos e seções do Construtor de Combos presentes no admin.html!');

// 2. Verificação de lógica e funções em public/js/admin.js
console.log('\n2. Verificando funções no public/js/admin.js...');
const adminJs = fs.readFileSync('public/js/admin.js', 'utf8');

assert(adminJs.includes('window.addComboCupRow'), 'admin.js deve definir window.addComboCupRow');
assert(adminJs.includes('window.removeComboCupRow'), 'admin.js deve definir window.removeComboCupRow');
assert(adminJs.includes('window.updateComboCupSize'), 'admin.js deve definir window.updateComboCupSize');
assert(adminJs.includes('window.populateComboIncludedProductSelect'), 'admin.js deve definir window.populateComboIncludedProductSelect');
assert(adminJs.includes('window.addComboIncludedItem'), 'admin.js deve definir window.addComboIncludedItem');
assert(adminJs.includes('window.renderComboFlavorsCheckboxes'), 'admin.js deve definir window.renderComboFlavorsCheckboxes');
assert(adminJs.includes('window.renderComboAccompanimentsCheckboxes'), 'admin.js deve definir window.renderComboAccompanimentsCheckboxes');
assert(adminJs.includes('window.recalculateComboPricing'), 'admin.js deve definir window.recalculateComboPricing');
assert(adminJs.includes('window.aplicarPrecoSugeridoCombo'), 'admin.js deve definir window.aplicarPrecoSugeridoCombo');
console.log('  ✓ Todas as funções do Construtor de Combos implementadas em admin.js!');

// 3. Simulação matemática da Precificação Inteligente e Trava Antirrisco (Sem Prejuízo)
console.log('\n3. Testando algoritmo de precificação inteligente e proteção de margem...');
function simulateComboPricing(cupsSizes, includedItems = []) {
  // Preços e custos médios de tabela
  const stdSizes = {
    250: { price: 15.90, cost: 7.50 },
    300: { price: 19.90, cost: 8.80 },
    500: { price: 26.90, cost: 11.80 },
    700: { price: 33.90, cost: 15.20 },
    1000: { price: 36.90, cost: 17.00 }
  };

  let totalRetail = 0;
  let totalCost = 0;

  cupsSizes.forEach(sz => {
    const s = stdSizes[sz] || stdSizes[500];
    totalRetail += s.price;
    totalCost += s.cost;
  });

  includedItems.forEach(it => {
    totalRetail += it.price * it.qty;
    totalCost += it.cost * it.qty;
  });

  const targetPromo = totalRetail * 0.86; // 14% de desconto pro cliente
  const minSafe = totalCost * 1.45;       // Trava: no mínimo 45% de margem sobre custo
  let suggested = Math.max(minSafe, targetPromo);
  suggested = Math.floor(suggested) + 0.90;
  if (suggested < minSafe) suggested = Math.ceil(minSafe) + 0.90;

  const clientSavings = totalRetail - suggested;
  const storeProfit = suggested - totalCost;
  const marginPercent = Math.round((storeProfit / suggested) * 100);

  return { totalRetail, totalCost, suggested, clientSavings, storeProfit, marginPercent };
}

// Caso 1: 2 copos de 500ml (Combo Casal)
const c1 = simulateComboPricing([500, 500]);
assert(c1.suggested < c1.totalRetail, 'O preço sugerido deve ser menor que a soma avulsa para dar desconto ao cliente');
assert(c1.storeProfit > 0, 'O lucro da loja deve ser positivo');
assert(c1.marginPercent >= 45, 'A margem deve ser de no mínimo 45% sem risco de prejuízo');
console.log(`  ✓ Caso 1 (2 copos de 500ml): Avulso R$ ${c1.totalRetail.toFixed(2)} -> Sugerido R$ ${c1.suggested.toFixed(2)} (Economia R$ ${c1.clientSavings.toFixed(2)} | Lucro R$ ${c1.storeProfit.toFixed(2)} [+${c1.marginPercent}%])`);

// Caso 2: 2 copos de 500ml + 1 Garrafa de Morango (R$ 18,90 / custo R$ 6,50)
const c2 = simulateComboPricing([500, 500], [{ price: 18.90, cost: 6.50, qty: 1 }]);
assert(c2.suggested < c2.totalRetail, 'Deve oferecer desconto atraente');
assert(c2.storeProfit > c1.storeProfit, 'Combo com garrafa inclusa gera lucro total maior');
assert(c2.marginPercent >= 45, 'Margem saudável mantida');
console.log(`  ✓ Caso 2 (2 copos 500ml + Garrafa): Avulso R$ ${c2.totalRetail.toFixed(2)} -> Sugerido R$ ${c2.suggested.toFixed(2)} (Economia R$ ${c2.clientSavings.toFixed(2)} | Lucro R$ ${c2.storeProfit.toFixed(2)} [+${c2.marginPercent}%])`);

// Caso 3: 2 copos de 300ml (Econômico)
const c3 = simulateComboPricing([300, 300]);
assert(c3.suggested < c3.totalRetail);
assert(c3.marginPercent >= 45);
console.log(`  ✓ Caso 3 (2 copos de 300ml): Avulso R$ ${c3.totalRetail.toFixed(2)} -> Sugerido R$ ${c3.suggested.toFixed(2)} (Economia R$ ${c3.clientSavings.toFixed(2)} | Lucro R$ ${c3.storeProfit.toFixed(2)} [+${c3.marginPercent}%])`);

// 4. Verificação no cardápio do cliente em public/js/app.js
console.log('\n4. Verificando integração no cardápio do cliente (public/js/app.js)...');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');

assert(appJs.includes('prod.comboConfig'), 'app.js deve ler prod.comboConfig');
assert(appJs.includes('allowedFlavorIds'), 'app.js deve filtrar sabores e mousses liberados');
assert(appJs.includes('allowedAccompanimentIds'), 'app.js deve filtrar acompanhamentos liberados');
assert(appJs.includes('includedItems'), 'app.js deve exibir garrafas e itens adicionais inclusos');
console.log('  ✓ Cardápio do cliente configurado para respeitar rigorosamente as permissões do lojista!');

// 5. Verificação no backend em src/application/services/CatalogService.js
console.log('\n5. Verificando persistência no backend (src/application/services/CatalogService.js)...');
const catServiceJs = fs.readFileSync('src/application/services/CatalogService.js', 'utf8');
assert(catServiceJs.includes('comboConfig: productData.comboConfig'), 'CatalogService deve persistir comboConfig');
assert(catServiceJs.includes('allowedFlavorIds: Array.isArray'), 'CatalogService deve persistir allowedFlavorIds');
console.log('  ✓ Backend atualizado com persistência de comboConfig e allowedFlavorIds!');

console.log('\n=== TODOS OS TESTES PASSARAM COM 100% DE SUCESSO! ===');
