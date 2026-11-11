/* =========================================================================
   CARDÁPIO DIGITAL DO CLIENTE & DELIVERY PRÓPRIO — EXPLOSÃO AÇAÍ
   - Regras de Acompanhamentos Inclusos (300ml: 3, 500ml: 4, 700ml: 5 - configurável)
   - Exibição de todos os acompanhamentos originais e novos criados
   - Pagamento Online vs Pagamento na Entrega (Maquininha com Motoboy)
   - Dinheiro com troco e Pix dinâmico do Mercado Pago
   - Chat oficial identificado com a marca Explosão Açaí e Logo
   - Seções de Lançamentos, Novidades e Produtos em Promoção
   ========================================================================= */

const API_URL = '/api';
const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

let CATALOG = { categories: [], products: [], accompaniments: [], fruits: [], extras: [] };
let BEST_SELLERS = [];
let STORE_STATUS = { isOpen: true, message: '' };
let SETTINGS = {};
let CART = [];
let APPLIED_COUPON = null;
let CURRENT_ITEM_STATE = null;
let CHECKOUT_DATA = {
  ent: 'e', // 'e' = entrega, 'r' = retirada
  cid: 'Franca',
  uf: 'SP',
  pay: 'Pix',
  timing: 'online' // 'online' ou 'delivery'
};
let ACTIVE_ORDER = null;
let WS_SOCKET = null;

// Funções utilitárias
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const R = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t.timer);
  t.timer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// Inicialização da Aplicação
window.addEventListener('DOMContentLoaded', async () => {
  initWebSocket();
  await loadStoreStatus();
  await loadCatalog();
  await loadBestSellers();
  renderNavigation();
  renderCatalog();
  bindEvents();

  // Banner amarelo de Boas-Vindas e Desconto: fecha sozinho após 3 segundos
  setTimeout(() => {
    const promoEl = document.getElementById('promo');
    if (promoEl && !promoEl.classList.contains('off')) {
      promoEl.classList.add('off');
    }
  }, 3000);
});

// Conexão WebSocket em Tempo Real
function registerCustomerWs() {
  if (WS_SOCKET && WS_SOCKET.readyState === WebSocket.OPEN) {
    try {
      const client = typeof getClientChatData === 'function' ? getClientChatData() : null;
      const phone = client?.phone || '';
      const orderId = ACTIVE_ORDER?.id || '';
      if (phone || orderId) {
        WS_SOCKET.send(JSON.stringify({ type: 'REGISTER_CUSTOMER', phone, orderId }));
      }
    } catch (e) {}
  }
}

function initWebSocket() {
  try {
    WS_SOCKET = new WebSocket(WS_URL);
    WS_SOCKET.onopen = () => {
      registerCustomerWs();
    };
    WS_SOCKET.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'ORDER_STATUS_CHANGED' && ACTIVE_ORDER && data.payload.id === ACTIVE_ORDER.id) {
          ACTIVE_ORDER = data.payload;
          toast(`Status do pedido atualizado: ${formatStatus(ACTIVE_ORDER.status, ACTIVE_ORDER)}`);
          if (ACTIVE_ORDER.payment?.status === 'approved' && window._pixPollInterval) {
            clearInterval(window._pixPollInterval);
          }
          if ($('#sheet').classList.contains('on')) {
            renderOrderSuccess(ACTIVE_ORDER);
          }
        }
        if (data.event === 'CHAT_MESSAGE') {
          handleIncomingChatMessage(data.payload);
        }
        if (data.event === 'CHAT_CLOSED') {
          handleChatClosed(data.payload);
        }
        if (data.event === 'CATALOG_UPDATED') {
          await loadCatalog();
          await loadBestSellers();
          renderNavigation();
          renderCatalog();
        }
      } catch (e) {}
    };
    WS_SOCKET.onclose = () => {
      setTimeout(initWebSocket, 4000);
    };
  } catch (err) {
    console.warn('WS indisponível, operando via HTTP REST.');
  }
}

// Carregar Status da Loja e Configurações
async function loadStoreStatus() {
  try {
    const res = await fetch(`${API_URL}/store/status`);
    const data = await res.json();
    if (data.ok) {
      STORE_STATUS = data;
      renderStoreStatus();
    }
    const setRes = await fetch(`${API_URL}/store/settings`);
    const setData = await setRes.json();
    if (setData.ok) {
      SETTINGS = setData.settings;
      if (SETTINGS.bannerPromo) {
        const pr = $('#promo-text');
        if (pr) pr.textContent = SETTINGS.bannerPromo;
      }
    }
  } catch (err) {
    console.error('Erro ao buscar status da loja:', err);
  }
}

function renderStoreStatus() {
  const pill = $('#store-status-pill');
  if (!pill) return;
  if (STORE_STATUS.isOpen) {
    pill.className = 'store-pill open';
    pill.textContent = 'Loja Aberta';
  } else {
    pill.className = 'store-pill closed';
    pill.textContent = 'Loja Fechada';
  }
}

// Carregar Catálogo e Categorias
async function loadCatalog() {
  try {
    const res = await fetch(`${API_URL}/catalog`);
    const data = await res.json();
    if (data.ok) {
      CATALOG = data;
    }
  } catch (err) {
    console.error('Erro ao carregar catálogo:', err);
  }
}

// Carregar Mais Vendidos (Exibe SOMENTE os itens adicionados manualmente no painel)
async function loadBestSellers() {
  try {
    const res = await fetch(`${API_URL}/catalog/best-sellers`);
    const data = await res.json();
    if (data.ok && Array.isArray(data.products) && data.products.length > 0) {
      BEST_SELLERS = data.products;
    } else {
      BEST_SELLERS = [];
    }
  } catch (e) {
    BEST_SELLERS = [];
  }
}

// Renderiza Menu de Categorias Dinâmico
function renderNavigation() {
  const nav = $('#category-nav') || $('.cats');
  if (!nav) return;

  const launches = (CATALOG.products || []).filter(p => p.isNewLaunch && p.active);
  const promos = (CATALOG.products || []).filter(p => p.isPromo && p.active);

  let h = '';
  if (BEST_SELLERS.length > 0) {
    h += `<a href="#mais-vendidos" class="cat-pill active">Mais Vendidos</a>`;
  }
  if (launches.length > 0) {
    h += `<a href="#lancamentos" class="cat-pill ${!BEST_SELLERS.length ? 'active' : ''}">Novidades</a>`;
  }
  if (promos.length > 0) {
    h += `<a href="#promocoes" class="cat-pill ${!BEST_SELLERS.length && !launches.length ? 'active' : ''}">Promoções</a>`;
  }

  (CATALOG.categories || []).forEach((cat, idx) => {
    if (cat.active && cat.slug !== 'lancamentos' && cat.slug !== 'promocoes') {
      const isFirst = !BEST_SELLERS.length && !launches.length && !promos.length && idx === 0;
      h += `<a href="#${cat.slug}" class="cat-pill ${isFirst ? 'active' : ''}">${esc(cat.name)}</a>`;
    }
  });

  nav.innerHTML = h;
}

// Renderizar Produtos no Cardápio
function renderCatalog() {
  const main = $('#main');
  if (!main) return;

  let html = '';

  // 0. SEÇÃO MAIS VENDIDOS (Apenas itens cadastrados manualmente pelo administrador)
  if (BEST_SELLERS.length > 0) {
    html += `<section id="mais-vendidos"><h2>Mais Vendidos</h2><div class="grid">`;
    BEST_SELLERS.forEach(p => {
      html += renderProductCard(p);
    });
    html += `</div></section>`;
  }

  // 1. SEÇÃO LANÇAMENTOS / NOVIDADES
  const launches = (CATALOG.products || []).filter(p => p.isNewLaunch && p.active);
  if (launches.length > 0) {
    html += `<section id="lancamentos"><h2>Novidades & Lançamentos</h2><div class="grid">`;
    launches.forEach(p => {
      html += renderProductCard(p);
    });
    html += `</div></section>`;
  }

  // 2. SEÇÃO PROMOÇÕES
  const promos = (CATALOG.products || []).filter(p => p.isPromo && p.active);
  if (promos.length > 0) {
    html += `<section id="promocoes"><h2>Produtos em Promoção</h2><div class="grid">`;
    promos.forEach(p => {
      html += renderProductCard(p);
    });
    html += `</div></section>`;
  }

  // 3. SEÇÕES POR CATEGORIA PADRÃO (Apenas produtos cadastrados manualmente)
  const categories = CATALOG.categories || [];
  categories.forEach(cat => {
    if (!cat.active || cat.slug === 'lancamentos' || cat.slug === 'promocoes') return;

    const prods = (CATALOG.products || []).filter(p => 
      (p.categoryId === cat.id || p.categorySlug === cat.slug || p.category === cat.slug) && p.active
    );

    if (prods.length > 0) {
      html += `<section id="${cat.slug}"><h2>${esc(cat.name)}</h2><div class="grid">`;
      prods.forEach(p => {
        html += renderProductCard(p);
      });
      html += `</div></section>`;
    }
  });

  main.innerHTML = html;
}

function renderProductCard(prod) {
  const firstPriceObj = prod.prices && prod.prices.length > 0 ? prod.prices[0] : null;
  const price = firstPriceObj ? firstPriceObj.price : 0;
  const promoPrice = firstPriceObj?.promoPrice;
  const isPromo = prod.isPromo || (promoPrice != null && promoPrice < price);
  const minPrice = promoPrice != null ? promoPrice : price;
  const isCustom = prod.isCustomizable || prod.categorySlug === 'monte';
  const btnLabel = isCustom ? 'Escolher' : '+ Pedir';
  const imgUrl = prod.image || 'imagens/do seu jeitinho.png';

  let badgeHtml = '';
  if (prod.isNewLaunch) {
    badgeHtml = `<span class="badge-launch">Lançamento</span>`;
  } else if (isPromo) {
    badgeHtml = `<span class="badge-discount">Promoção</span>`;
  }

  let priceHtml = `<b>a partir de ${R(minPrice)}</b>`;
  if (isPromo && promoPrice != null && promoPrice < price) {
    priceHtml = `<div><span class="price-old">${R(price)}</span><b class="price-promo">${R(promoPrice)}</b></div>`;
  }

  return `
    <div class="card ${prod.isNewLaunch ? 'card-launch' : ''}" data-id="${prod.id}">
      <div class="ic has">
        ${badgeHtml}
        <img src="${encodeURI(imgUrl)}" alt="${esc(prod.name)}" loading="lazy" onerror="this.src='imagens/do seu jeitinho.png'">
      </div>
      <h3>${esc(prod.name)}</h3>
      <p>${esc(prod.description)}</p>
      <div class="ft">
        ${priceHtml}
        <button class="mini" onclick="openItemModal('${prod.id}')">${btnLabel}</button>
      </div>
    </div>
  `;
}

// Modal de Seleção de Item (Personalização)
window.openItemModal = function(productId) {
  const prod = (CATALOG.products || []).find(p => p.id === productId);
  if (!prod) return;

  CURRENT_ITEM_STATE = {
    product: prod,
    selectedSizeIdx: 0,
    accompaniments: [],
    extras: [],
    fruits: [],
    note: '',
    quantity: 1
  };

  renderItemModal();
  showSheet();
};

function renderItemModal() {
  const st = CURRENT_ITEM_STATE;
  const prod = st.product;
  const sheet = $('#sheet');

  const selectedSizeObj = prod.prices[st.selectedSizeIdx] || prod.prices[0];
  const basePrice = selectedSizeObj?.promoPrice != null ? selectedSizeObj.promoPrice : (selectedSizeObj?.price || 0);
  const sizeMl = selectedSizeObj?.size || 500;
  const isMonteSeuAcai = prod.id === 'prod_monte' || prod.categorySlug === 'monte' || prod.name.toLowerCase().includes('monte seu');

  // Limite de acompanhamentos inclusos por tamanho
  let maxAcomp = selectedSizeObj?.maxAccompaniments;
  if (maxAcomp === undefined || maxAcomp === null) {
    if (sizeMl === 300) maxAcomp = 3;
    else if (sizeMl === 500) maxAcomp = 4;
    else if (sizeMl === 700) maxAcomp = 5;
    else maxAcomp = 3;
  }

  // Identifica produtos com regras especiais de adicionais extras
  const isPolpa = prod.id === 'polpa_1l' || prod.id === 'polpa_2l' || prod.categorySlug === 'polpa' || (prod.name && prod.name.toLowerCase().includes('pura polpa'));
  const isComboKids = prod.id === 'combo_kids';

  // Filtra adicionais permitidos para este produto (açaí vs combo)
  const isCombo = prod.categorySlug === 'combos' || prod.category === 'combos';
  let availableExtras = (CATALOG.extras || []).filter(e => {
    if (!e.active) return false;
    return isCombo ? e.allowInCombos : e.allowInAcai;
  });

  // REGRA ESPECÍFICA: Remover completamente adicionais extras de Pura Polpa (1L e 2L) e Combo Kids
  if (isPolpa || isComboKids) {
    availableExtras = [];
    st.extras = [];
    st.fruits = [];
  }

  // Acompanhamentos disponíveis: todos os acompanhamentos ativos cadastrados no catálogo
  let availableAccompaniments = (CATALOG.accompaniments || []).filter(ac => {
    if (typeof ac === 'string') return true;
    if (ac.active === false) return false;
    // Se o produto tiver lista específica de acompanhamentos permitidos configurada no painel, respeita:
    if (Array.isArray(prod.allowedAccompanimentIds)) {
      return prod.allowedAccompanimentIds.includes(ac.id);
    }
    return true;
  });

  // Copos prontos com acompanhamentos escolhidos no painel também exibem a seleção ao cliente
  const hasPanelAccompaniments = Array.isArray(prod.allowedAccompanimentIds)
    && prod.allowedAccompanimentIds.length > 0
    && !isCombo
    && !isPolpa;

  // Calcula adicionais selecionados com cobrança imediata por fruta
  let extrasTotal = 0;
  st.extras.forEach(extId => {
    const ext = availableExtras.find(e => e.id === extId);
    if (ext) {
      if (ext.isFruitExtra) {
        // Cobrança de cada fruta adicionada (1 fruta = R$ 3,90, 2 frutas = R$ 7,80, etc.)
        extrasTotal += ext.price * st.fruits.length;
      } else {
        extrasTotal += ext.price;
      }
    }
  });

  const unitTotal = basePrice + extrasTotal;
  const finalTotal = unitTotal * st.quantity;

  const hasFruitExtra = st.extras.some(extId => {
    const e = availableExtras.find(x => x.id === extId);
    return e && e.isFruitExtra;
  });

  let h = `
    <button class="x" onclick="closeSheet()">×</button>
    <button class="btn o" onclick="closeSheet()" style="position:absolute;top:14px;left:14px;padding:5px 12px;font-size:12px;font-weight:700;display:flex;align-items:center;cursor:pointer;z-index:10;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.25);color:#fff;border-radius:20px">
      Voltar para o cardápio
    </button>
    <div class="sheet-photo-wrap">
      <img src="${prod.image || 'imagens/do seu jeitinho.png'}" alt="${esc(prod.name)}" onerror="this.src='imagens/do seu jeitinho.png'">
    </div>
    <h3>${esc(prod.name)}</h3>
    <p class="mut" style="margin-top:2px;font-size:13px">${esc(prod.description)}</p>

    <h4>Escolha o Tamanho</h4>
    <div class="chips">
      ${prod.prices.map((p, idx) => {
        const pr = p.promoPrice != null ? p.promoPrice : p.price;
        return `
          <div class="chip ${st.selectedSizeIdx === idx ? 'on' : ''}" onclick="selectSize(${idx})">
            ${p.size} ml · ${R(pr)}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Acompanhamentos inclusos (se customizável ou monte seu açaí)
  if (prod.isCustomizable || isMonteSeuAcai || hasPanelAccompaniments) {
    h += `
      <h4>Acompanhamentos Inclusos <small style="color:var(--mut);font-weight:normal">(${st.accompaniments.length} de ${maxAcomp} inclusos no valor)</small></h4>
      <div class="chips">
        ${availableAccompaniments.map(ac => {
          const acName = typeof ac === 'string' ? ac : ac.name;
          const selected = st.accompaniments.includes(acName);
          return `<div class="chip ${selected ? 'on' : ''}" onclick="toggleAccompaniment('${esc(acName)}')">${esc(acName)}</div>`;
        }).join('')}
      </div>
    `;
  }

  // Extras (Removidos de Pura Polpa e Combo Kids)
  if (availableExtras.length > 0) {
    h += `
      <h4>Adicionais Extras <small style="color:var(--mut);font-weight:normal">(opcionais)</small></h4>
      <div>
        ${availableExtras.map(ext => {
          const selected = st.extras.includes(ext.id);
          const isFruit = ext.isFruitExtra;
          const priceLabel = isFruit
            ? (st.fruits.length > 0 ? `+ ${R(ext.price * st.fruits.length)} (${st.fruits.length} fruta${st.fruits.length > 1 ? 's' : ''})` : `+ ${R(ext.price)} / fruta`)
            : `+ ${R(ext.price)}`;
          return `
            <div class="row ${selected ? 'on' : ''}" onclick="toggleExtra('${ext.id}')">
              <span>${esc(ext.name)}</span>
              <b>${priceLabel}</b>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Frutas selecionáveis se marcou fruta extra (Cálculo e valor acumulado imediato)
  if (hasFruitExtra) {
    const fruitCostUnit = 3.90;
    const fruitsCostTotal = fruitCostUnit * st.fruits.length;
    h += `
      <div class="frbox">
        <p>Frutas Adicionais <small style="color:var(--y);font-weight:700">(${st.fruits.length} fruta${st.fruits.length === 1 ? '' : 's'} selecionada${st.fruits.length === 1 ? '' : 's'} · ${R(fruitsCostTotal)})</small></p>
        <div class="chips">
          ${CATALOG.fruits.map(fr => {
            const selected = st.fruits.includes(fr);
            return `<div class="chip ${selected ? 'on' : ''}" onclick="toggleFruit('${esc(fr)}')">${esc(fr)} (+${R(fruitCostUnit)})</div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Observações e Quantidade
  h += `
    <h4>Observações para a Produção</h4>
    <textarea id="modal-obs" rows="2" placeholder="Ex: sem granola, enviar colher e guardanapo, etc." oninput="CURRENT_ITEM_STATE.note = this.value">${esc(st.note)}</textarea>

    <div class="qty">
      <button onclick="changeQuantity(-1)">−</button>
      <b>${st.quantity}</b>
      <button onclick="changeQuantity(1)">+</button>
    </div>

    <button class="btn" onclick="addItemToCart()">Adicionar · ${R(finalTotal)}</button>
    <button class="btn o" style="margin-top:8px" onclick="closeSheet()">Voltar para o cardápio</button>
  `;

  sheet.innerHTML = h;
}

window.selectSize = function(idx) {
  if (!CURRENT_ITEM_STATE) return;
  CURRENT_ITEM_STATE.selectedSizeIdx = idx;
  const prod = CURRENT_ITEM_STATE.product;
  const selectedSizeObj = prod.prices[idx] || prod.prices[0];
  const sizeMl = selectedSizeObj?.size || 500;
  const isMonte = prod.id === 'prod_monte' || prod.categorySlug === 'monte' || prod.name.toLowerCase().includes('monte seu');

  let maxAcomp = selectedSizeObj?.maxAccompaniments;
  if (maxAcomp === undefined || maxAcomp === null) {
    if (sizeMl === 300) maxAcomp = 3;
    else if (sizeMl === 500) maxAcomp = 4;
    else if (sizeMl === 700) maxAcomp = 5;
    else maxAcomp = 3;
  }

  // Ajusta caso o novo tamanho tenha limite menor que o selecionado
  if (CURRENT_ITEM_STATE.accompaniments.length > maxAcomp) {
    CURRENT_ITEM_STATE.accompaniments = CURRENT_ITEM_STATE.accompaniments.slice(0, maxAcomp);
    toast(`Tamanho de ${sizeMl}ml permite até ${maxAcomp} acompanhamentos inclusos.`);
  }

  renderItemModal();
};

window.toggleAccompaniment = function(name) {
  const st = CURRENT_ITEM_STATE;
  if (!st) return;

  const prod = st.product;
  const selectedSizeObj = prod.prices[st.selectedSizeIdx] || prod.prices[0];
  const sizeMl = selectedSizeObj?.size || 500;
  const isMonte = prod.id === 'prod_monte' || prod.categorySlug === 'monte' || prod.name.toLowerCase().includes('monte seu');

  let maxAcomp = selectedSizeObj?.maxAccompaniments;
  if (maxAcomp === undefined || maxAcomp === null) {
    if (sizeMl === 300) maxAcomp = 3;
    else if (sizeMl === 500) maxAcomp = 4;
    else if (sizeMl === 700) maxAcomp = 5;
    else maxAcomp = 3;
  }

  const idx = st.accompaniments.indexOf(name);
  if (idx !== -1) {
    st.accompaniments.splice(idx, 1);
  } else {
    if (st.accompaniments.length >= maxAcomp) {
      return toast(`No copo de ${sizeMl}ml você pode escolher até ${maxAcomp} acompanhamentos inclusos! Desmarque um para trocar.`);
    }
    st.accompaniments.push(name);
  }
  renderItemModal();
};

window.toggleExtra = function(extId) {
  const st = CURRENT_ITEM_STATE;
  if (!st) return;

  const idx = st.extras.indexOf(extId);
  if (idx !== -1) {
    st.extras.splice(idx, 1);
    const ext = (CATALOG.extras || []).find(e => e.id === extId);
    if (ext && ext.isFruitExtra) {
      st.fruits = [];
    }
  } else {
    st.extras.push(extId);
  }
  renderItemModal();
};

window.toggleFruit = function(fruitName) {
  const st = CURRENT_ITEM_STATE;
  if (!st) return;

  const idx = st.fruits.indexOf(fruitName);
  if (idx !== -1) {
    st.fruits.splice(idx, 1);
  } else {
    st.fruits.push(fruitName);
    const fruitExtra = (CATALOG.extras || []).find(e => e.isFruitExtra);
    if (fruitExtra && !st.extras.includes(fruitExtra.id)) {
      st.extras.push(fruitExtra.id);
    }
  }
  renderItemModal();
};

window.changeQuantity = function(delta) {
  if (!CURRENT_ITEM_STATE) return;
  CURRENT_ITEM_STATE.quantity = Math.max(1, CURRENT_ITEM_STATE.quantity + delta);
  renderItemModal();
};

window.addItemToCart = function() {
  const st = CURRENT_ITEM_STATE;
  if (!st) return;

  const prod = st.product;
  const selectedSizeObj = prod.prices[st.selectedSizeIdx] || prod.prices[0];
  const basePrice = selectedSizeObj?.promoPrice != null ? selectedSizeObj.promoPrice : (selectedSizeObj?.price || 0);
  const isCombo = prod.categorySlug === 'combos' || prod.category === 'combos';
  const isPolpa = prod.id === 'polpa_1l' || prod.id === 'polpa_2l' || prod.categorySlug === 'polpa' || (prod.name && prod.name.toLowerCase().includes('pura polpa'));
  const isComboKids = prod.id === 'combo_kids';

  let availableExtras = (CATALOG.extras || []).filter(e => isCombo ? e.allowInCombos : e.allowInAcai);
  if (isPolpa || isComboKids) {
    availableExtras = [];
    st.extras = [];
    st.fruits = [];
  }

  // Se selecionou fruta extra mas não marcou nenhuma fruta:
  const hasFruitExtra = st.extras.some(extId => {
    const e = availableExtras.find(x => x.id === extId);
    return e && e.isFruitExtra;
  });
  if (hasFruitExtra && st.fruits.length === 0) {
    return toast('Por favor, selecione qual fruta deseja adicionar no seu açaí ou desmarque a opção.');
  }

  let extrasTotal = 0;
  const extrasNames = [];
  st.extras.forEach(extId => {
    const ext = availableExtras.find(e => e.id === extId);
    if (ext) {
      if (ext.isFruitExtra) {
        const cost = ext.price * st.fruits.length;
        extrasTotal += cost;
        extrasNames.push(`Frutas: ${st.fruits.join(', ')} (+${R(cost)})`);
      } else {
        extrasTotal += ext.price;
        extrasNames.push(ext.name);
      }
    }
  });

  const unitPrice = basePrice + extrasTotal;
  const itemTitle = `${prod.name} ${selectedSizeObj.size} ml`;

  CART.push({
    productId: prod.id,
    name: itemTitle,
    size: selectedSizeObj.size,
    quantity: st.quantity,
    unitPrice,
    accompaniments: [...st.accompaniments],
    extras: extrasNames,
    fruits: [...st.fruits],
    note: st.note.trim()
  });

  toast(`${itemTitle} adicionado ao pedido!`);
  closeSheet();
  updateCartBar();
};

// Gerenciamento do Carrinho
function updateCartBar() {
  const count = CART.reduce((acc, it) => acc + it.quantity, 0);
  const subtotal = CART.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);

  const bar = $('#bar');
  if (count > 0) {
    bar.classList.add('on');
    document.body.classList.add('hascart');
    $('#bc').textContent = `Ver meu pedido · ${count} ${count === 1 ? 'item' : 'itens'}`;
    $('#bt').textContent = R(subtotal);
  } else {
    bar.classList.remove('on');
    document.body.classList.remove('hascart');
  }
}

window.openCartModal = function() {
  renderCartModal();
  showSheet();
};

let APP_CONFIRM_CALLBACK = null;
window.showAppConfirmModal = function({ icon = '⚠️', title = 'Confirmar', message = 'Tem certeza?', btnText = 'Sim', onConfirm }) {
  const modal = $('#app-confirm-modal');
  if (!modal) {
    if (confirm(message)) { if (onConfirm) onConfirm(); }
    return;
  }
  if ($('#app-confirm-icon')) $('#app-confirm-icon').textContent = icon;
  if ($('#app-confirm-title')) $('#app-confirm-title').textContent = title;
  if ($('#app-confirm-msg')) $('#app-confirm-msg').innerHTML = message;
  const yesBtn = $('#app-confirm-btn-yes');
  if (yesBtn) {
    yesBtn.textContent = btnText;
    yesBtn.onclick = () => {
      const cb = APP_CONFIRM_CALLBACK;
      closeAppConfirmModal();
      if (typeof cb === 'function') cb();
    };
  }
  APP_CONFIRM_CALLBACK = onConfirm;
  modal.style.display = 'flex';
};

window.closeAppConfirmModal = function() {
  const modal = $('#app-confirm-modal');
  if (modal) modal.style.display = 'none';
  APP_CONFIRM_CALLBACK = null;
};

window.clearCart = function() {
  if (CART.length === 0) return;
  showAppConfirmModal({
    icon: '🗑️',
    title: 'Limpar Pedido?',
    message: 'Deseja realmente esvaziar seu carrinho e remover todos os itens adicionados?',
    btnText: 'Sim, Limpar Tudo',
    onConfirm: () => {
      CART = [];
      APPLIED_COUPON = null;
      updateCartBar();
      renderCartModal();
      toast('Carrinho esvaziado com sucesso!');
    }
  });
};

function renderCartModal() {
  const sheet = $('#sheet');
  const subtotal = CART.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);

  let h = `
    <button class="x" onclick="closeSheet()">×</button>
    <button class="btn o" onclick="closeSheet()" style="position:absolute;top:14px;left:14px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer">
      Voltar para o cardápio
    </button>
    <div style="display:flex;justify-content:space-between;align-items:center;padding-right:32px;margin-bottom:12px;margin-top:28px">
      <h3 style="margin:0">Seu Pedido</h3>
      ${CART.length > 0 ? `
        <button onclick="clearCart()" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px" title="Remover todos os itens">
          🗑️ Limpar Pedido
        </button>
      ` : ''}
    </div>
  `;

  if (CART.length === 0) {
    h += `
      <p class="mut" style="padding:24px 0;text-align:center">Seu carrinho está vazio.</p>
      <button class="btn" onclick="closeSheet()">Voltar para o cardápio</button>
    `;
    sheet.innerHTML = h;
    return;
  }

  CART.forEach((it, idx) => {
    h += `
      <div class="ci">
        <div>
          <b>${esc(it.name)}</b>
          ${it.accompaniments.length > 0 ? `<small>Acomp: ${esc(it.accompaniments.join(', '))}</small>` : ''}
          ${it.extras.length > 0 ? `<small>Extras: ${esc(it.extras.join(', '))}</small>` : ''}
          ${it.note ? `<small>Obs: ${esc(it.note)}</small>` : ''}
        </div>
        <div class="qty sm">
          <button onclick="changeCartQty(${idx}, -1)">−</button>
          <b>${it.quantity}</b>
          <button onclick="changeCartQty(${idx}, 1)">+</button>
        </div>
        <b>${R(it.unitPrice * it.quantity)}</b>
      </div>
    `;
  });

  // Cupom de Desconto
  h += `
    <div style="margin-top:14px">
      <label>Tem um cupom de desconto?</label>
      <div class="coupon-box">
        <input id="coupon-input" placeholder="Ex: EXPLOSAO10" value="${APPLIED_COUPON ? APPLIED_COUPON.code : ''}">
        <button onclick="applyCoupon()">Aplicar</button>
      </div>
      ${APPLIED_COUPON ? `
        <div class="coupon-badge">
          <span>Cupom <b>${esc(APPLIED_COUPON.code)}</b> aplicado (-${R(APPLIED_COUPON.discount)})</span>
          <button onclick="removeCoupon()" style="border:0;background:transparent;cursor:pointer;font-weight:bold">×</button>
        </div>
      ` : ''}
    </div>
  `;

  const discount = APPLIED_COUPON ? APPLIED_COUPON.discount : 0;
  const finalSubtotal = Math.max(0, subtotal - discount);

  h += `
    <div class="tot" style="margin-top:14px"><span>Subtotal</span><span>${R(subtotal)}</span></div>
    ${discount > 0 ? `<div class="tot" style="color:var(--success)"><span>Desconto</span><span>-${R(discount)}</span></div>` : ''}
    <div class="tot g"><span>Subtotal Final</span><b>${R(finalSubtotal)}</b></div>

    <button class="btn" onclick="openCheckoutModal()">Finalizar Compra</button>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn o" style="flex:1" onclick="closeSheet()">Voltar para o cardápio</button>
      <button class="btn" style="flex:1;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);font-size:13px;font-weight:600" onclick="clearCart()">🗑️ Limpar Pedido</button>
    </div>
  `;

  sheet.innerHTML = h;
}

window.changeCartQty = function(idx, delta) {
  CART[idx].quantity += delta;
  if (CART[idx].quantity <= 0) {
    CART.splice(idx, 1);
  }
  updateCartBar();
  renderCartModal();
};

window.applyCoupon = async function() {
  const code = $('#coupon-input').value.trim();
  if (!code) return toast('Digite o código do cupom.');

  const subtotal = CART.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
  try {
    const res = await fetch(`${API_URL}/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, subtotal })
    });
    const data = await res.json();
    if (data.ok) {
      APPLIED_COUPON = data.coupon;
      toast(`Cupom ${data.coupon.code} aplicado com sucesso!`);
      renderCartModal();
    } else {
      toast(data.error || 'Cupom inválido.');
    }
  } catch (e) {
    toast('Falha ao validar cupom.');
  }
};

window.removeCoupon = function() {
  APPLIED_COUPON = null;
  toast('Cupom removido.');
  renderCartModal();
};

// Checkout & Pagamento
window.openCheckoutModal = function() {
  renderCheckoutModal();
  showSheet();
};

function renderCheckoutModal() {
  const sheet = $('#sheet');
  const isDelivery = CHECKOUT_DATA.ent !== 'r';
  const subtotal = CART.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
  const discount = APPLIED_COUPON ? APPLIED_COUPON.discount : 0;
  const freight = isDelivery && CHECKOUT_DATA.freight ? CHECKOUT_DATA.freight : (isDelivery ? 4.50 : 0);
  const total = Math.max(0, subtotal - discount + freight);

  let h = `
    <button class="x" onclick="closeSheet()">×</button>
    <button class="btn o" onclick="closeSheet()" style="position:absolute;top:14px;left:14px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer">
      Voltar para o cardápio
    </button>
    <h3 style="margin-top:28px">Finalizar Pedido</h3>

    <h4>Forma de Recebimento</h4>
    <div class="chips">
      <div class="chip ${isDelivery ? 'on' : ''}" onclick="setDeliveryType('e')">Entrega em Domicílio</div>
      <div class="chip ${!isDelivery ? 'on' : ''}" onclick="setDeliveryType('r')">Retirada na Loja</div>
    </div>

    <label>Seu Nome
      <input id="f_nome" value="${esc(CHECKOUT_DATA.nome || '')}" placeholder="Digite seu nome completo" oninput="CHECKOUT_DATA.nome = this.value">
    </label>

    <label>Telefone / WhatsApp (com DDD)
      <input id="f_tel" type="tel" value="${esc(CHECKOUT_DATA.tel || '')}" placeholder="(16) 99999-9999" oninput="CHECKOUT_DATA.tel = this.value">
    </label>
  `;

  if (isDelivery) {
    h += `
      <label>Rua ou Avenida
        <input id="f_rua" value="${esc(CHECKOUT_DATA.rua || '')}" placeholder="Ex: Avenida Brasil" list="rua-suggestions" autocomplete="off" oninput="handleRuaInput(this.value)" onchange="handleRuaChange(this.value)">
        <datalist id="rua-suggestions"></datalist>
      </label>

      <div class="g2">
        <label>Número
          <input id="f_num" value="${esc(CHECKOUT_DATA.num || '')}" placeholder="Ex: 123 (ou S/N)" oninput="CHECKOUT_DATA.num = this.value; calcFrete()" onchange="CHECKOUT_DATA.num = this.value; calcFrete()">
        </label>
        <label>CEP
          <input id="f_cep" value="${esc(CHECKOUT_DATA.cep || '')}" placeholder="14400-000" onchange="buscaCep(this.value)" oninput="if(this.value.replace(/\\D/g,'').length===8) buscaCep(this.value)">
        </label>
      </div>

      <label>Bairro
        <input id="f_bairro" value="${esc(CHECKOUT_DATA.bairro || '')}" placeholder="Ex: Aeroporto" oninput="CHECKOUT_DATA.bairro = this.value; calcFrete()" onchange="CHECKOUT_DATA.bairro = this.value; calcFrete()">
      </label>

      <label>Ponto de Referência
        <input id="f_ref" value="${esc(CHECKOUT_DATA.ref || '')}" placeholder="Ex: Próximo à padaria" oninput="CHECKOUT_DATA.ref = this.value">
      </label>

      <div style="margin-top:10px;font-size:13px;color:var(--mut)" id="freight-info">
        ${CHECKOUT_DATA.freight === 0 ? `<b style="color:var(--green)">Distância estimada: ${(CHECKOUT_DATA.km || 1.8).toFixed(1)} km · Entrega GRÁTIS (Até 2 km)!</b>` : (CHECKOUT_DATA.freight ? `Distância estimada: ${CHECKOUT_DATA.km?.toFixed(1) || '3.5'} km · Frete: ${R(CHECKOUT_DATA.freight)}` : 'Entrega GRÁTIS até 2 km · Acima: R$ 4,50 mínimo')}
      </div>
    `;
  }

  // Métodos de Pagamento
  h += `
    <h4>Forma de Pagamento</h4>
    <div class="chips">
      ${['Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro'].map(p => `
        <div class="chip ${CHECKOUT_DATA.pay === p ? 'on' : ''}" onclick="setPaymentMethod('${p}')">${p}</div>
      `).join('')}
    </div>
  `;

  // Detalhes conforme a forma de pagamento selecionada
  if (CHECKOUT_DATA.pay === 'Pix') {
    h += `
      <div class="sub-payment-choice">
        <div class="sub-payment-title">Pagamento via Pix:</div>
        <div style="font-size:13px;color:var(--mut)">Será gerado o QR Code e código Copia e Cola. O pedido é liberado imediatamente após a confirmação bancária.</div>
      </div>
    `;
  } else if (CHECKOUT_DATA.pay === 'Dinheiro') {
    h += `
      <div class="sub-payment-choice">
        <div class="sub-payment-title">Pagamento em Dinheiro na Entrega:</div>
        <label style="font-size:13px">Precisa de troco para quanto?
          <input id="f_troco" value="${esc(CHECKOUT_DATA.troco || '')}" placeholder="Ex: R$ 50,00 (deixe em branco se for valor exato)" oninput="CHECKOUT_DATA.troco = this.value">
        </label>
      </div>
    `;
  }

  h += `
    <div id="checkout-totals-box">
      <div class="tot" style="margin-top:16px"><span>Subtotal</span><span>${R(subtotal)}</span></div>
      ${discount > 0 ? `<div class="tot" style="color:var(--success)"><span>Desconto</span><span>-${R(discount)}</span></div>` : ''}
      ${isDelivery ? `<div class="tot"><span>Frete</span><span style="${freight === 0 ? 'color:var(--green);font-weight:700' : ''}">${freight === 0 ? 'GRÁTIS (Até 2 km)' : R(freight)}</span></div>` : ''}
      <div class="tot g"><span>Total a Pagar</span><b>${R(total)}</b></div>

      <button class="btn g" id="btn-submit-order" onclick="submitOrder()">Enviar Pedido · ${R(total)}</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn o" style="flex:1" onclick="openCartModal()">← Ver carrinho</button>
      <button class="btn o" style="flex:1" onclick="closeSheet()">Voltar para o cardápio</button>
    </div>
  `;

  sheet.innerHTML = h;
}

window.setDeliveryType = function(type) {
  CHECKOUT_DATA.ent = type;
  if (type === 'e' && CHECKOUT_DATA.freight === undefined) {
    calcFrete();
  }
  renderCheckoutModal();
};

window.setPaymentMethod = function(method) {
  CHECKOUT_DATA.pay = method;
  if (method === 'Dinheiro' || method.includes('Cartão')) {
    CHECKOUT_DATA.timing = 'delivery';
  } else if (method === 'Pix') {
    CHECKOUT_DATA.timing = 'online';
  }
  renderCheckoutModal();
};

window.setPaymentTiming = function(timing) {
  CHECKOUT_DATA.timing = timing;
  renderCheckoutModal();
};

function applyAddressFromLookup(item) {
  if (!item) return;
  if (item.logradouro && $('#f_rua') && $('#f_rua').value !== item.logradouro) {
    $('#f_rua').value = item.logradouro;
    CHECKOUT_DATA.rua = item.logradouro;
  }
  if (item.cep) {
    const cleanCep = String(item.cep).replace(/\D/g, '');
    CHECKOUT_DATA.cep = cleanCep;
    if ($('#f_cep')) $('#f_cep').value = item.cep;
  }
  if (item.bairro) {
    CHECKOUT_DATA.bairro = item.bairro;
    if ($('#f_bairro')) $('#f_bairro').value = item.bairro;
  }
  CHECKOUT_DATA.cid = item.localidade || 'Franca';
  CHECKOUT_DATA.uf = item.uf || 'SP';
  calcFrete();
}

let RUA_SEARCH_TIMER = null;
window.handleRuaInput = function(val) {
  CHECKOUT_DATA.rua = val;
  calcFrete();

  clearTimeout(RUA_SEARCH_TIMER);
  const clean = val.trim();
  if (clean.length < 3) return;

  RUA_SEARCH_TIMER = setTimeout(async () => {
    try {
      const query = encodeURIComponent(clean);
      const res = await fetch(`https://viacep.com.br/ws/SP/Franca/${query}/json/`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const dl = $('#rua-suggestions');
        if (dl) {
          dl.innerHTML = data.slice(0, 8).map(d => `<option value="${d.logradouro}">${d.bairro} · CEP: ${d.cep}</option>`).join('');
        }
        const exact = data.find(d => d.logradouro.toLowerCase() === clean.toLowerCase()) || (data.length === 1 ? data[0] : null);
        if (exact) {
          applyAddressFromLookup(exact);
        }
      }
    } catch (e) {}
  }, 450);
};

window.handleRuaChange = async function(val) {
  CHECKOUT_DATA.rua = val;
  const clean = val.trim();
  if (clean.length < 3) return;

  try {
    const query = encodeURIComponent(clean);
    const res = await fetch(`https://viacep.com.br/ws/SP/Franca/${query}/json/`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const match = data.find(d => d.logradouro.toLowerCase().includes(clean.toLowerCase())) || data[0];
      if (match) {
        applyAddressFromLookup(match);
      }
    }
  } catch (e) {}
  calcFrete();
};

window.buscaCep = async function(cep) {
  const digits = String(cep || '').replace(/\D/g, '');
  if (digits.length !== 8) return;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    const data = await res.json();
    if (!data.erro) {
      applyAddressFromLookup(data);
    }
  } catch (e) {}
};

let FREIGHT_DEBOUNCE_TIMER = null;
window.calcFrete = function() {
  clearTimeout(FREIGHT_DEBOUNCE_TIMER);
  FREIGHT_DEBOUNCE_TIMER = setTimeout(async () => {
    const rua = (CHECKOUT_DATA.rua || $('#f_rua')?.value || '').trim();
    const num = (CHECKOUT_DATA.num || $('#f_num')?.value || '').trim();
    const bairro = (CHECKOUT_DATA.bairro || $('#f_bairro')?.value || '').trim();
    const cep = (CHECKOUT_DATA.cep || $('#f_cep')?.value || '').trim();
    const cid = (CHECKOUT_DATA.cid || 'Franca').trim();
    const uf = (CHECKOUT_DATA.uf || 'SP').trim();

    if (!rua && !bairro && !cep) return;

    const info = $('#freight-info');
    if (info) {
      info.innerHTML = `<span style="opacity:0.7">Calculando distância da loja...</span>`;
    }

    try {
      const res = await fetch(`${API_URL}/store/calculate-freight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ street: rua, number: num, bairro, cep, city: cid, state: uf })
      });
      const data = await res.json();
      if (data.ok) {
        CHECKOUT_DATA.km = data.km;
        CHECKOUT_DATA.freight = data.freight;
        const freeKm = data.freeKmThreshold !== undefined ? data.freeKmThreshold : 2.0;

        if (info) {
          if (data.freight === 0) {
            info.innerHTML = `<b style="color:var(--green)">Distância estimada: ${data.km.toFixed(1)} km · Entrega GRÁTIS (Até ${freeKm} km)!</b>`;
          } else {
            info.innerHTML = `<span>Distância estimada: <b>${data.km.toFixed(1)} km</b> · Frete: <b style="color:var(--y)">${R(data.freight)}</b></span>`;
          }
        }

        // Atualiza o bloco de totais sem perder o foco nos inputs
        updateCheckoutTotalsDisplay();
        return;
      }
    } catch (err) {}

    // Fallback de cálculo
    const km = CHECKOUT_DATA.km !== undefined ? CHECKOUT_DATA.km : 3.5;
    const freeKm = SETTINGS.freeKmThreshold !== undefined ? Number(SETTINGS.freeKmThreshold) : 2.0;
    if (km <= freeKm) {
      CHECKOUT_DATA.freight = 0;
    } else {
      CHECKOUT_DATA.freight = Math.max(SETTINGS.minFreight || 4.5, Math.ceil(km * (SETTINGS.perKmRate || 1.0) * 2) / 2);
    }
    if (info) {
      if (CHECKOUT_DATA.freight === 0) {
        info.innerHTML = `<b style="color:var(--green)">Distância estimada: ${km.toFixed(1)} km · Entrega GRÁTIS (Até ${freeKm} km)!</b>`;
      } else {
        info.innerHTML = `<span>Distância estimada: <b>${km.toFixed(1)} km</b> · Frete: <b style="color:var(--y)">${R(CHECKOUT_DATA.freight)}</b></span>`;
      }
    }
    updateCheckoutTotalsDisplay();
  }, 400);
};

function updateCheckoutTotalsDisplay() {
  const box = $('#checkout-totals-box');
  if (!box) return;
  const isDelivery = CHECKOUT_DATA.ent !== 'r';
  const subtotal = CART.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
  const discount = APPLIED_COUPON ? APPLIED_COUPON.discount : 0;
  const freight = isDelivery && CHECKOUT_DATA.freight !== undefined ? CHECKOUT_DATA.freight : (isDelivery ? 4.50 : 0);
  const total = Math.max(0, subtotal - discount + freight);

  box.innerHTML = `
    <div class="tot" style="margin-top:16px"><span>Subtotal</span><span>${R(subtotal)}</span></div>
    ${discount > 0 ? `<div class="tot" style="color:var(--success)"><span>Desconto</span><span>-${R(discount)}</span></div>` : ''}
    ${isDelivery ? `<div class="tot"><span>Frete</span><span style="${freight === 0 ? 'color:var(--green);font-weight:700' : ''}">${freight === 0 ? 'GRÁTIS (Até 2 km)' : R(freight)}</span></div>` : ''}
    <div class="tot g"><span>Total a Pagar</span><b>${R(total)}</b></div>

    <button class="btn g" id="btn-submit-order" onclick="submitOrder()">Enviar Pedido · ${R(total)}</button>
  `;
}

// Enviar Pedido
window.submitOrder = async function() {
  const btn = $('#btn-submit-order');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando Pedido...';
  }

  // Leitura direta e sincronização com os campos visíveis no DOM
  const elNome = $('#f_nome');
  const elTel = $('#f_tel');
  const elRua = $('#f_rua');
  const elNum = $('#f_num');
  const elCep = $('#f_cep');
  const elBairro = $('#f_bairro');
  const elRef = $('#f_ref');
  const elTroco = $('#f_troco');

  if (elNome) CHECKOUT_DATA.nome = elNome.value.trim();
  if (elTel) CHECKOUT_DATA.tel = elTel.value.trim();
  if (elRua) CHECKOUT_DATA.rua = elRua.value.trim();
  if (elNum) CHECKOUT_DATA.num = elNum.value.trim();
  if (elCep) CHECKOUT_DATA.cep = elCep.value.trim();
  if (elBairro) CHECKOUT_DATA.bairro = elBairro.value.trim();
  if (elRef) CHECKOUT_DATA.ref = elRef.value.trim();
  if (elTroco) CHECKOUT_DATA.troco = elTroco.value.trim();

  if (!CHECKOUT_DATA.nome || !CHECKOUT_DATA.nome.trim()) {
    toast('Por favor, informe seu nome completo.');
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar Pedido'; }
    return;
  }

  let cleanPhone = String(CHECKOUT_DATA.tel || '').replace(/\D/g, '');
  if (cleanPhone.length === 8 || cleanPhone.length === 9) {
    cleanPhone = '16' + cleanPhone; // Prefixo DDD 16 padrão de Franca/SP
    CHECKOUT_DATA.tel = cleanPhone;
  }
  if (cleanPhone.length < 10) {
    toast('Por favor, informe um telefone válido com DDD (ex: 16 99999-9999).');
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar Pedido'; }
    return;
  }

  const isDelivery = CHECKOUT_DATA.ent !== 'r';
  if (isDelivery) {
    if (!CHECKOUT_DATA.rua || !CHECKOUT_DATA.rua.trim()) {
      toast('Por favor, informe a rua ou avenida para entrega.');
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar Pedido'; }
      return;
    }
    if (!CHECKOUT_DATA.num || !CHECKOUT_DATA.num.trim()) {
      toast('Por favor, informe o número da residência (ou S/N).');
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar Pedido'; }
      return;
    }
  }

  const payload = {
    customer: {
      name: CHECKOUT_DATA.nome.trim(),
      phone: cleanPhone
    },
    delivery: isDelivery ? {
      type: 'delivery',
      street: CHECKOUT_DATA.rua,
      number: CHECKOUT_DATA.num,
      bairro: CHECKOUT_DATA.bairro || '',
      city: CHECKOUT_DATA.cid || 'Franca',
      state: CHECKOUT_DATA.uf || 'SP',
      cep: CHECKOUT_DATA.cep || '',
      reference: CHECKOUT_DATA.ref || '',
      freight: CHECKOUT_DATA.freight !== undefined ? CHECKOUT_DATA.freight : 0,
      km: CHECKOUT_DATA.km !== undefined ? CHECKOUT_DATA.km : 1.8
    } : { type: 'pickup' },
    items: CART.map(it => ({
      name: it.name,
      size: it.size,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      accompaniments: it.accompaniments,
      extras: it.extras,
      fruits: it.fruits,
      note: it.note
    })),
    payment: {
      method: CHECKOUT_DATA.pay,
      timing: (CHECKOUT_DATA.pay === 'Dinheiro' || CHECKOUT_DATA.pay.includes('Cartão')) ? 'delivery' : 'online',
      changeFor: CHECKOUT_DATA.pay === 'Dinheiro' ? CHECKOUT_DATA.troco : null
    },
    couponCode: APPLIED_COUPON ? APPLIED_COUPON.code : null
  };

  try {
    const res = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.ok && data.order) {
      ACTIVE_ORDER = data.order;
      CART = [];
      APPLIED_COUPON = null;
      updateCartBar();
      saveClientChatData(data.order.customer?.phone, data.order.customer?.name);
      // Limpa os dados digitados no checkout para que o próximo pedido comece com o formulário vazio
      CHECKOUT_DATA = { ent: 'e', cid: 'Franca', uf: 'SP', pay: 'Pix', timing: 'online' };
      renderOrderSuccess(data.order);
      toast('Pedido realizado com sucesso!');
    } else {
      toast(data.error || 'Erro ao registrar pedido.');
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar Pedido'; }
    }
  } catch (err) {
    toast('Falha de conexão ao enviar pedido.');
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar Pedido'; }
  }
};

// Tela de Confirmação & Rastreamento
function renderOrderSuccess(order) {
  const sheet = $('#sheet');
  const isPixOnline = order.payment.method === 'Pix' && order.payment.timing === 'online';

  const cleanCustPhone = String(order.customer?.phone || '').replace(/\D/g, '');
  const itemsSummary = (order.items || []).map(it => {
    let line = `• *${it.quantity}x* ${it.name}`;
    if (it.accompaniments?.length) line += ` (Acomp: ${it.accompaniments.join(', ')})`;
    if (it.extras?.length) line += ` (Extras: ${it.extras.join(', ')})`;
    if (it.fruits?.length) line += ` (Frutas: ${it.fruits.join(', ')})`;
    if (it.note) line += ` (Obs: ${it.note})`;
    return line;
  }).join('\n');

  const wppReceiptMsg = encodeURIComponent(
    `🍧 *COMPROVANTE DO MEU PEDIDO - EXPLOSÃO AÇAÍ* 🍧\n\n` +
    `Olá, *${order.customer?.name}*!\n` +
    `Aqui está a cópia do seu pedido *#${order.orderNo}*:\n\n` +
    `📋 *ITENS:*\n${itemsSummary}\n\n` +
    `💵 *Total:* ${R(order.total)} (${order.payment?.method || 'Pagamento'})\n` +
    `📍 *Tipo:* ${order.delivery?.type === 'delivery' ? `Entrega (${order.delivery.street}, ${order.delivery.number} — ${order.delivery.bairro})` : 'Retirada no Balcão'}\n\n` +
    `Acompanhe as atualizações do seu açaí em tempo real pelo site do delivery!`
  );
  const wppReceiptUrl = `https://wa.me/55${cleanCustPhone}?text=${wppReceiptMsg}`;

  let h = `
    <button class="x" onclick="closeSheet()">×</button>
    <button class="btn o" onclick="closeSheet()" style="position:absolute;top:14px;left:14px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer">
      Voltar para o cardápio
    </button>
    <div style="text-align:center;padding:10px 0;margin-top:20px">
      <h3 style="margin:4px 0">Pedido #${order.orderNo} Registrado</h3>
      <p class="mut" style="font-size:14px">Seu pedido foi recebido pelo sistema da Explosão Açaí.</p>
    </div>
  `;

  // Bloco Pix se for online
  if (isPixOnline) {
    if (order.payment.status === 'approved') {
      if (window._pixPollInterval) {
        clearInterval(window._pixPollInterval);
        window._pixPollInterval = null;
      }
      h += `
        <div class="pix-approved-box" style="background:#ecfdf5;border:1.5px solid #10b981;border-radius:14px;padding:16px;text-align:center;margin:14px 0">
          <div style="font-size:24px">✅</div>
          <b style="color:#065f46;font-size:15px;display:block;margin-top:4px">Pagamento Confirmado pelo Banco!</b>
          <span style="font-size:12px;color:#047857">Seu pedido já foi encaminhado para a produção na cozinha.</span>
        </div>
      `;
    } else if (order.payment.qrCodeBase64 || order.payment.qrCode) {
      const qrSrc = (order.payment.qrCodeBase64 || '').startsWith('data:')
        ? order.payment.qrCodeBase64
        : `data:image/png;base64,${order.payment.qrCodeBase64}`;

      h += `
        <div class="pix-box">
          <h4 style="margin:0 0 8px;color:var(--p)">Pagamento via Pix</h4>
          <p style="font-size:12px;color:var(--mut);margin:0 0 12px">Escaneie o QR Code ou copie o código Pix abaixo. Assim que o pagamento for concluído, esta tela atualizará automaticamente!</p>
          ${order.payment.qrCodeBase64 ? `<img class="pix-qr" src="${qrSrc}" alt="QR Code Pix" style="max-width:220px;width:100%;height:auto;border-radius:12px;border:1px solid var(--ln);padding:8px;background:#fff;margin:0 auto;display:block">` : ''}

          <div class="copy-box" style="margin-top:12px">
            <input class="copy-input" id="pix-copy-input" value="${esc(order.payment.qrCode || '')}" readonly>
            <button class="copy-btn" onclick="copyPixCode()">Copiar Código</button>
          </div>

          <button class="btn p" style="margin-top:14px" onclick="checkPixStatus('${order.id}')">Verificar Confirmação Bancária</button>
        </div>
      `;

      // Inicia verificação periódica em segundo plano (reserva se webhook demorar)
      if (window._pixPollInterval) clearInterval(window._pixPollInterval);
      window._pixPollInterval = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/orders/${order.id}`);
          const data = await res.json();
          if (data.ok && data.order) {
            if (data.order.payment?.status === 'approved' || data.order.status !== 'received') {
              clearInterval(window._pixPollInterval);
              window._pixPollInterval = null;
              ACTIVE_ORDER = data.order;
              toast('Pagamento aprovado pelo banco!');
              renderOrderSuccess(data.order);
            }
          }
        } catch (e) {}
      }, 3500);
    }
  }

  // Rastreamento com status formal sem emojis informais
  h += `
    <div id="tracker-box" style="background:var(--card);border:1.5px solid var(--ln);border-radius:16px;padding:16px;margin:14px 0">
      <div style="font-weight:700;font-size:14px;margin-bottom:8px">Status da Produção:</div>
      <div>
        <b id="tracker-status" style="color:var(--p2);font-size:16px">${formatStatus(order.status, order)}</b>
        <div style="font-size:12px;color:var(--mut);margin-top:4px">
          ${order.payment.timing === 'delivery' 
            ? `Cobrança na entrega: ${esc(order.payment.method)} ${order.payment.trocoValue > 0 ? `(Levar troco de ${R(order.payment.trocoValue)})` : ''}` 
            : (order.payment.status === 'approved' ? 'Pagamento online confirmado pelo banco' : 'Aguardando confirmação bancária')}
        </div>
      </div>
    </div>

    <a href="${wppReceiptUrl}" target="_blank" class="btn" style="background:#22c55e;color:#fff;margin-top:10px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700">
      💬 Receber Cópia do Pedido no WhatsApp
    </a>
    <button class="btn p" style="margin-top:8px" onclick="openChatModal('${order.customer.phone}', '${esc(order.customer.name)}')">
      Abrir Chat com a Loja
    </button>
    <button class="btn" style="background:#4b0f6b;color:#fff;margin-top:8px;font-weight:700" onclick="closeSheet()">
      Voltar para o cardápio
    </button>
  `;

  sheet.innerHTML = h;
}

window.copyPixCode = function() {
  const inp = $('#pix-copy-input');
  if (inp) {
    inp.select();
    navigator.clipboard.writeText(inp.value);
    toast('Código Pix copiado para a área de transferência!');
  }
};

window.checkPixStatus = async function(orderId) {
  try {
    const res = await fetch(`${API_URL}/orders/${orderId}`);
    const data = await res.json();
    if (data.ok && data.order) {
      if (data.order.payment.status === 'approved' || data.order.status !== 'received') {
        toast('Pagamento aprovado pelo banco! Cupom impresso para a cozinha.');
        renderOrderSuccess(data.order);
      } else {
        toast('Aguardando confirmação do banco... Tente novamente em alguns segundos.');
      }
    }
  } catch (e) {
    toast('Erro ao consultar status do pagamento.');
  }
};

// Formatação limpa dos status operacionais
function formatStatus(status, order = null) {
  const isPickup = (order && (order.delivery?.type === 'pickup' || order.delivery?.type === 'retirada' || order.delivery?.type !== 'delivery')) || (status === 'ready' && (!order || order.delivery?.type !== 'delivery'));
  switch (status) {
    case 'received': return 'Recebido pela Loja';
    case 'preparing': return 'Em Preparo na Cozinha';
    case 'ready': return isPickup ? 'Pronto para Retirada no Balcão' : 'Pronto para Entrega';
    case 'out_for_delivery': return isPickup ? 'Pronto para Retirada no Balcão' : 'Saiu para Entrega (Em Rota)';
    case 'delivered': return isPickup ? 'Retirado no Balcão (Concluído)' : 'Entregue (Concluído)';
    case 'cancelled': return 'Cancelado';
    default: return status;
  }
}

// Identificação Única e Privada do Cliente no Chat
function getClientChatData() {
  let clientId = localStorage.getItem('explosao_chat_client_id');
  if (!clientId) {
    clientId = 'cli_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('explosao_chat_client_id', clientId);
  }

  const savedPhone = localStorage.getItem('explosao_customer_phone');
  const savedName = localStorage.getItem('explosao_customer_name');

  const phone = (CHECKOUT_DATA && CHECKOUT_DATA.tel) || savedPhone || clientId;
  const name = (CHECKOUT_DATA && CHECKOUT_DATA.nome) || savedName || 'Cliente';

  return { clientId, phone: String(phone).trim(), name: String(name).trim() };
}

function saveClientChatData(phone, name) {
  if (phone) localStorage.setItem('explosao_customer_phone', String(phone).trim());
  if (name) localStorage.setItem('explosao_customer_name', String(name).trim());
}

// Chat em Tempo Real com a Loja Oficial "Explosão Açaí"
window.openChatModal = function(phone, name) {
  const client = getClientChatData();
  const customerPhone = phone || client.phone;
  const customerName = name || client.name;

  if (phone) saveClientChatData(phone, name);

  renderChatModal(customerPhone, customerName);
  showSheet();
  loadChatMessages(customerPhone);
};

function renderChatModal(phone, name) {
  const sheet = $('#sheet');
  const isTemp = String(phone).startsWith('cli_');
  sheet.innerHTML = `
    <button class="x" onclick="closeSheet()">×</button>
    
    <div class="chat-header-bar">
      <img src="imagens/Logo.png" alt="Explosão Açaí" class="chat-store-logo" onerror="this.src='imagens/do seu jeitinho.png'">
      <div class="chat-store-title">
        <b>Explosão Açaí</b>
        <span>Atendimento Oficial da Loja</span>
      </div>
      <button class="btn-sm" style="margin-left:auto;margin-right:24px;background:#7c3aed;border:1.5px solid #a855f7;color:#fff;border-radius:10px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(124,58,237,0.5)" onclick="clearAndStartNewChat()" title="Iniciar atendimento limpo do zero">🧹 Novo Chat</button>
    </div>

    ${isTemp ? `
      <div style="background:rgba(88,28,135,0.06);border-bottom:1px solid var(--ln);padding:8px 12px;font-size:11px;color:var(--mut);text-align:center">
        Canal de conversa privativo e seguro · Loja ao vivo
      </div>
    ` : `
      <div style="background:rgba(88,28,135,0.06);border-bottom:1px solid var(--ln);padding:6px 12px;font-size:11px;color:var(--mut);text-align:center">
        Atendimento para: <b>${esc(name)}</b> (${esc(phone)})
      </div>
    `}

    <div class="chat-window">
      <div class="chat-messages" id="chat-messages-box">
        <p style="text-align:center;color:var(--mut);font-size:12px;padding:20px 0">Carregando mensagens...</p>
      </div>

      <div class="chat-input-row">
        <input id="chat-text-input" placeholder="Digite sua mensagem para a loja..." onkeydown="if(event.key==='Enter') sendChatMessage('${phone}', '${esc(name)}')">
        <button class="btn p" style="width:auto;margin:0;padding:10px 18px" onclick="sendChatMessage('${phone}', '${esc(name)}')">Enviar</button>
      </div>
    </div>
  `;
}

async function loadChatMessages(phone) {
  try {
    const res = await fetch(`${API_URL}/chat?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (data.ok) {
      if (data.messages && data.messages.length > 0 && data.messages[data.messages.length - 1].isSystemClose) {
        renderChatClosedState();
        return;
      }
      renderChatMessagesList(data.messages);
    }
  } catch (e) {}
}

function renderChatClosedState() {
  const box = $('#chat-messages-box');
  if (!box) return;
  box.innerHTML = `
    <div style="text-align:center;padding:28px 14px;color:var(--mut);margin:auto">
      <div style="font-size:32px;margin-bottom:8px">🏁</div>
      <b style="color:var(--tx);font-size:15px">Atendimento Concluído</b>
      <p style="font-size:13px;line-height:1.45;margin:8px 0 16px">O atendimento anterior foi finalizado pelo operador.<br>Digite sua mensagem abaixo para iniciar uma nova conversa limpa!</p>
    </div>
  `;
}

window.clearAndStartNewChat = async function() {
  const client = getClientChatData();
  try {
    await fetch(`${API_URL}/chat/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerPhone: client.phone })
    });
  } catch (e) {}
  localStorage.removeItem('explosao_chat_client_id');
  const freshClient = getClientChatData();
  renderChatModal(freshClient.phone, freshClient.name);
  renderChatMessagesList([]);
  toast('Novo atendimento iniciado do zero!');
};

function handleChatClosed(payload) {
  const client = getClientChatData();
  const myPhone = client.phone;
  const cleanMy = String(myPhone || '').replace(/\D/g, '');
  const cleanPayload = String(payload.customerPhone || '').replace(/\D/g, '');
  const isForMe = (payload.customerPhone === myPhone) || (cleanMy && cleanPayload && cleanMy === cleanPayload);
  if (!isForMe) return;

  if (String(myPhone).startsWith('cli_')) {
    localStorage.removeItem('explosao_chat_client_id');
  }

  const box = $('#chat-messages-box');
  if (box) {
    renderChatClosedState();
  }
}

function renderChatMessagesList(messages) {
  const box = $('#chat-messages-box');
  if (!box) return;

  if (messages.length === 0) {
    box.innerHTML = `<p style="text-align:center;color:var(--mut);font-size:12px;padding:30px 0">Olá! Envie sua dúvida ou solicitação para falar diretamente com nossa equipe.</p>`;
    return;
  }

  box.innerHTML = messages.map(m => {
    const isStore = m.sender === 'store' || m.sender === 'admin';
    const isSystem = m.isSystemClose;
    if (isSystem) {
      return `
        <div class="chat-bubble system">
          ${esc(m.message)}
          <small>${new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
      `;
    }
    const storeName = m.senderName || SETTINGS.chatSenderName || 'Delivery';
    return `
      <div class="chat-bubble ${isStore ? 'store' : 'customer'}">
        <div class="chat-bubble-author" style="${isStore ? 'color:#6b21a8' : 'color:#fde047;justify-content:flex-end'}">
          ${isStore ? `<img src="imagens/Logo.png" alt="Logo" onerror="this.style.display='none'"> <b>${esc(storeName)}</b>` : `<b>Você</b>`}
        </div>
        <div>${esc(m.message)}</div>
        <small style="opacity:0.8">${new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
      </div>
    `;
  }).join('');

  box.scrollTop = box.scrollHeight;
}

window.sendChatMessage = async function(phone, name) {
  const inp = $('#chat-text-input');
  if (!inp || !inp.value.trim()) return;

  const text = inp.value.trim();
  inp.value = '';

  const client = getClientChatData();
  const targetPhone = phone || client.phone;
  const targetName = name || client.name;

  try {
    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'customer',
        customerPhone: targetPhone,
        customerName: targetName,
        message: text
      })
    });
    const data = await res.json();
    if (data.ok) {
      loadChatMessages(targetPhone);
    }
  } catch (e) {
    toast('Falha ao enviar mensagem.');
  }
};

function handleIncomingChatMessage(msg) {
  const client = getClientChatData();
  const myPhone = client.phone;
  const cleanMy = String(myPhone || '').replace(/\D/g, '');
  const cleanMsg = String(msg.customerPhone || '').replace(/\D/g, '');

  const isForMe = (msg.customerPhone === myPhone) || (cleanMy && cleanMsg && cleanMy === cleanMsg);

  // SE NÃO FOR PARA ESTE CLIENTE, DESCARTE SILENCIOSAMENTE!
  if (!isForMe) return;

  const box = $('#chat-messages-box');
  if (box) {
    loadChatMessages(myPhone);
  } else if (msg.sender === 'admin' || msg.sender === 'store') {
    toast(`Nova mensagem de Explosão Açaí: "${msg.message}"`);
  }
}

// Controle de Modal Sheet
function showSheet() {
  $('#ov').classList.add('on');
  $('#sheet').classList.add('on');
  document.body.style.overflow = 'hidden';
}

window.closeSheet = function() {
  if (window._pixPollInterval) {
    clearInterval(window._pixPollInterval);
    window._pixPollInterval = null;
  }
  $('#ov').classList.remove('on');
  $('#sheet').classList.remove('on');
  document.body.style.overflow = '';
};

function bindEvents() {
  $('#ov').onclick = closeSheet;
  $('#bar').onclick = openCartModal;
}
