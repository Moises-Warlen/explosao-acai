/* =========================================================================
   PAINEL ADMINISTRATIVO COMPLETO & GESTÃO AVANÇADA — EXPLOSÃO AÇAÍ
   - Regra de Impressão Rígida: Pix e Cartão só imprimem após confirmação bancária
   - Relatórios Gerenciais de Vendas, Fretes, Lucros, Tempos de Preparo e Entrega
   - Gráficos Visuais dos Mais Vendidos e Menos Vendidos com Fotos e Exportação em PDF A4
   - Ficha Técnica de Insumos com Detecção e Alertas Automáticos de Prejuízo
   - Soma Automática de Custos em Combos a partir dos produtos selecionados
   - CRUD de Categorias, Produtos (com Pausa, Upload do Computador, Novidades e Promoções)
   - CRUD de Acompanhamentos Dinâmicos com limites editáveis por tamanho
   - Geração de Cupons de Desconto com Envio no Chat ao Vivo e WhatsApp
   ========================================================================= */

const API_URL = '/api';
const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

let ADMIN_TOKEN = localStorage.getItem('admin_token') || '';
let ORDERS = [];
let CATEGORIES = [];
let PRODUCTS = [];
let ACCOMPANIMENTS = [];
let EXTRAS = [];
let COUPONS = [];
let PRINTERS = [];
let SETTINGS = {};
let CHAT_CONVERSATIONS = [];
let ACTIVE_CHAT_PHONE = null;
let CURRENT_REPORT = null;
let WS = null;

// Áudio de Notificação de Novo Pedido ou Mensagem
let audioCtx = null;
function playNotificationChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      gain.gain.value = 0.25;
      osc.start(audioCtx.currentTime + idx * 0.12);
      osc.stop(audioCtx.currentTime + idx * 0.12 + 0.25);
    });
  } catch (e) {}
}

// Helpers Utilitários
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const R = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Notificação Toast Integrada (Substitui alerts invasivos no painel)
function adminToast(msg, type = 'info') {
  const toast = $('#admin-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `show ${type}`;
  clearTimeout(window.__adminToastTimer);
  window.__adminToastTimer = setTimeout(() => {
    toast.className = '';
  }, 3500);
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!ADMIN_TOKEN) {
    showLoginModal();
  } else {
    initDashboard();
  }
});

// Autenticação do Administrador
function showLoginModal() {
  const modal = $('#login-modal');
  if (modal) modal.style.display = 'flex';
}

window.doLogin = async function() {
  const pass = $('#admin-pass-input').value.trim();
  if (!pass) return adminToast('Digite a senha de administrador.', 'danger');

  try {
    const res = await fetch(`${API_URL}/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    const data = await res.json();
    if (data.ok) {
      ADMIN_TOKEN = data.token;
      localStorage.setItem('admin_token', ADMIN_TOKEN);
      $('#login-modal').style.display = 'none';
      adminToast('Painel administrativo autenticado com sucesso!', 'success');
      initDashboard();
    } else {
      adminToast(data.error || 'Senha incorreta.', 'danger');
    }
  } catch (e) {
    adminToast('Erro de conexão ao autenticar.', 'danger');
  }
};

window.logout = function() {
  localStorage.removeItem('admin_token');
  location.reload();
};

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-token': ADMIN_TOKEN
  };
}

// Inicialização Geral do Painel
async function initDashboard() {
  initWebSocket();
  await loadStoreStatus();
  await loadOrders();
  await loadCategories();
  await loadProducts();
  await loadAccompaniments();
  await loadExtras();
  await loadCoupons();
  await loadPrinters();
  await loadSalesReport({ period: 'today' });
  await loadChatConversations();
  bindNavigation();
}

// Conexão WebSocket para Atualizações em Tempo Real
function initWebSocket() {
  try {
    WS = new WebSocket(WS_URL);
    WS.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'NEW_ORDER') {
          playNotificationChime();
          ORDERS.unshift(data.payload);
          renderKanban();
          updateOrdersBadge();
          loadSalesReport({ period: $('#report-period-select')?.value || 'today' });
        }
        if (data.event === 'ORDER_STATUS_CHANGED') {
          const idx = ORDERS.findIndex(o => o.id === data.payload.id);
          if (idx !== -1) {
            ORDERS[idx] = data.payload;
            renderKanban();
          }
          loadSalesReport({ period: $('#report-period-select')?.value || 'today' });
        }
        if (data.event === 'CHAT_MESSAGE') {
          playNotificationChime();
          loadChatConversations();
          if (ACTIVE_CHAT_PHONE === data.payload.customerPhone) {
            loadChatMessages(ACTIVE_CHAT_PHONE);
          }
        }
        if (data.event === 'PRINT_JOB') {
          executeBrowserPrint(data.payload.ticketText);
        }
      } catch (e) {}
    };
    WS.onclose = () => setTimeout(initWebSocket, 4000);
  } catch (err) {
    console.warn('WebSocket indisponível.');
  }
}

// Navegação entre Abas
function bindNavigation() {
  const tabs = $$('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      $$('.tab-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = $(`#${tab.dataset.tab}`);
      if (targetPane) targetPane.classList.add('active');

      if (tab.dataset.tab === 'tab-chat') {
        loadChatConversations().then(() => {
          if (!ACTIVE_CHAT_PHONE && CHAT_CONVERSATIONS.length > 0) {
            selectChat(CHAT_CONVERSATIONS[0].customerPhone, CHAT_CONVERSATIONS[0].customerName);
          }
          const inp = $('#admin-chat-input');
          if (inp) inp.focus();
        });
      }
    });
  });
}

// ==================== STATUS & CONFIGURAÇÕES DA LOJA ====================
async function loadStoreStatus() {
  try {
    const res = await fetch(`${API_URL}/store/status`);
    const data = await res.json();
    if (data.ok) {
      const sw = $('#store-toggle-switch');
      const label = $('#store-toggle-label');
      if (sw) sw.checked = data.isOpen;
      if (label) {
        label.textContent = data.isOpen ? 'Loja ABERTA' : 'Loja FECHADA';
        label.style.color = data.isOpen ? 'var(--green)' : 'var(--danger)';
      }
    }

    const setRes = await fetch(`${API_URL}/store/settings`);
    const setData = await setRes.json();
    if (setData.ok) {
      SETTINGS = setData.settings;
      renderStoreSettingsForm();
    }
  } catch (e) {}
}

window.toggleStoreStatus = async function() {
  const sw = $('#store-toggle-switch');
  const label = $('#store-toggle-label');
  try {
    const res = await fetch(`${API_URL}/store/toggle-status`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ isOpen: sw.checked })
    });
    const data = await res.json();
    if (data.ok) {
      label.textContent = data.isOpen ? 'Loja ABERTA' : 'Loja FECHADA';
      label.style.color = data.isOpen ? 'var(--green)' : 'var(--danger)';
      adminToast(data.isOpen ? 'A loja agora está ABERTA para receber pedidos!' : 'A loja foi FECHADA.', data.isOpen ? 'success' : 'info');
    }
  } catch (e) {
    adminToast('Erro ao atualizar status da loja.', 'danger');
  }
};

function renderStoreSettingsForm() {
  if ($('#st-perkm')) $('#st-perkm').value = SETTINGS.perKmRate !== undefined ? SETTINGS.perKmRate : 1.0;
  if ($('#st-minfreight')) $('#st-minfreight').value = SETTINGS.minFreight !== undefined ? SETTINGS.minFreight : 4.5;
  if ($('#st-freekm')) $('#st-freekm').value = SETTINGS.freeKmThreshold !== undefined ? SETTINGS.freeKmThreshold : 2.0;
  if ($('#st-chatsender')) $('#st-chatsender').value = SETTINGS.chatSenderName || 'Delivery';
  if ($('#st-banner')) $('#st-banner').value = SETTINGS.bannerPromo || '';
  if ($('#st-wpp')) $('#st-wpp').value = SETTINGS.wpp || '';
  if ($('#st-address')) $('#st-address').value = SETTINGS.address || '';
}

window.saveStoreSettings = async function(e) {
  if (e) e.preventDefault();
  const updates = {
    perKmRate: parseFloat($('#st-perkm').value) || 1.0,
    minFreight: parseFloat($('#st-minfreight').value) || 4.5,
    freeKmThreshold: parseFloat($('#st-freekm').value) >= 0 ? parseFloat($('#st-freekm').value) : 2.0,
    chatSenderName: $('#st-chatsender') ? $('#st-chatsender').value.trim() || 'Delivery' : 'Delivery',
    bannerPromo: $('#st-banner').value.trim(),
    wpp: $('#st-wpp').value.trim(),
    address: $('#st-address').value.trim()
  };

  try {
    const res = await fetch(`${API_URL}/store/settings`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (data.ok) {
      SETTINGS = data.settings;
      renderStoreSettingsForm();
      adminToast('Configurações da loja salvas com sucesso!', 'success');
    }
  } catch (e) {
    adminToast('Falha ao salvar configurações.', 'danger');
  }
};

window.saveNewAdminPassword = async function(e) {
  if (e) e.preventDefault();
  const curPass = $('#adm-cur-pass')?.value;
  const newPass = $('#adm-new-pass')?.value;
  const confPass = $('#adm-conf-pass')?.value;

  if (!curPass || !newPass) {
    adminToast('Preencha a senha atual e a nova senha.', 'danger');
    return;
  }
  if (newPass.length < 4) {
    adminToast('A nova senha deve ter pelo menos 4 caracteres.', 'danger');
    return;
  }
  if (newPass !== confPass) {
    adminToast('A confirmação da nova senha não confere.', 'danger');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/change-password`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ currentPassword: curPass, newPassword: newPass })
    });
    const data = await res.json();
    if (data.ok) {
      ADMIN_TOKEN = newPass;
      sessionStorage.setItem('explosao_admin_token', newPass);
      if ($('#adm-cur-pass')) $('#adm-cur-pass').value = '';
      if ($('#adm-new-pass')) $('#adm-new-pass').value = '';
      if ($('#adm-conf-pass')) $('#adm-conf-pass').value = '';
      adminToast('Senha do painel administrativo alterada com sucesso!', 'success');
    } else {
      adminToast(data.error || 'Erro ao alterar senha.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao alterar senha.', 'danger');
  }
};

// ==================== PEDIDOS & KANBAN (PRODUÇÃO & LOGÍSTICA) ====================
async function loadOrders() {
  try {
    const res = await fetch(`${API_URL}/orders`);
    const data = await res.json();
    if (data.ok) {
      ORDERS = data.orders;
      renderKanban();
      updateOrdersBadge();
    }
  } catch (e) {}
}

function updateOrdersBadge() {
  const pendingCount = ORDERS.filter(o => o.status === 'received').length;
  const badge = $('#badge-pending-orders');
  if (badge) {
    badge.textContent = pendingCount;
    badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }
}

const KANBAN_PAGE = {
  received: 1,
  preparing: 1,
  ready: 1,
  delivered: 1
};
const KANBAN_PER_PAGE = 3;

window.setKanbanPage = function(column, page) {
  KANBAN_PAGE[column] = page;
  renderKanban();
};

function renderKanban() {
  const colReceived = $('#cards-received');
  if (!colReceived) return;

  const q = ($('#kanban-search')?.value || '').trim().toLowerCase();
  const stFilter = $('#kanban-status-filter')?.value || 'all';
  const payFilter = $('#kanban-pay-filter')?.value || 'all';

  const filteredOrders = ORDERS.filter(order => {
    // Busca por número, cliente ou telefone
    if (q) {
      const matchNo = String(order.orderNo || '').toLowerCase().includes(q.replace('#', ''));
      const matchName = String(order.customer?.name || '').toLowerCase().includes(q);
      const matchPhone = String(order.customer?.phone || '').includes(q);
      if (!matchNo && !matchName && !matchPhone) return false;
    }

    // Filtro de status
    if (stFilter !== 'all') {
      if (stFilter === 'received' && order.status !== 'received') return false;
      if (stFilter === 'preparing' && order.status !== 'preparing') return false;
      if (stFilter === 'ready' && order.status !== 'ready' && order.status !== 'out_for_delivery') return false;
      if (stFilter === 'delivered' && order.status !== 'delivered') return false;
      if (stFilter === 'cancelled' && order.status !== 'cancelled') return false;
    }

    // Filtro de pagamento
    if (payFilter !== 'all') {
      const isApproved = order.payment?.status === 'approved';
      const isDeliveryPayment = order.payment?.timing === 'delivery' || order.payment?.method === 'Dinheiro';
      if (payFilter === 'approved' && !isApproved) return false;
      if (payFilter === 'waiting' && (isApproved || isDeliveryPayment)) return false;
      if (payFilter === 'delivery' && !isDeliveryPayment) return false;
    }

    return true;
  });

  const ordersReceived = filteredOrders.filter(o => o.status === 'received');
  const ordersPreparing = filteredOrders.filter(o => o.status === 'preparing');
  const ordersReady = filteredOrders.filter(o => o.status === 'ready' || o.status === 'out_for_delivery');
  const ordersDelivered = filteredOrders.filter(o => o.status === 'delivered');

  renderKanbanColumn('received', ordersReceived, 'cards-received', 'cards-received-pagination', 'col-header-received', 'Novos Pedidos');
  renderKanbanColumn('preparing', ordersPreparing, 'cards-preparing', 'cards-preparing-pagination', 'col-header-preparing', 'Em Preparo (Cozinha)');
  renderKanbanColumn('ready', ordersReady, 'cards-ready', 'cards-ready-pagination', 'col-header-ready', 'Pronto / Saiu para Entrega');
  renderKanbanColumn('delivered', ordersDelivered, 'cards-delivered', 'cards-delivered-pagination', 'col-header-delivered', 'Entregues (Concluídos)');
}

function renderKanbanColumn(colKey, list, containerId, paginationId, headerId, title) {
  const container = $(`#${containerId}`);
  const paginationBox = $(`#${paginationId}`);
  const header = $(`#${headerId}`);

  if (header) {
    header.innerHTML = `${title} <span style="font-size:11px;opacity:0.85;background:rgba(255,255,255,0.12);padding:1px 7px;border-radius:99px;margin-left:4px;color:#fff">${list.length}</span>`;
  }
  if (!container) return;

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / KANBAN_PER_PAGE));
  if (KANBAN_PAGE[colKey] > totalPages) KANBAN_PAGE[colKey] = totalPages;
  if (KANBAN_PAGE[colKey] < 1) KANBAN_PAGE[colKey] = 1;

  const curPage = KANBAN_PAGE[colKey];
  const start = (curPage - 1) * KANBAN_PER_PAGE;
  const pageOrders = list.slice(start, start + KANBAN_PER_PAGE);

  container.innerHTML = pageOrders.length === 0
    ? `<div style="color:var(--mut);text-align:center;padding:24px 10px;font-size:12px">Nenhum pedido</div>`
    : pageOrders.map(o => createOrderCardHtml(o)).join('');

  if (paginationBox) {
    if (totalPages > 1) {
      paginationBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;margin-top:6px;border-top:1px solid var(--ln);font-size:11px;color:var(--tx)">
          <button class="btn-sm btn-secondary" style="padding:3px 8px;font-size:11px" onclick="setKanbanPage('${colKey}', ${curPage - 1})" ${curPage <= 1 ? 'disabled' : ''}>◀ Anterior</button>
          <span>Pág. <b>${curPage}</b> de <b>${totalPages}</b> (${total})</span>
          <button class="btn-sm btn-secondary" style="padding:3px 8px;font-size:11px" onclick="setKanbanPage('${colKey}', ${curPage + 1})" ${curPage >= totalPages ? 'disabled' : ''}>Próximo ▶</button>
        </div>
      `;
      paginationBox.style.display = 'block';
    } else {
      paginationBox.innerHTML = '';
      paginationBox.style.display = 'none';
    }
  }
}

function createOrderCardHtml(order) {
  const isMoney = order.payment?.method === 'Dinheiro';
  const isDeliveryPayment = order.payment?.timing === 'delivery' || isMoney;
  const isApproved = order.payment?.status === 'approved';
  // Regra de impressão: dinheiro ou cartão na entrega imprime na hora; online só após aprovado pelo banco
  const canPrint = isDeliveryPayment || isApproved;
  const hasTroco = isMoney && order.payment?.trocoValue > 0;
  const isDelivery = order.delivery?.type === 'delivery';

  let nextAction = '';
  if (order.status === 'received') {
    nextAction = `<button class="btn-sm btn-next" onclick="advanceOrderStatus('${order.id}', 'preparing')">Mandar p/ Cozinha</button>`;
  } else if (order.status === 'preparing') {
    nextAction = isDelivery 
      ? `<button class="btn-sm btn-next" onclick="advanceOrderStatus('${order.id}', 'out_for_delivery')">Despachar Entrega</button>`
      : `<button class="btn-sm btn-next" style="background:#10b981;color:#fff;font-weight:700" onclick="confirmPickupOrder('${order.id}')">✓ Entregar no Balcão & Confirmar</button>`;
  } else if (order.status === 'out_for_delivery' || order.status === 'ready') {
    nextAction = isDelivery
      ? `<button class="btn-sm btn-next" onclick="advanceOrderStatus('${order.id}', 'delivered')">Concluir Pedido</button>`
      : `<button class="btn-sm btn-next" style="background:#10b981;color:#fff;font-weight:700" onclick="confirmPickupOrder('${order.id}')">✓ Entregar no Balcão & Confirmar</button>`;
  }

  // Identificação clara da forma e timing do pagamento
  let paymentBadgeHtml = '';
  if (order.status === 'delivered') {
    const payMethod = order.payment?.method ? order.payment.method.toUpperCase() : 'PAGO';
    paymentBadgeHtml = `
      <div class="payment-approved" style="background:#064e3b;color:#a7f3d0;border:1px solid #10b981;font-weight:700;padding:6px 10px;border-radius:8px">
        ✓ PEDIDO FINALIZADO & PAGO (${payMethod})
      </div>
    `;
  } else if (order.status === 'cancelled') {
    paymentBadgeHtml = `
      <div class="troco-alert" style="background:#450a0a;color:#fca5a5;border:1px solid #ef4444;padding:6px 10px;border-radius:8px">
        ✕ PEDIDO CANCELADO ${order.cancellationReason ? `(${esc(order.cancellationReason)})` : ''}
      </div>
    `;
  } else if (isDelivery) {
    if (isDeliveryPayment) {
      if (isMoney) {
        paymentBadgeHtml = `<div class="troco-alert" style="background:#064e3b;color:#a7f3d0">COBRAR NA ENTREGA: DINHEIRO ${hasTroco ? `(LEVAR TROCO DE ${R(order.payment.trocoValue)})` : '(VALOR EXATO)'}</div>`;
      } else {
        paymentBadgeHtml = `<div class="troco-alert" style="background:#3b115b;color:var(--y)">COBRAR NA ENTREGA: LEVAR MAQUININHA (${order.payment?.method.toUpperCase()})</div>`;
      }
    } else {
      if (isApproved) {
        paymentBadgeHtml = `<div class="payment-approved">PAGAMENTO ONLINE CONFIRMADO (${order.payment?.method.toUpperCase()})</div>`;
      } else {
        paymentBadgeHtml = `
          <div class="payment-waiting">
            AGUARDANDO CONFIRMAÇÃO DO BANCO (${order.payment?.method})
            <button class="btn-sm btn-secondary" style="margin-top:4px;font-size:10px;padding:3px 8px;width:100%" onclick="simulateBankApproval('${order.id}')">Confirmar Pagamento</button>
          </div>
        `;
      }
    }
  } else {
    // Retirada no Balcão
    if (isApproved) {
      paymentBadgeHtml = `<div class="payment-approved">RETIRADA NO BALCÃO: PAGAMENTO JÁ CONFIRMADO (${order.payment?.method.toUpperCase()})</div>`;
    } else if (isMoney) {
      paymentBadgeHtml = `<div class="troco-alert" style="background:#064e3b;color:#a7f3d0">RETIRADA NO BALCÃO: RECEBER EM DINHEIRO ${hasTroco ? `(LEVAR TROCO DE ${R(order.payment.trocoValue)})` : '(VALOR EXATO)'}</div>`;
    } else {
      paymentBadgeHtml = `
        <div class="troco-alert" style="background:#3b115b;color:var(--y)">
          RETIRADA NO BALCÃO: RECEBER NO BALCÃO (${order.payment?.method.toUpperCase()})
          <button class="btn-sm btn-secondary" style="margin-top:4px;font-size:10px;padding:3px 8px;width:100%" onclick="simulateBankApproval('${order.id}')">Confirmar Pagamento</button>
        </div>
      `;
    }
  }

  return `
    <div class="order-card" id="card-${order.id}">
      <div class="order-card-head">
        <b style="font-size:16px;color:var(--y)">#${order.orderNo}</b>
        <span class="order-badge ${order.payment?.method === 'Pix' ? 'pix' : (isMoney ? 'money' : 'card')}">
          ${order.payment?.method}
        </span>
      </div>

      ${paymentBadgeHtml}

      <div style="font-weight:600;font-size:14px;margin-top:6px">
        Cliente: ${esc(order.customer.name)} 
        <a href="https://wa.me/55${order.customer.phone}" target="_blank" style="color:var(--green);text-decoration:none;font-size:12px;margin-left:4px">WhatsApp</a>
      </div>

      ${isDelivery ? `
        <div style="font-size:12px;color:var(--mut)">
          Entrega: ${esc(order.delivery.street)}, ${esc(order.delivery.number)} — ${esc(order.delivery.bairro)} (${(order.delivery.km || 0).toFixed(1)} km)
        </div>
      ` : `
        <div style="font-size:12px;color:var(--y);font-weight:700">📍 Retirada no Balcão da Loja</div>
      `}

      <!-- Resumo dos Itens e Acompanhamentos -->
      <div class="order-items-summary">
        ${order.items.map(it => `
          <div><b>${it.quantity}x</b> ${esc(it.name)}</div>
          ${it.accompaniments?.length ? `<div style="font-size:11px;color:var(--mut)">• Acomp: ${esc(it.accompaniments.join(', '))}</div>` : ''}
          ${it.extras?.length ? `<div style="font-size:11px;color:var(--y)">• Extras: ${esc(it.extras.join(', '))}</div>` : ''}
          ${it.note ? `<div style="font-size:11px;color:var(--danger)">Obs: ${esc(it.note)}</div>` : ''}
        `).join('')}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:15px;margin-top:4px">
        <span>Total a Cobrar:</span>
        <span style="color:var(--green)">${R(order.total)}</span>
      </div>

      <!-- Ações de Impressão e Status -->
      <div class="order-actions" style="flex-wrap:wrap;gap:6px">
        ${order.status !== 'delivered' ? `
          <button class="btn-sm btn-print" ${!canPrint ? 'disabled title="Impressão bloqueada até confirmação bancária do pagamento"' : ''} onclick="printOrderStation('${order.id}', 'kitchen')">
            Imprimir Cozinha
          </button>
        ` : ''}
        <button class="btn-sm btn-print" ${!canPrint ? 'disabled title="Impressão bloqueada até confirmação bancária do pagamento"' : ''} onclick="printOrderStation('${order.id}', 'counter')">
          ${order.status === 'delivered' ? 'Reimprimir Comanda' : 'Imprimir Balcão'}
        </button>
        ${nextAction}
        ${(order.status !== 'delivered' && order.status !== 'cancelled') ? (
          isDelivery ? `
            <button class="btn-sm" style="background:#10b981;color:#fff;font-weight:700;font-size:11px;padding:4px 8px" onclick="confirmOrderDeliveryAndPayment('${order.id}')" title="Confirmar que o cliente recebeu e o pagamento foi concluído">
              ✓ Entregue & Recebido
            </button>
            <button class="btn-sm btn-secondary" style="font-size:10px;padding:4px 6px" onclick="copyMotoboyLink('${order.id}')" title="Copiar link para o celular do entregador">
              📱 Link Motoboy
            </button>
          ` : `
            ${order.status === 'received' ? `
              <button class="btn-sm" style="background:#10b981;color:#fff;font-weight:700;font-size:11px;padding:4px 8px" onclick="confirmPickupOrder('${order.id}')" title="Marcar como Pago e Retirado pelo Cliente no Balcão">
                ✓ Entregar no Balcão & Confirmar
              </button>
            ` : ''}
          `
        ) : ''}
        ${(order.status !== 'delivered' && order.status !== 'cancelled') ? `
          <button class="btn-sm btn-danger" style="margin-left:auto;font-size:11px;padding:4px 8px" onclick="openCancelOrderModal('${order.id}', '${order.orderNo}')" title="Cancelar este pedido">
            Cancelar
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

window.openCancelOrderModal = function(orderId, orderNo) {
  if ($('#cancel-order-id')) $('#cancel-order-id').value = orderId;
  if ($('#cancel-modal-title')) $('#cancel-modal-title').textContent = `Cancelar Pedido #${orderNo}`;
  if ($('#cancel-order-reason')) $('#cancel-order-reason').selectedIndex = 0;
  if ($('#cancel-order-obs')) $('#cancel-order-obs').value = '';
  const modal = $('#cancel-order-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeCancelOrderModal = function() {
  const modal = $('#cancel-order-modal');
  if (modal) modal.style.display = 'none';
};

window.confirmCancelOrder = async function(e) {
  if (e) e.preventDefault();
  const orderId = $('#cancel-order-id')?.value;
  const reasonVal = $('#cancel-order-reason')?.value || 'Cancelado pelo administrador';
  const obs = $('#cancel-order-obs')?.value.trim();
  const fullReason = obs ? `${reasonVal} - ${obs}` : reasonVal;

  try {
    const res = await fetch(`${API_URL}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'cancelled', reason: fullReason })
    });
    const data = await res.json();
    if (data.ok) {
      closeCancelOrderModal();
      const idx = ORDERS.findIndex(o => o.id === orderId);
      if (idx !== -1) ORDERS[idx] = data.order;
      renderKanban();
      updateOrdersBadge();
      const periodSelect = $('#report-period-select');
      loadSalesReport({ period: periodSelect ? periodSelect.value : 'today' });
      adminToast(`Pedido #${data.order.orderNo} cancelado com sucesso.`, 'info');
    } else {
      adminToast(data.error || 'Erro ao cancelar pedido.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao cancelar pedido.', 'danger');
  }
};

window.advanceOrderStatus = async function(orderId, newStatus) {
  try {
    const res = await fetch(`${API_URL}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.ok) {
      const idx = ORDERS.findIndex(o => o.id === orderId);
      if (idx !== -1) ORDERS[idx] = data.order;
      renderKanban();
      updateOrdersBadge();
      adminToast(`Status do Pedido #${data.order.orderNo} atualizado!`, 'info');
    }
  } catch (e) {
    adminToast('Erro ao atualizar status.', 'danger');
  }
};

window.simulateBankApproval = async function(orderId) {
  try {
    const res = await fetch(`${API_URL}/test/simulate-payment/${orderId}`, {
      method: 'POST',
      headers: authHeaders()
    });
    const data = await res.json();
    if (data.ok) {
      adminToast('Pagamento confirmado com sucesso!', 'success');
      await loadOrders();
    }
  } catch (e) {
    adminToast('Falha ao confirmar pagamento.', 'danger');
  }
};
window.confirmPayment = window.simulateBankApproval;

// ==================== MODAL UNIVERSAL DE CONFIRMAÇÃO ====================
let CONFIRM_MODAL_CALLBACK = null;
window.showConfirmModal = function({ icon = '⚠️', title = 'Confirmar Ação', message = '', btnText = 'Confirmar', btnClass = 'btn-next', onConfirm }) {
  if ($('#confirm-modal-icon')) $('#confirm-modal-icon').textContent = icon;
  if ($('#confirm-modal-title')) $('#confirm-modal-title').textContent = title;
  if ($('#confirm-modal-message')) $('#confirm-modal-message').innerHTML = message;
  const okBtn = $('#confirm-modal-btn-ok');
  if (okBtn) {
    okBtn.textContent = btnText;
    okBtn.className = `btn-sm ${btnClass}`;
    okBtn.onclick = () => {
      closeConfirmModal();
      if (typeof CONFIRM_MODAL_CALLBACK === 'function') CONFIRM_MODAL_CALLBACK();
    };
  }
  CONFIRM_MODAL_CALLBACK = onConfirm;
  const m = $('#confirm-action-modal');
  if (m) m.style.display = 'flex';
};

window.closeConfirmModal = function() {
  const m = $('#confirm-action-modal');
  if (m) m.style.display = 'none';
  CONFIRM_MODAL_CALLBACK = null;
};

window.confirmOrderDeliveryAndPayment = function(orderId) {
  const ord = ORDERS.find(o => o.id === orderId);
  const orderNo = ord ? ord.orderNo : '';
  const customerName = ord ? ord.customer?.name : '';

  showConfirmModal({
    icon: '🛵',
    title: `Confirmar Entrega #${orderNo}`,
    message: `Confirmar que o pedido de <b>${esc(customerName)}</b> foi entregue pelo motoboy e o pagamento foi devidamente recebido?`,
    btnText: '✓ Sim, Finalizar Pedido',
    btnClass: 'btn-next',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API_URL}/orders/${orderId}/confirm-delivery`, {
          method: 'POST',
          headers: authHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          const idx = ORDERS.findIndex(o => o.id === orderId);
          if (idx !== -1) ORDERS[idx] = data.order;
          renderKanban();
          updateOrdersBadge();
          const periodSelect = $('#report-period-select');
          loadSalesReport({ period: periodSelect ? periodSelect.value : 'today' });
          adminToast(`Pedido #${data.order.orderNo} finalizado e pagamento confirmado!`, 'success');
        } else {
          adminToast(data.error || 'Erro ao confirmar entrega.', 'danger');
        }
      } catch (err) {
        adminToast('Erro de conexão ao confirmar entrega.', 'danger');
      }
    }
  });
};

window.confirmPickupOrder = function(orderId) {
  const ord = ORDERS.find(o => o.id === orderId);
  const orderNo = ord ? ord.orderNo : '';
  const customerName = ord ? ord.customer?.name : '';

  showConfirmModal({
    icon: '🛍️',
    title: `Concluir Retirada #${orderNo}`,
    message: `Confirmar que o cliente <b>${esc(customerName)}</b> retirou o pedido e o pagamento foi recebido no balcão da loja?`,
    btnText: '✓ Confirmar Retirada & Pagamento',
    btnClass: 'btn-next',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API_URL}/orders/${orderId}/confirm-delivery`, {
          method: 'POST',
          headers: authHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          const idx = ORDERS.findIndex(o => o.id === orderId);
          if (idx !== -1) ORDERS[idx] = data.order;
          renderKanban();
          updateOrdersBadge();
          const periodSelect = $('#report-period-select');
          loadSalesReport({ period: periodSelect ? periodSelect.value : 'today' });
          adminToast(`Pedido #${data.order.orderNo} retirado e pagamento concluído com sucesso!`, 'success');
        } else {
          adminToast(data.error || 'Erro ao concluir retirada.', 'danger');
        }
      } catch (err) {
        adminToast('Erro de conexão ao concluir retirada.', 'danger');
      }
    }
  });
};

window.copyMotoboyLink = function(orderId) {
  const ord = ORDERS.find(o => o.id === orderId);
  const orderNo = ord ? ord.orderNo : '';
  const customerName = ord ? ord.customer?.name : '';
  const link = `${location.origin}/motoboy.html?orderId=${orderId}&orderNo=${encodeURIComponent(orderNo)}&cliente=${encodeURIComponent(customerName)}`;
  const textToCopy = `🛵 *ENTREGA EXPLOSÃO AÇAÍ*\n📦 *Pedido:* #${orderNo}\n👤 *Cliente:* ${customerName}\n🔗 *Link da Entrega & Rota:* ${link}`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(() => {
      adminToast(`Link da entrega #${orderNo} (${customerName}) copiado com sucesso!`, 'success');
    }).catch(() => {
      prompt(`Link da entrega #${orderNo}:`, textToCopy);
    });
  } else {
    prompt(`Link da entrega #${orderNo}:`, textToCopy);
  }
};

// ==================== IMPRESSÃO TÉRMICA ====================
window.printOrderStation = async function(orderId, target) {
  try {
    const res = await fetch(`${API_URL}/orders/${orderId}/print`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ target })
    });
    const data = await res.json();
    if (data.ok && data.printJob) {
      executeBrowserPrint(data.printJob.ticketText);
    } else {
      adminToast(data.error || 'Não foi possível imprimir a comanda.', 'danger');
    }
  } catch (e) {
    adminToast('Erro ao gerar impressão da comanda.', 'danger');
  }
};

function executeBrowserPrint(text) {
  document.body.classList.remove('printing-report');
  document.body.classList.remove('printing-recipe');
  const printArea = $('#thermal-print-area');
  if (printArea) {
    printArea.innerHTML = `
      <div style="text-align:center;margin-bottom:8px">
        <img src="imagens/Logo.png" alt="Logo" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:1.5px solid #000;display:block;margin:0 auto 4px auto" onerror="this.style.display='none'">
        <div style="font-weight:900;font-size:15px;letter-spacing:0.5px">EXPLOSÃO AÇAÍ - DELIVERY</div>
      </div>
      <pre style="font-family:monospace;white-space:pre-wrap;margin:0;font-size:12px;line-height:1.35">${esc(text)}</pre>
    `;
    setTimeout(() => {
      window.print();
    }, 150);
  }
}

// ==================== RELATÓRIOS GERENCIAIS & EXPORTAÇÃO PDF ====================
window.handlePeriodSelectChange = function(val) {
  const dateBox = $('#date-range-box');
  if (val === 'custom') {
    if (dateBox) dateBox.style.display = 'flex';
  } else {
    if (dateBox) dateBox.style.display = 'none';
    loadSalesReport({ period: val });
  }
};

window.applyCustomDateFilter = function() {
  const start = $('#report-start-date')?.value;
  const end = $('#report-end-date')?.value;
  if (!start && !end) {
    return adminToast('Selecione ao menos uma data inicial ou final.', 'danger');
  }
  loadSalesReport({ period: 'custom', startDate: start, endDate: end });
};

window.loadSalesReport = async function(params = {}) {
  const period = typeof params === 'string' ? params : (params.period || 'today');
  let url = `${API_URL}/reports/sales?period=${period}`;
  if (params.startDate) url += `&startDate=${encodeURIComponent(params.startDate)}`;
  if (params.endDate) url += `&endDate=${encodeURIComponent(params.endDate)}`;

  try {
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    if (data.ok) {
      CURRENT_REPORT = data.report;
      renderReportDashboard(data.report);
    }
  } catch (e) {}
};

function renderReportDashboard(rep) {
  const sum = rep.summary;

  // Atualiza Cards de KPI
  if ($('#kpi-total-sales')) $('#kpi-total-sales').textContent = R(sum.totalNetSales);
  if ($('#kpi-freight')) $('#kpi-freight').textContent = R(sum.totalFreight);
  if ($('#kpi-discount')) $('#kpi-discount').textContent = R(sum.totalDiscount);
  if ($('#kpi-cancelled')) $('#kpi-cancelled').textContent = `${sum.cancelledOrdersCount || 0}`;
  if ($('#kpi-cancelled-sub')) $('#kpi-cancelled-sub').textContent = `${R(sum.cancelledTotal || 0)} cancelado`;
  if ($('#kpi-costs')) $('#kpi-costs').textContent = R(sum.totalCost);
  if ($('#kpi-profit')) {
    $('#kpi-profit').textContent = R(sum.grossProfit);
    $('#kpi-profit-margin').textContent = `Margem de Lucro: ${sum.profitMargin}%`;
  }
  if ($('#kpi-orders-count')) $('#kpi-orders-count').textContent = `${sum.ordersCount} pedidos`;
  if ($('#kpi-avg-ticket')) $('#kpi-avg-ticket').textContent = R(sum.averageTicket);
  if ($('#kpi-prep-time')) $('#kpi-prep-time').textContent = `${sum.averagePreparationTimeMinutes || 0} min`;
  if ($('#kpi-delivery-time')) $('#kpi-delivery-time').textContent = `${sum.averageDeliveryTimeMinutes || 0} min`;

  // Renderiza Gráficos Visuais de Mais e Menos Vendidos
  renderRankings(rep.bestSellers || [], rep.worstSellers || []);

  // Breakdown por Forma de Pagamento
  const payBox = $('#report-payments-breakdown');
  if (payBox) {
    const pb = rep.paymentBreakdown;
    payBox.innerHTML = Object.entries(pb).map(([method, val]) => `
      <div style="background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:12px">
        <div style="font-size:12px;color:var(--mut)">${method}</div>
        <div style="font-size:18px;font-weight:700;color:#fff">${R(val.total)}</div>
        <div style="font-size:11px;color:var(--mut)">${val.count} pedidos</div>
      </div>
    `).join('');
  }

  // Tabela Detalhada de Histórico com Filtros Aplicados
  applyReportTableFilters();
}

function getFilteredReportOrders(orders) {
  if (!orders || !orders.length) return [];
  const q = ($('#report-search-input')?.value || '').trim().toLowerCase();
  const st = $('#report-status-filter')?.value || 'all';
  const pay = $('#report-pay-filter')?.value || 'all';

  return orders.filter(o => {
    if (q) {
      const matchNo = String(o.orderNo || '').toLowerCase().includes(q.replace('#', ''));
      const matchName = String(o.customerName || '').toLowerCase().includes(q);
      if (!matchNo && !matchName) return false;
    }
    if (st !== 'all') {
      if (st === 'cancelled' && !o.isCancelled) return false;
      if (st === 'completed' && o.isCancelled) return false;
    }
    if (pay !== 'all') {
      const isDelivery = o.paymentTiming === 'delivery';
      if (pay === 'approved' && isDelivery) return false;
      if (pay === 'delivery' && !isDelivery) return false;
    }
    return true;
  });
}

window.applyReportTableFilters = function() {
  if (!CURRENT_REPORT) return;
  const tbody = $('#report-orders-table-body');
  if (!tbody) return;

  const filtered = getFilteredReportOrders(CURRENT_REPORT.orders || []);
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:18px;color:var(--mut)">Nenhum pedido encontrado para os filtros selecionados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(o => `
    <tr style="${o.isCancelled ? 'opacity:0.8;background:rgba(239,68,68,0.06)' : ''}">
      <td><b>#${o.orderNo}</b></td>
      <td>
        ${o.isCancelled 
          ? `<span class="order-badge danger" style="font-size:10px">Cancelado</span>${o.cancellationReason ? `<div style="font-size:10px;color:var(--danger);max-width:140px;line-height:1.2;margin-top:2px">${esc(o.cancellationReason)}</div>` : ''}` 
          : `<span class="order-badge success" style="font-size:10px">Concluído</span>`
        }
      </td>
      <td>${esc(o.customerName)}</td>
      <td>
        <span class="order-badge ${o.paymentMethod === 'Pix' ? 'pix' : (o.paymentMethod === 'Dinheiro' ? 'money' : 'card')}">
          ${o.paymentMethod}
        </span>
        <div style="font-size:11px;color:var(--mut)">${o.paymentTiming === 'delivery' ? 'Na Entrega' : 'Online'}</div>
      </td>
      <td>${o.deliveryType} (${esc(o.bairro)})</td>
      <td>${R(o.freight)}</td>
      <td><b>${R(o.total)}</b></td>
      <td>${R(o.costTotal)}</td>
      <td style="color:${o.profit >= 0 ? 'var(--green)' : 'var(--danger)'};font-weight:700">${R(o.profit)}</td>
      <td>${new Date(o.createdAt).toLocaleString('pt-BR')}</td>
    </tr>
  `).join('');
};

function renderRankings(bestSellers, worstSellers) {
  const bestBox = $('#ranking-best-sellers-list');
  const worstBox = $('#ranking-worst-sellers-list');

  const maxBestSold = bestSellers.length > 0 ? Math.max(...bestSellers.map(b => b.quantitySold), 1) : 1;
  const maxWorstSold = worstSellers.length > 0 ? Math.max(...worstSellers.map(w => w.quantitySold), 1) : 1;

  if (bestBox) {
    if (bestSellers.length === 0) {
      bestBox.innerHTML = `<p style="color:var(--mut);font-size:13px">Nenhum produto vendido no período.</p>`;
    } else {
      bestBox.innerHTML = bestSellers.map(item => {
        const percent = Math.round((item.quantitySold / maxBestSold) * 100);
        return `
          <div class="ranking-item">
            <img class="ranking-img" src="${item.image || 'imagens/Logo.png'}" alt="${esc(item.name)}" onerror="this.src='imagens/Logo.png'">
            <div class="ranking-info">
              <b>${esc(item.name)}</b>
              <div style="font-size:11px;color:var(--mut)">Faturamento: ${R(item.grossRevenue)} · Lucro: ${R(item.profit)} (${item.marginPercent}%)</div>
              <div class="ranking-bar-bg">
                <div class="ranking-bar-fill" style="width:${Math.max(percent, 8)}%"></div>
              </div>
            </div>
            <div class="ranking-metrics">
              <b>${item.quantitySold}</b>
              <div style="font-size:11px;color:var(--mut)">unidades</div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  if (worstBox) {
    if (worstSellers.length === 0) {
      worstBox.innerHTML = `<p style="color:var(--mut);font-size:13px">Nenhum produto cadastrado.</p>`;
    } else {
      worstBox.innerHTML = worstSellers.map(item => {
        const percent = Math.round((item.quantitySold / maxWorstSold) * 100);
        return `
          <div class="ranking-item">
            <img class="ranking-img" src="${item.image || 'imagens/Logo.png'}" alt="${esc(item.name)}" onerror="this.src='imagens/Logo.png'">
            <div class="ranking-info">
              <b>${esc(item.name)}</b>
              <div style="font-size:11px;color:var(--mut)">Faturamento: ${R(item.grossRevenue)} · Custo: ${R(item.totalCost)}</div>
              <div class="ranking-bar-bg">
                <div class="ranking-bar-fill worst" style="width:${Math.max(percent, 5)}%"></div>
              </div>
            </div>
            <div class="ranking-metrics">
              <b>${item.quantitySold}</b>
              <div style="font-size:11px;color:var(--mut)">unidades</div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Exportação em PDF Formatado A4
window.exportReportToPdf = function() {
  if (!CURRENT_REPORT) return adminToast('Nenhum relatório carregado.', 'danger');

  const rep = CURRENT_REPORT;
  const sum = rep.summary;
  const printArea = $('#report-pdf-area');

  let filterLabel = 'Todo o Histórico';
  if (rep.filter.period === 'today') filterLabel = 'Hoje (Dia)';
  else if (rep.filter.period === 'month') filterLabel = 'Este Mês';
  else if (rep.filter.period === 'year') filterLabel = 'Este Ano';
  else if (rep.filter.startDate || rep.filter.endDate) {
    filterLabel = `${rep.filter.startDate || 'Início'} até ${rep.filter.endDate || 'Fim'}`;
  }

  printArea.innerHTML = `
    <div style="border-bottom:2px solid #4b0f6b;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:14px">
        <img src="imagens/Logo.png" style="width:60px;height:60px;object-fit:cover;border-radius:50%">
        <div>
          <h1 style="margin:0;font-size:24px;color:#4b0f6b">EXPLOSÃO AÇAÍ</h1>
          <div style="font-size:14px;color:#333;font-weight:bold">Relatório Executivo de Vendas & Logística</div>
          <div style="font-size:12px;color:#666">Delivery Próprio · Franca - SP</div>
        </div>
      </div>
      <div style="text-align:right;font-size:12px;color:#444">
        <div><b>Data de Emissão:</b> ${new Date().toLocaleString('pt-BR')}</div>
        <div><b>Período Filtrado:</b> ${filterLabel}</div>
        <div><b>Pedidos Concluídos:</b> ${sum.ordersCount}</div>
      </div>
    </div>

    <!-- Indicadores Principais -->
    <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:10px;margin-bottom:20px">
      <div style="border:1.5px solid #e2d3f0;padding:10px;border-radius:8px;background:#fbf8fd">
        <div style="font-size:11px;color:#6b5280;font-weight:bold">FATURAMENTO LÍQUIDO</div>
        <div style="font-size:17px;font-weight:bold;color:#4b0f6b">${R(sum.totalNetSales)}</div>
      </div>
      <div style="border:1.5px solid #e2d3f0;padding:10px;border-radius:8px;background:#fbf8fd">
        <div style="font-size:11px;color:#6b5280;font-weight:bold">TAXAS DE ENTREGA</div>
        <div style="font-size:17px;font-weight:bold;color:#4b0f6b">${R(sum.totalFreight)}</div>
      </div>
      <div style="border:1.5px solid #e2d3f0;padding:10px;border-radius:8px;background:#fbf8fd">
        <div style="font-size:11px;color:#6b5280;font-weight:bold">CUSTO DE INSUMOS</div>
        <div style="font-size:17px;font-weight:bold;color:#666">${R(sum.totalCost)}</div>
      </div>
      <div style="border:1.5px solid #e2d3f0;padding:10px;border-radius:8px;background:#fbf8fd">
        <div style="font-size:11px;color:#6b5280;font-weight:bold">LUCRO BRUTO</div>
        <div style="font-size:17px;font-weight:bold;color:#166534">${R(sum.grossProfit)} (${sum.profitMargin}%)</div>
      </div>
      <div style="border:1.5px solid #fecaca;padding:10px;border-radius:8px;background:#fff5f5">
        <div style="font-size:11px;color:#991b1b;font-weight:bold">CANCELADOS</div>
        <div style="font-size:17px;font-weight:bold;color:#991b1b">${sum.cancelledOrdersCount || 0} (${R(sum.cancelledTotal || 0)})</div>
      </div>
    </div>

    <!-- Tempos Operacionais -->
    <div style="display:flex;gap:20px;background:#f4f4f4;padding:10px 14px;border-radius:8px;margin-bottom:20px;font-size:13px">
      <div><b>Tempo Médio de Preparo (Cozinha):</b> ${sum.averagePreparationTimeMinutes} min</div>
      <div><b>Tempo Médio de Entrega (Motoboy):</b> ${sum.averageDeliveryTimeMinutes} min</div>
      <div><b>Ticket Médio por Pedido:</b> ${R(sum.averageTicket)}</div>
    </div>

    <!-- Seção dos Produtos Mais Vendidos com Fotos -->
    <h3 style="margin:16px 0 8px;font-size:14px;color:#4b0f6b;text-transform:uppercase">Top Produtos Mais Vendidos (com Fotos)</h3>
    <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;margin-bottom:20px">
      ${(rep.bestSellers || []).slice(0, 6).map(it => `
        <div style="display:flex;align-items:center;gap:10px;border:1px solid #ddd;padding:8px;border-radius:6px">
          <img src="${it.image || 'imagens/Logo.png'}" style="width:40px;height:40px;object-fit:cover;border-radius:6px">
          <div style="flex:1;font-size:12px">
            <b>${esc(it.name)}</b>
            <div style="color:#555">Quantidade: <b>${it.quantitySold}</b> · Receita: ${R(it.grossRevenue)} · Lucro: ${R(it.profit)}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Tabela Detalhada de Pedidos -->
    <h3 style="margin:16px 0 8px;font-size:14px;color:#4b0f6b;text-transform:uppercase">Transações Detalhadas</h3>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead>
        <tr style="background:#f4f0fa;text-align:left">
          <th style="padding:6px;border:1px solid #ddd">Pedido</th>
          <th style="padding:6px;border:1px solid #ddd">Status</th>
          <th style="padding:6px;border:1px solid #ddd">Cliente</th>
          <th style="padding:6px;border:1px solid #ddd">Tipo</th>
          <th style="padding:6px;border:1px solid #ddd">Pagamento</th>
          <th style="padding:6px;border:1px solid #ddd">Frete</th>
          <th style="padding:6px;border:1px solid #ddd">Total</th>
          <th style="padding:6px;border:1px solid #ddd">Custo</th>
          <th style="padding:6px;border:1px solid #ddd">Lucro</th>
          <th style="padding:6px;border:1px solid #ddd">Data</th>
        </tr>
      </thead>
      <tbody>
        ${getFilteredReportOrders(rep.orders || []).map(o => `
          <tr style="${o.isCancelled ? 'background:#fff5f5;color:#666' : ''}">
            <td style="padding:6px;border:1px solid #ddd">#${o.orderNo}</td>
            <td style="padding:6px;border:1px solid #ddd">
              ${o.isCancelled ? '<b style="color:#b91c1c">Cancelado</b>' : '<b style="color:#15803d">Concluído</b>'}
            </td>
            <td style="padding:6px;border:1px solid #ddd">${esc(o.customerName)}</td>
            <td style="padding:6px;border:1px solid #ddd">${o.deliveryType}</td>
            <td style="padding:6px;border:1px solid #ddd">${o.paymentMethod} (${o.paymentTiming === 'delivery' ? 'Entrega' : 'Online'})</td>
            <td style="padding:6px;border:1px solid #ddd">${R(o.freight)}</td>
            <td style="padding:6px;border:1px solid #ddd;font-weight:bold">${R(o.total)}</td>
            <td style="padding:6px;border:1px solid #ddd">${R(o.costTotal)}</td>
            <td style="padding:6px;border:1px solid #ddd;color:${o.profit >= 0 ? '#166534' : '#991b1b'}">${R(o.profit)}</td>
            <td style="padding:6px;border:1px solid #ddd">${new Date(o.createdAt).toLocaleString('pt-BR')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.body.classList.remove('printing-recipe');
  document.body.classList.add('printing-report');
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-report');
    }, 1000);
  }, 150);
};

// ==================== GESTÃO DE PRODUTOS & FICHA TÉCNICA ====================
let CURRENT_RECIPE_PRODUCT = null;

async function loadProducts() {
  try {
    const res = await fetch(`${API_URL}/catalog`);
    const data = await res.json();
    if (data.ok) {
      PRODUCTS = data.products;
      renderProductsTable();
    }
  } catch (e) {}
}

let PRODUCTS_PAGE = 1;
let PRODUCTS_PER_PAGE = 10;

window.setProductsPage = function(page) {
  PRODUCTS_PAGE = page;
  renderProductsTable();
};

window.setProductsPerPage = function(perPage) {
  PRODUCTS_PER_PAGE = parseInt(perPage, 10);
  PRODUCTS_PAGE = 1;
  renderProductsTable();
};

function renderProductsTable() {
  const tbody = $('#products-table-body');
  const paginationBox = $('#products-pagination');
  if (!tbody) return;

  const total = PRODUCTS.length;
  const perPage = PRODUCTS_PER_PAGE || 10;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (PRODUCTS_PAGE > totalPages) PRODUCTS_PAGE = totalPages;
  if (PRODUCTS_PAGE < 1) PRODUCTS_PAGE = 1;

  const start = (PRODUCTS_PAGE - 1) * perPage;
  const pageProducts = PRODUCTS.slice(start, start + perPage);

  tbody.innerHTML = pageProducts.map(p => {
    let flags = [];
    if (p.isNewLaunch) flags.push('<span class="profit-badge" style="background:var(--y);color:#000">Lançamento</span>');
    if (p.isPromo) flags.push('<span class="loss-badge" style="background:var(--danger)">Promoção</span>');
    if (p.hasAnyLoss) flags.push('<span class="loss-badge">Prejuízo</span>');

    return `
      <tr>
        <td><img src="${p.image || 'imagens/do seu jeitinho.png'}" style="width:44px;height:44px;border-radius:10px;object-fit:cover"></td>
        <td>
          <b>${esc(p.name)}</b>
          <br><small style="color:var(--mut)">${esc(p.categorySlug || p.category)}</small>
        </td>
        <td>
          ${p.prices.map(pr => `
            <div style="font-size:12px;margin-bottom:2px">
              <b>${pr.size}ml:</b> Venda ${R(pr.price)} · Custo ${R(pr.costPrice)} (${pr.maxAccompaniments} acomp.)
              ${pr.isLoss ? `<span class="loss-badge">-${R(pr.lossAmount)}</span>` : `<span class="profit-badge">+${R(pr.margin)}</span>`}
            </div>
          `).join('')}
        </td>
        <td>${flags.join(' ') || '<span style="color:var(--mut);font-size:12px">Padrão</span>'}</td>
        <td>
          <button class="btn-sm ${p.active ? 'btn-next' : 'btn-secondary'}" onclick="toggleProductPause('${p.id}')">
            ${p.active ? 'Ativo' : 'Pausado'}
          </button>
        </td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-sm btn-print" onclick="openRecipeModal('${p.id}')" title="Ver ficha técnica com quantidades e exportar PDF">Receita & PDF</button>
            <button class="btn-sm btn-secondary" onclick="editProductModal('${p.id}')">Editar</button>
            <button class="btn-sm btn-danger" onclick="deleteProduct('${p.id}')">Excluir</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (paginationBox) {
    paginationBox.innerHTML = `
      <div style="font-size:13px;color:var(--mut)">
        Mostrando <b>${total === 0 ? 0 : start + 1} - ${Math.min(start + perPage, total)}</b> de <b>${total}</b> itens cadastrados
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <select onchange="setProductsPerPage(this.value)" style="padding:4px 8px;font-size:12px;border-radius:8px">
          <option value="10" ${perPage === 10 ? 'selected' : ''}>10 por página</option>
          <option value="25" ${perPage === 25 ? 'selected' : ''}>25 por página</option>
          <option value="50" ${perPage === 50 ? 'selected' : ''}>50 por página</option>
          <option value="999" ${perPage >= 999 ? 'selected' : ''}>Mostrar Todos (87+)</option>
        </select>
        <button class="btn-sm btn-secondary" onclick="setProductsPage(${PRODUCTS_PAGE - 1})" ${PRODUCTS_PAGE <= 1 ? 'disabled' : ''}>◀ Anterior</button>
        <span style="font-size:12px">Pág. <b>${PRODUCTS_PAGE}</b> de <b>${totalPages}</b></span>
        <button class="btn-sm btn-secondary" onclick="setProductsPage(${PRODUCTS_PAGE + 1})" ${PRODUCTS_PAGE >= totalPages ? 'disabled' : ''}>Próximo ▶</button>
      </div>
    `;
  }
}

// Modal de Ficha Técnica / Receita com Quantidades por Copo
window.openRecipeModal = function(productId) {
  const prod = PRODUCTS.find(p => p.id === productId);
  if (!prod) return;
  CURRENT_RECIPE_PRODUCT = prod;

  $('#recipe-prod-photo').src = prod.image || 'imagens/do seu jeitinho.png';
  $('#recipe-prod-name').textContent = prod.name;
  $('#recipe-prod-category').textContent = (prod.categorySlug || prod.category || 'Açaí').toUpperCase();
  $('#recipe-prod-desc').textContent = prod.description || 'Receita padronizada com pesagem e insumos para delivery.';

  const container = $('#recipe-tables-container');
  if (!container) return;

  const recipes = prod.recipes || [];
  if (recipes.length === 0) {
    container.innerHTML = `<p style="color:var(--mut);padding:14px">Nenhuma receita detalhada vinculada.</p>`;
  } else {
    container.innerHTML = recipes.map(rc => {
      const priceObj = (prod.prices || []).find(x => x.size === rc.size) || {};
      const venda = priceObj.price || 0;
      const custo = priceObj.costPrice || (rc.ingredients || []).reduce((acc, ig) => acc + (ig.totalCost || 0), 0);
      const lucro = venda - custo;
      const margem = venda > 0 ? Math.round((lucro / venda) * 100) : 0;

      return `
        <div style="background:var(--card);border:1px solid var(--ln);border-radius:14px;padding:16px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--ln);padding-bottom:10px;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <div>
              <b style="font-size:16px;color:var(--y)">Copo ${rc.size} ml</b>
              <span style="font-size:12px;color:var(--mut);margin-left:8px">(${priceObj.maxAccompaniments || 3} acomp. inclusos)</span>
            </div>
            <div style="font-size:13px;text-align:right">
              Venda: <b style="color:#fff">${R(venda)}</b> · Custo: <b style="color:var(--danger)">${R(custo)}</b> · 
              Lucro: <b style="color:var(--green)">${R(lucro)} (${margem}%)</b>
            </div>
          </div>

          <div class="table-responsive" style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box">
            <table class="recipe-table" style="font-size:11.5px;width:100%;min-width:0;box-sizing:border-box">
              <thead>
                <tr style="color:var(--mut);border-bottom:1px solid rgba(255,255,255,0.08)">
                  <th style="padding:4px 4px;text-align:left">Insumo</th>
                  <th style="padding:4px 4px;text-align:center">Qtd</th>
                  <th style="padding:4px 4px;text-align:right">Unitário</th>
                  <th style="padding:4px 4px;text-align:right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${(rc.ingredients || []).map(ig => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
                    <td style="padding:5px 4px;word-break:break-word">${esc(ig.name)}</td>
                    <td style="padding:5px 4px;text-align:center"><b>${ig.quantity} ${ig.unit}</b></td>
                    <td style="padding:5px 4px;text-align:right">${R(ig.unitCost)}</td>
                    <td style="padding:5px 4px;text-align:right;color:var(--y)">${R(ig.totalCost)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');
  }

  $('#recipe-modal').style.display = 'flex';
};

window.closeRecipeModal = function() {
  $('#recipe-modal').style.display = 'none';
};

window.exportRecipeToPdf = function() {
  if (!CURRENT_RECIPE_PRODUCT) return adminToast('Nenhum produto selecionado.', 'danger');

  const prod = CURRENT_RECIPE_PRODUCT;
  const printArea = $('#recipe-pdf-area');
  if (!printArea) return;

  const recipes = prod.recipes || [];

  printArea.innerHTML = `
    <div style="border-bottom:3px solid #4b0f6b;padding-bottom:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:16px">
        <img src="imagens/Logo.png" style="width:70px;height:70px;object-fit:cover;border-radius:50%" onerror="this.style.display='none'">
        <div>
          <h1 style="margin:0;font-size:26px;color:#4b0f6b;font-family:Arial,sans-serif">EXPLOSÃO AÇAÍ</h1>
          <div style="font-size:15px;color:#222;font-weight:bold">Ficha Técnica Operacional & Receituário de Insumos</div>
          <div style="font-size:12px;color:#666">Delivery Próprio · Franca - SP · Padrão de Qualidade & Lucratividade</div>
        </div>
      </div>
      <div style="text-align:right;font-size:12px;color:#444">
        <div><b>Data de Emissão:</b> ${new Date().toLocaleString('pt-BR')}</div>
        <div><b>Responsável Técnico:</b> Gestão Operacional</div>
        <div><b>Classificação:</b> Documento Interno de Produção</div>
      </div>
    </div>

    <!-- Banner do Produto com Foto em Destaque -->
    <div style="display:flex;gap:20px;align-items:center;background:#fbf8fd;border:1.5px solid #e2d3f0;border-radius:12px;padding:16px;margin-bottom:22px">
      <img src="${prod.image || 'imagens/do seu jeitinho.png'}" style="width:110px;height:110px;border-radius:10px;object-fit:cover;border:2px solid #4b0f6b">
      <div style="flex:1">
        <span style="background:#4b0f6b;color:#fff;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:4px;text-transform:uppercase">
          ${esc(prod.categorySlug || prod.category || 'Açaí')}
        </span>
        <h2 style="margin:6px 0 4px;font-size:22px;color:#222">${esc(prod.name)}</h2>
        <p style="margin:0;font-size:13px;color:#555;line-height:1.4">${esc(prod.description || 'Receita padronizada com insumos de alta qualidade.')}</p>
      </div>
    </div>

    <!-- Tabelas de Insumos por Tamanho (300ml, 500ml, 700ml) -->
    <h3 style="margin:16px 0 10px;font-size:16px;color:#4b0f6b;text-transform:uppercase;border-left:4px solid #4b0f6b;padding-left:8px">
      Composição e Proporções por Tamanho de Copo
    </h3>

    ${recipes.map(rc => {
      const priceObj = (prod.prices || []).find(x => x.size === rc.size) || {};
      const venda = priceObj.price || 0;
      const custo = priceObj.costPrice || (rc.ingredients || []).reduce((acc, ig) => acc + (ig.totalCost || 0), 0);
      const lucro = venda - custo;
      const margem = venda > 0 ? Math.round((lucro / venda) * 100) : 0;

      return `
        <div style="border:1.5px solid #ddd;border-radius:10px;padding:14px;margin-bottom:18px;background:#fff;page-break-inside:avoid">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;background:#f5f0fa;padding:8px 12px;border-radius:6px">
            <div>
              <b style="font-size:16px;color:#4b0f6b">Copo ${rc.size} ml</b>
              <span style="font-size:12px;color:#666;margin-left:6px">(${priceObj.maxAccompaniments || 3} acompanhamentos inclusos no valor)</span>
            </div>
            <div style="font-size:13px">
              Preço de Venda: <b>${R(venda)}</b> | Custo Insumos: <b>${R(custo)}</b> | Lucro Estimado: <b style="color:#166534">${R(lucro)} (${margem}%)</b>
            </div>
          </div>

          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#eae3f2;text-align:left">
                <th style="padding:6px 8px;border:1px solid #ccc">Insumo / Ingrediente</th>
                <th style="padding:6px 8px;border:1px solid #ccc;text-align:center">Quantidade / Peso</th>
                <th style="padding:6px 8px;border:1px solid #ccc;text-align:right">Custo Unitário</th>
                <th style="padding:6px 8px;border:1px solid #ccc;text-align:right">Custo Total</th>
              </tr>
            </thead>
            <tbody>
              ${(rc.ingredients || []).map(ig => `
                <tr>
                  <td style="padding:6px 8px;border:1px solid #ddd"><b>${esc(ig.name)}</b></td>
                  <td style="padding:6px 8px;border:1px solid #ddd;text-align:center">${ig.quantity} ${ig.unit}</td>
                  <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${R(ig.unitCost)}</td>
                  <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;font-weight:bold">${R(ig.totalCost)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }).join('')}

    <!-- Instruções Operacionais de Montagem -->
    <div style="border:1px solid #e0d0eb;background:#faf7fc;padding:12px 16px;border-radius:8px;margin-top:20px;font-size:12px;color:#444">
      <b style="color:#4b0f6b">Procedimento Padrão de Montagem e Boas Práticas:</b>
      <ul style="margin:6px 0 0;padding-left:20px;line-height:1.5">
        <li>Pesar a polpa em balança digital tarada para garantir a precisão das porções e evitar desperdício de insumos.</li>
        <li>Organizar os adicionais em camadas intermediárias e superiores para proporcionar uma apresentação visual irresistível.</li>
        <li>Manter a tampa bolha bem vedada e selar a sacola térmica para conservar a cremosidade e consistência durante o trajeto da entrega.</li>
      </ul>
    </div>
  `;

  document.body.classList.remove('printing-report');
  document.body.classList.add('printing-recipe');
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-recipe');
    }, 1000);
  }, 150);
};

window.toggleProductPause = async function(id) {
  try {
    const res = await fetch(`${API_URL}/catalog/products/${id}/toggle`, {
      method: 'PATCH',
      headers: authHeaders()
    });
    const data = await res.json();
    if (data.ok) {
      await loadProducts();
    }
  } catch (e) {}
};

window.openNewProductModal = function() {
  $('#prod-modal-title').textContent = 'Novo Produto';
  $('#p-id').value = '';
  $('#p-name').value = '';
  $('#p-desc').value = '';
  $('#p-is-launch').checked = false;
  $('#p-is-promo').checked = false;
  $('#p-img').value = 'imagens/do seu jeitinho.png';
  $('#p-photo-preview').src = 'imagens/do seu jeitinho.png';
  
  $('#p-price-300').value = '15.90';
  $('#p-cost-300').value = '6.80';
  $('#p-max-acomp-300').value = '3';

  $('#p-price-500').value = '19.90';
  $('#p-cost-500').value = '9.40';
  $('#p-max-acomp-500').value = '4';

  $('#p-price-700').value = '26.90';
  $('#p-cost-700').value = '12.50';
  $('#p-max-acomp-700').value = '5';

  $('#loss-alert-box').style.display = 'none';
  handleCategoryChange($('#p-category')?.value);
  $('#product-edit-modal').style.display = 'flex';
};

window.editProductModal = function(id) {
  const prod = PRODUCTS.find(p => p.id === id);
  if (!prod) return;

  $('#prod-modal-title').textContent = `Editar ${prod.name}`;
  $('#p-id').value = prod.id;
  $('#p-name').value = prod.name;
  $('#p-category').value = prod.categoryId || '';
  $('#p-is-launch').checked = !!prod.isNewLaunch;
  $('#p-is-promo').checked = !!prod.isPromo;
  $('#p-desc').value = prod.description || '';
  $('#p-img').value = prod.image || '';
  $('#p-photo-preview').src = prod.image || 'imagens/do seu jeitinho.png';

  const p300 = prod.prices.find(x => x.size === 300);
  const p500 = prod.prices.find(x => x.size === 500);
  const p700 = prod.prices.find(x => x.size === 700);

  $('#p-price-300').value = p300 ? p300.price : '';
  $('#p-cost-300').value = p300 ? p300.costPrice : '';
  $('#p-max-acomp-300').value = p300 ? p300.maxAccompaniments : '3';

  $('#p-price-500').value = p500 ? p500.price : '';
  $('#p-cost-500').value = p500 ? p500.costPrice : '';
  $('#p-max-acomp-500').value = p500 ? p500.maxAccompaniments : '4';

  $('#p-price-700').value = p700 ? p700.price : '';
  $('#p-cost-700').value = p700 ? p700.costPrice : '';
  $('#p-max-acomp-700').value = p700 ? p700.maxAccompaniments : '5';

  handleCategoryChange(prod.categoryId, prod.comboProductIds || []);
  checkFormPrejuizo();
  $('#product-edit-modal').style.display = 'flex';
};

window.closeProductModal = function() {
  $('#product-edit-modal').style.display = 'none';
};

window.handleCategoryChange = function(catId, selectedComboIds = []) {
  const cat = CATEGORIES.find(c => c.id === catId || c.slug === catId);
  const isCombo = cat && (cat.slug === 'combos' || cat.name.toLowerCase().includes('combo'));
  const comboSection = $('#combo-selection-section');
  const comboCheckboxes = $('#combo-products-checkboxes');

  if (isCombo && comboSection && comboCheckboxes) {
    comboSection.style.display = 'block';
    // Lista os copos de açaí individuais cadastrados para somar o custo no combo
    const individualProducts = PRODUCTS.filter(p => p.categorySlug !== 'combos');
    comboCheckboxes.innerHTML = individualProducts.map(p => {
      const isChecked = selectedComboIds.includes(p.id);
      const cost = p.prices && p.prices[0] ? p.prices[0].costPrice : 0;
      return `
        <label class="combo-check-item">
          <input type="checkbox" value="${p.id}" data-cost="${cost}" ${isChecked ? 'checked' : ''} onchange="recalculateComboCostFromCheckboxes()">
          <span>${esc(p.name)} (${R(cost)})</span>
        </label>
      `;
    }).join('');
  } else if (comboSection) {
    comboSection.style.display = 'none';
  }
};

window.recalculateComboCostFromCheckboxes = function() {
  const checkboxes = $$('#combo-products-checkboxes input[type="checkbox"]:checked');
  let totalComboCost = 0;
  checkboxes.forEach(cb => {
    totalComboCost += parseFloat(cb.dataset.cost || 0);
  });

  if (totalComboCost > 0) {
    $('#p-cost-500').value = totalComboCost.toFixed(2);
    checkFormPrejuizo();
  }
};

// Checagem em tempo real de prejuízo na edição do produto
window.checkFormPrejuizo = function() {
  const p300 = parseFloat($('#p-price-300').value) || 0;
  const c300 = parseFloat($('#p-cost-300').value) || 0;
  const p500 = parseFloat($('#p-price-500').value) || 0;
  const c500 = parseFloat($('#p-cost-500').value) || 0;
  const p700 = parseFloat($('#p-price-700').value) || 0;
  const c700 = parseFloat($('#p-cost-700').value) || 0;

  const box = $('#loss-alert-box');
  const losses = [];

  if (p300 > 0 && c300 > p300) losses.push(`Tamanho 300ml: Custo R$ ${c300.toFixed(2)} é MAIOR que Preço R$ ${p300.toFixed(2)} (Prejuízo de R$ ${(c300 - p300).toFixed(2)})`);
  if (p500 > 0 && c500 > p500) losses.push(`Tamanho 500ml: Custo R$ ${c500.toFixed(2)} é MAIOR que Preço R$ ${p500.toFixed(2)} (Prejuízo de R$ ${(c500 - p500).toFixed(2)})`);
  if (p700 > 0 && c700 > p700) losses.push(`Tamanho 700ml: Custo R$ ${c700.toFixed(2)} é MAIOR que Preço R$ ${p700.toFixed(2)} (Prejuízo de R$ ${(c700 - p700).toFixed(2)})`);

  if (losses.length > 0) {
    box.style.display = 'block';
    box.innerHTML = `<b>ALERTA DE PREJUÍZO DETECTADO:</b><br>${losses.join('<br>')}`;
  } else {
    box.style.display = 'none';
  }
};

// Upload de Foto do Computador com visualização imediata
window.uploadProductPhoto = async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch(`${API_URL}/upload`, {
      method: 'POST',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      body: formData
    });
    const data = await res.json();
    if (data.ok) {
      $('#p-img').value = data.filePath;
      $('#p-photo-preview').src = data.filePath;
      adminToast('Foto enviada com sucesso do seu computador!', 'success');
    } else {
      adminToast(data.error || 'Erro ao enviar foto.', 'danger');
    }
  } catch (e) {
    adminToast('Erro de conexão no upload da imagem.', 'danger');
  }
};

window.saveProductForm = async function(e) {
  if (e) e.preventDefault();
  const id = $('#p-id').value;
  const name = $('#p-name').value.trim();
  const categoryId = $('#p-category').value;
  const isNewLaunch = $('#p-is-launch').checked;
  const isPromo = $('#p-is-promo').checked;
  const description = $('#p-desc').value.trim();
  const image = $('#p-img').value.trim();

  if (!name) return adminToast('Informe o nome do produto.', 'danger');

  // Combo sub-products
  const comboCheckboxes = $$('#combo-products-checkboxes input[type="checkbox"]:checked');
  const comboProductIds = Array.from(comboCheckboxes).map(cb => cb.value);

  const prices = [];
  const pr300 = parseFloat($('#p-price-300').value);
  const cs300 = parseFloat($('#p-cost-300').value) || 0;
  const mx300 = parseInt($('#p-max-acomp-300').value) || 3;

  const pr500 = parseFloat($('#p-price-500').value);
  const cs500 = parseFloat($('#p-cost-500').value) || 0;
  const mx500 = parseInt($('#p-max-acomp-500').value) || 4;

  const pr700 = parseFloat($('#p-price-700').value);
  const cs700 = parseFloat($('#p-cost-700').value) || 0;
  const mx700 = parseInt($('#p-max-acomp-700').value) || 5;

  if (!isNaN(pr300)) prices.push({ size: 300, price: pr300, costPrice: cs300, maxAccompaniments: mx300, promoPrice: null });
  if (!isNaN(pr500)) prices.push({ size: 500, price: pr500, costPrice: cs500, maxAccompaniments: mx500, promoPrice: null });
  if (!isNaN(pr700)) prices.push({ size: 700, price: pr700, costPrice: cs700, maxAccompaniments: mx700, promoPrice: null });

  if (prices.length === 0) {
    prices.push({ size: 500, price: 25.00, costPrice: 10.00, maxAccompaniments: 4, promoPrice: null });
  }

  const payload = {
    name,
    categoryId,
    description,
    image,
    isNewLaunch,
    isPromo,
    comboProductIds,
    prices,
    active: true
  };

  try {
    let res;
    if (id) {
      res = await fetch(`${API_URL}/catalog/products/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(`${API_URL}/catalog/products`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
    }
    const data = await res.json();
    if (data.ok) {
      closeProductModal();
      await loadProducts();
      adminToast('Produto salvo com sucesso!', 'success');
    } else {
      adminToast(data.error || 'Erro ao salvar produto.', 'danger');
    }
  } catch (err) {
    adminToast('Erro ao salvar produto.', 'danger');
  }
};

window.deleteProduct = function(id) {
  const prod = PRODUCTS.find(p => p.id === id);
  const name = prod ? prod.name : 'este produto';

  showConfirmModal({
    icon: '🗑️',
    title: 'Excluir Produto',
    message: `Deseja realmente excluir <b>${esc(name)}</b> do cardápio?`,
    btnText: 'Excluir Produto',
    btnClass: 'btn-danger',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API_URL}/catalog/products/${id}`, {
          method: 'DELETE',
          headers: authHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          await loadProducts();
          adminToast('Produto excluído com sucesso!', 'info');
        } else {
          adminToast(data.error || 'Erro ao excluir.', 'danger');
        }
      } catch (e) {
        adminToast('Falha ao excluir produto.', 'danger');
      }
    }
  });
};

// ==================== GESTÃO DE ACOMPANHAMENTOS (CRUD COMPLETO) ====================
async function loadAccompaniments() {
  try {
    const res = await fetch(`${API_URL}/catalog/accompaniments`, { headers: authHeaders() });
    const data = await res.json();
    if (data.ok) {
      ACCOMPANIMENTS = data.accompaniments || [];
      renderAccompanimentsTable();
    }
  } catch (e) {}
}

let ACCOMPANIMENTS_PAGE = 1;
let ACCOMPANIMENTS_PER_PAGE = 10;

window.setAccompanimentsPage = function(page) {
  ACCOMPANIMENTS_PAGE = page;
  renderAccompanimentsTable();
};

window.setAccompanimentsPerPage = function(perPage) {
  ACCOMPANIMENTS_PER_PAGE = parseInt(perPage, 10);
  ACCOMPANIMENTS_PAGE = 1;
  renderAccompanimentsTable();
};

function renderAccompanimentsTable() {
  const tbody = $('#accompaniments-table-body');
  const paginationBox = $('#accompaniments-pagination');
  if (!tbody) return;

  const total = ACCOMPANIMENTS.length;
  const perPage = ACCOMPANIMENTS_PER_PAGE || 10;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (ACCOMPANIMENTS_PAGE > totalPages) ACCOMPANIMENTS_PAGE = totalPages;
  if (ACCOMPANIMENTS_PAGE < 1) ACCOMPANIMENTS_PAGE = 1;

  const start = (ACCOMPANIMENTS_PAGE - 1) * perPage;
  const pageItems = ACCOMPANIMENTS.slice(start, start + perPage);

  tbody.innerHTML = pageItems.map(ac => `
    <tr>
      <td><b>${esc(ac.name)}</b></td>
      <td>${R(ac.costPrice || 0.50)}</td>
      <td><span style="color:var(--mut);font-size:12px">Liberado para todos os açaís</span></td>
      <td>
        <button class="btn-sm ${ac.active ? 'btn-next' : 'btn-secondary'}" onclick="toggleAccompanimentActive('${ac.id}')">
          ${ac.active ? 'Ativo' : 'Inativo'}
        </button>
      </td>
      <td>
        <button class="btn-sm btn-print" onclick="openEditAccompanimentModal('${ac.id}')">Editar</button>
        <button class="btn-sm btn-danger" onclick="deleteAccompaniment('${ac.id}')">Excluir</button>
      </td>
    </tr>
  `).join('');

  if (paginationBox) {
    paginationBox.innerHTML = `
      <div style="font-size:13px;color:var(--mut)">
        Mostrando <b>${total === 0 ? 0 : start + 1} - ${Math.min(start + perPage, total)}</b> de <b>${total}</b> acompanhamentos
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <select onchange="setAccompanimentsPerPage(this.value)" style="padding:4px 8px;font-size:12px;border-radius:8px">
          <option value="10" ${perPage === 10 ? 'selected' : ''}>10 por página</option>
          <option value="25" ${perPage === 25 ? 'selected' : ''}>25 por página</option>
          <option value="50" ${perPage === 50 ? 'selected' : ''}>50 por página</option>
          <option value="999" ${perPage >= 999 ? 'selected' : ''}>Mostrar Todos</option>
        </select>
        <button class="btn-sm btn-secondary" onclick="setAccompanimentsPage(${ACCOMPANIMENTS_PAGE - 1})" ${ACCOMPANIMENTS_PAGE <= 1 ? 'disabled' : ''}>◀ Anterior</button>
        <span style="font-size:12px">Pág. <b>${ACCOMPANIMENTS_PAGE}</b> de <b>${totalPages}</b></span>
        <button class="btn-sm btn-secondary" onclick="setAccompanimentsPage(${ACCOMPANIMENTS_PAGE + 1})" ${ACCOMPANIMENTS_PAGE >= totalPages ? 'disabled' : ''}>Próximo ▶</button>
      </div>
    `;
  }
}

window.openNewAccompanimentModal = function() {
  $('#acomp-modal-title').textContent = 'Novo Acompanhamento';
  $('#acomp-id').value = '';
  $('#acomp-name').value = '';
  $('#acomp-cost').value = '0.50';
  $('#acomp-active').checked = true;
  $('#accompaniment-edit-modal').style.display = 'flex';
};

window.openEditAccompanimentModal = function(id) {
  const ac = ACCOMPANIMENTS.find(a => a.id === id);
  if (!ac) return;

  $('#acomp-modal-title').textContent = `Editar ${ac.name}`;
  $('#acomp-id').value = ac.id;
  $('#acomp-name').value = ac.name;
  $('#acomp-cost').value = ac.costPrice || 0.50;
  $('#acomp-active').checked = ac.active !== false;
  $('#accompaniment-edit-modal').style.display = 'flex';
};

window.closeAccompanimentModal = function() {
  $('#accompaniment-edit-modal').style.display = 'none';
};

window.saveAccompanimentForm = async function(e) {
  if (e) e.preventDefault();
  const id = $('#acomp-id').value;
  const name = $('#acomp-name').value.trim();
  const costPrice = parseFloat($('#acomp-cost').value) || 0.50;
  const active = $('#acomp-active').checked;

  if (!name) return adminToast('Informe o nome do acompanhamento.', 'danger');

  try {
    let res;
    if (id) {
      res = await fetch(`${API_URL}/catalog/accompaniments/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ name, costPrice, active })
      });
    } else {
      res = await fetch(`${API_URL}/catalog/accompaniments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, costPrice, active })
      });
    }
    const data = await res.json();
    if (data.ok) {
      closeAccompanimentModal();
      await loadAccompaniments();
      adminToast('Acompanhamento salvo com sucesso!', 'success');
    } else {
      adminToast(data.error || 'Erro ao salvar acompanhamento.', 'danger');
    }
  } catch (e) {
    adminToast('Erro ao salvar acompanhamento.', 'danger');
  }
};

window.toggleAccompanimentActive = async function(id) {
  const ac = ACCOMPANIMENTS.find(a => a.id === id);
  if (!ac) return;
  try {
    await fetch(`${API_URL}/catalog/accompaniments/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ active: !ac.active })
    });
    await loadAccompaniments();
  } catch (e) {}
};

window.deleteAccompaniment = function(id) {
  const ac = ACCOMPANIMENTS.find(a => a.id === id);
  const name = ac ? ac.name : 'este acompanhamento';

  showConfirmModal({
    icon: '🗑️',
    title: 'Excluir Acompanhamento',
    message: `Deseja realmente excluir <b>${esc(name)}</b>?`,
    btnText: 'Excluir',
    btnClass: 'btn-danger',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API_URL}/catalog/accompaniments/${id}`, {
          method: 'DELETE',
          headers: authHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          await loadAccompaniments();
          adminToast('Acompanhamento excluído!', 'info');
        } else {
          adminToast(data.error || 'Erro ao excluir.', 'danger');
        }
      } catch (e) {
        adminToast('Falha ao excluir acompanhamento.', 'danger');
      }
    }
  });
};

// ==================== GESTÃO DE CATEGORIAS (MODAL REAL SEM ALERT) ====================
async function loadCategories() {
  try {
    const res = await fetch(`${API_URL}/catalog/categories`, { headers: authHeaders() });
    const data = await res.json();
    if (data.ok) {
      CATEGORIES = data.categories;
      renderCategoriesList();
      populateCategorySelects();
    }
  } catch (e) {}
}

function renderCategoriesList() {
  const box = $('#categories-list');
  if (!box) return;

  box.innerHTML = CATEGORIES.map(c => `
    <div style="background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:12px 16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <b>${esc(c.name)}</b>
        <div style="font-size:12px;color:var(--mut)">Slug: ${esc(c.slug)} · Ordem: ${c.order}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-sm btn-secondary" onclick="openEditCategoryModal('${c.id}')">Editar</button>
        <button class="btn-sm btn-danger" onclick="deleteCategory('${c.id}')">Excluir</button>
      </div>
    </div>
  `).join('');
}

function populateCategorySelects() {
  const sel = $('#p-category');
  if (!sel) return;
  sel.innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

window.openNewCategoryModal = function() {
  $('#cat-modal-title').textContent = 'Nova Categoria';
  $('#cat-id').value = '';
  $('#cat-name').value = '';
  $('#cat-order').value = (CATEGORIES.length + 1);
  $('#category-edit-modal').style.display = 'flex';
};

window.openEditCategoryModal = function(id) {
  const cat = CATEGORIES.find(c => c.id === id);
  if (!cat) return;

  $('#cat-modal-title').textContent = `Editar Categoria: ${cat.name}`;
  $('#cat-id').value = cat.id;
  $('#cat-name').value = cat.name;
  $('#cat-order').value = cat.order || 1;
  $('#category-edit-modal').style.display = 'flex';
};

window.closeCategoryModal = function() {
  $('#category-edit-modal').style.display = 'none';
};

window.saveCategoryForm = async function(e) {
  if (e) e.preventDefault();
  const id = $('#cat-id').value;
  const name = $('#cat-name').value.trim();
  const order = parseInt($('#cat-order').value) || 1;

  if (!name) return adminToast('Informe o nome da categoria.', 'danger');

  try {
    let res;
    if (id) {
      res = await fetch(`${API_URL}/catalog/categories/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ name, order })
      });
    } else {
      res = await fetch(`${API_URL}/catalog/categories`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, order })
      });
    }
    const data = await res.json();
    if (data.ok) {
      closeCategoryModal();
      await loadCategories();
      adminToast(id ? 'Categoria atualizada com sucesso!' : 'Categoria criada com sucesso!', 'success');
    } else {
      adminToast(data.error || 'Erro ao salvar categoria.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao salvar categoria.', 'danger');
  }
};

window.deleteCategory = function(id) {
  const cat = CATEGORIES.find(c => c.id === id);
  const name = cat ? cat.name : 'esta categoria';

  showConfirmModal({
    icon: '🗑️',
    title: 'Excluir Categoria',
    message: `Deseja realmente excluir a categoria <b>${esc(name)}</b>?`,
    btnText: 'Excluir Categoria',
    btnClass: 'btn-danger',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API_URL}/catalog/categories/${id}`, {
          method: 'DELETE',
          headers: authHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          await loadCategories();
          adminToast('Categoria excluída com sucesso!', 'info');
        } else {
          adminToast(data.error || 'Erro ao excluir categoria.', 'danger');
        }
      } catch (e) {
        adminToast('Erro ao excluir categoria.', 'danger');
      }
    }
  });
};

// ==================== GESTÃO DE ADICIONAIS & EXTRAS ====================
async function loadExtras() {
  try {
    const res = await fetch(`${API_URL}/catalog`);
    const data = await res.json();
    if (data.ok) {
      EXTRAS = data.extras || [];
      renderExtrasTable();
    }
  } catch (e) {}
}

let EXTRAS_PAGE = 1;
let EXTRAS_PER_PAGE = 10;

window.setExtrasPage = function(page) {
  EXTRAS_PAGE = page;
  renderExtrasTable();
};

window.setExtrasPerPage = function(perPage) {
  EXTRAS_PER_PAGE = parseInt(perPage, 10);
  EXTRAS_PAGE = 1;
  renderExtrasTable();
};

function renderExtrasTable() {
  const tbody = $('#extras-table-body');
  const paginationBox = $('#extras-pagination');
  if (!tbody) return;

  const total = EXTRAS.length;
  const perPage = EXTRAS_PER_PAGE || 10;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (EXTRAS_PAGE > totalPages) EXTRAS_PAGE = totalPages;
  if (EXTRAS_PAGE < 1) EXTRAS_PAGE = 1;

  const start = (EXTRAS_PAGE - 1) * perPage;
  const pageItems = EXTRAS.slice(start, start + perPage);

  tbody.innerHTML = pageItems.map(e => `
    <tr>
      <td><b>${esc(e.name)}</b></td>
      <td>${R(e.price)}</td>
      <td>${R(e.costPrice || 0)}</td>
      <td>
        ${e.allowInAcai ? '<span class="profit-badge" style="margin-right:4px">Copos de Açaí</span>' : ''}
        ${e.allowInCombos ? '<span class="profit-badge">Combos</span>' : ''}
      </td>
      <td>${e.active ? '<span style="color:var(--green)">Ativo</span>' : '<span style="color:var(--danger)">Pausado</span>'}</td>
      <td>
        <button class="btn-sm btn-print" onclick="openEditExtraModal('${e.id}')">Editar</button>
        <button class="btn-sm btn-danger" onclick="deleteExtra('${e.id}')">Excluir</button>
      </td>
    </tr>
  `).join('');

  if (paginationBox) {
    paginationBox.innerHTML = `
      <div style="font-size:13px;color:var(--mut)">
        Mostrando <b>${total === 0 ? 0 : start + 1} - ${Math.min(start + perPage, total)}</b> de <b>${total}</b> adicionais
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <select onchange="setExtrasPerPage(this.value)" style="padding:4px 8px;font-size:12px;border-radius:8px">
          <option value="10" ${perPage === 10 ? 'selected' : ''}>10 por página</option>
          <option value="25" ${perPage === 25 ? 'selected' : ''}>25 por página</option>
          <option value="50" ${perPage === 50 ? 'selected' : ''}>50 por página</option>
          <option value="999" ${perPage >= 999 ? 'selected' : ''}>Mostrar Todos</option>
        </select>
        <button class="btn-sm btn-secondary" onclick="setExtrasPage(${EXTRAS_PAGE - 1})" ${EXTRAS_PAGE <= 1 ? 'disabled' : ''}>◀ Anterior</button>
        <span style="font-size:12px">Pág. <b>${EXTRAS_PAGE}</b> de <b>${totalPages}</b></span>
        <button class="btn-sm btn-secondary" onclick="setExtrasPage(${EXTRAS_PAGE + 1})" ${EXTRAS_PAGE >= totalPages ? 'disabled' : ''}>Próximo ▶</button>
      </div>
    `;
  }
}

window.openNewExtraModal = function() {
  if ($('#extra-modal-title')) $('#extra-modal-title').textContent = 'Novo Adicional Extra';
  if ($('#extra-id')) $('#extra-id').value = '';
  if ($('#extra-name')) $('#extra-name').value = '';
  if ($('#extra-price')) $('#extra-price').value = '4.90';
  if ($('#extra-cost')) $('#extra-cost').value = '1.50';
  if ($('#extra-allow-acai')) $('#extra-allow-acai').checked = true;
  if ($('#extra-allow-combos')) $('#extra-allow-combos').checked = true;
  if ($('#extra-active')) $('#extra-active').checked = true;
  const modal = $('#extra-edit-modal');
  if (modal) modal.style.display = 'flex';
};

window.openEditExtraModal = function(id) {
  const ex = EXTRAS.find(e => e.id === id);
  if (!ex) return;
  if ($('#extra-modal-title')) $('#extra-modal-title').textContent = `Editar Adicional: ${ex.name}`;
  if ($('#extra-id')) $('#extra-id').value = ex.id;
  if ($('#extra-name')) $('#extra-name').value = ex.name;
  if ($('#extra-price')) $('#extra-price').value = ex.price;
  if ($('#extra-cost')) $('#extra-cost').value = ex.costPrice !== undefined ? ex.costPrice : 1.50;
  if ($('#extra-allow-acai')) $('#extra-allow-acai').checked = ex.allowInAcai !== false;
  if ($('#extra-allow-combos')) $('#extra-allow-combos').checked = ex.allowInCombos !== false;
  if ($('#extra-active')) $('#extra-active').checked = ex.active !== false;
  const modal = $('#extra-edit-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeExtraModal = function() {
  const modal = $('#extra-edit-modal');
  if (modal) modal.style.display = 'none';
};

window.saveExtraForm = async function(e) {
  if (e) e.preventDefault();
  const id = $('#extra-id')?.value;
  const name = $('#extra-name')?.value.trim();
  const price = parseFloat($('#extra-price')?.value);
  const costPrice = parseFloat($('#extra-cost')?.value) || 0;
  const allowInAcai = $('#extra-allow-acai')?.checked ?? true;
  const allowInCombos = $('#extra-allow-combos')?.checked ?? true;
  const active = $('#extra-active')?.checked ?? true;

  if (!name || isNaN(price)) {
    return adminToast('Preencha o nome e o preço de venda do adicional.', 'danger');
  }

  const payload = { name, price, costPrice, allowInAcai, allowInCombos, active };

  try {
    let res;
    if (id) {
      res = await fetch(`${API_URL}/catalog/extras/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(`${API_URL}/catalog/extras`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
    }
    const data = await res.json();
    if (data.ok) {
      closeExtraModal();
      await loadExtras();
      adminToast(id ? 'Adicional atualizado com sucesso!' : 'Adicional cadastrado com sucesso!', 'success');
    } else {
      adminToast(data.error || 'Erro ao salvar adicional.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao salvar adicional.', 'danger');
  }
};

window.createExtraPrompt = window.openNewExtraModal;

window.deleteExtra = function(id) {
  const ex = EXTRAS.find(e => e.id === id);
  const name = ex ? ex.name : 'este adicional';

  showConfirmModal({
    icon: '🗑️',
    title: 'Excluir Adicional',
    message: `Deseja realmente excluir o adicional <b>${esc(name)}</b>?`,
    btnText: 'Excluir Adicional',
    btnClass: 'btn-danger',
    onConfirm: async () => {
      try {
        await fetch(`${API_URL}/catalog/extras/${id}`, { method: 'DELETE', headers: authHeaders() });
        await loadExtras();
        adminToast('Adicional excluído.', 'info');
      } catch (e) {
        adminToast('Erro ao excluir adicional.', 'danger');
      }
    }
  });
};

// ==================== GESTÃO DE CUPONS & ENVIO ====================
async function loadCoupons() {
  try {
    const res = await fetch(`${API_URL}/coupons`, { headers: authHeaders() });
    const data = await res.json();
    if (data.ok) {
      COUPONS = data.coupons;
      renderCouponsList();
    }
  } catch (e) {}
}

function renderCouponsList() {
  const tbody = $('#coupons-table-body');
  if (!tbody) return;

  tbody.innerHTML = COUPONS.map(c => `
    <tr>
      <td><b style="color:var(--y)">${esc(c.code)}</b></td>
      <td>${c.type === 'percent' ? `${c.value}%` : R(c.value)}</td>
      <td>${R(c.minOrder)}</td>
      <td>${c.uses} / ${c.maxUses || 'Ilimitado'}</td>
      <td>${c.active ? '<span style="color:var(--green)">Ativo</span>' : '<span style="color:var(--danger)">Inativo</span>'}</td>
      <td>
        <button class="btn-sm btn-print" onclick="sendCouponViaChat('${c.code}', '${c.value}', '${c.type}')">Enviar no Chat</button>
        <button class="btn-sm btn-secondary" onclick="copyCouponText('${c.code}', '${c.value}', '${c.type}')">Copiar Texto</button>
        <button class="btn-sm btn-danger" onclick="deleteCoupon('${c.id}')">Excluir</button>
      </td>
    </tr>
  `).join('');
}

window.openNewCouponModal = function() {
  if ($('#cup-code')) $('#cup-code').value = '';
  if ($('#cup-type')) $('#cup-type').value = 'percent';
  if ($('#cup-value')) $('#cup-value').value = '10';
  if ($('#cup-minorder')) $('#cup-minorder').value = '30';
  if ($('#cup-maxuses')) $('#cup-maxuses').value = '';
  if ($('#cup-active')) $('#cup-active').checked = true;
  const modal = $('#coupon-edit-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeCouponModal = function() {
  const modal = $('#coupon-edit-modal');
  if (modal) modal.style.display = 'none';
};

window.saveCouponForm = async function(e) {
  if (e) e.preventDefault();
  const code = $('#cup-code')?.value.trim().toUpperCase();
  const type = $('#cup-type')?.value || 'percent';
  const value = parseFloat($('#cup-value')?.value);
  const minOrder = parseFloat($('#cup-minorder')?.value) || 0;
  const maxUsesVal = $('#cup-maxuses')?.value.trim();
  const maxUses = maxUsesVal ? parseInt(maxUsesVal, 10) : null;
  const active = $('#cup-active')?.checked ?? true;

  if (!code || isNaN(value)) {
    return adminToast('Informe o código e o valor do cupom.', 'danger');
  }

  try {
    const res = await fetch(`${API_URL}/coupons`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ code, type, value, minOrder, maxUses, active })
    });
    const data = await res.json();
    if (data.ok) {
      closeCouponModal();
      await loadCoupons();
      adminToast(`Cupom ${code} criado com sucesso!`, 'success');
    } else {
      adminToast(data.error || 'Erro ao criar cupom.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao criar cupom.', 'danger');
  }
};

window.createCoupon = window.openNewCouponModal;

window.deleteCoupon = function(id) {
  const cp = COUPONS.find(c => c.id === id);
  const code = cp ? cp.code : 'este cupom';

  showConfirmModal({
    icon: '🎟️',
    title: 'Excluir Cupom',
    message: `Deseja realmente excluir o cupom <b>${esc(code)}</b>?`,
    btnText: 'Excluir Cupom',
    btnClass: 'btn-danger',
    onConfirm: async () => {
      try {
        await fetch(`${API_URL}/coupons/${id}`, { method: 'DELETE', headers: authHeaders() });
        await loadCoupons();
        adminToast('Cupom excluído.', 'info');
      } catch (e) {
        adminToast('Erro ao excluir cupom.', 'danger');
      }
    }
  });
};

// ==================== GESTÃO DE IMPRESSORAS ====================
async function loadPrinters() {
  try {
    const res = await fetch(`${API_URL}/printers`, { headers: authHeaders() });
    const data = await res.json();
    if (data.ok) {
      PRINTERS = data.printers;
      renderPrintersList();
    }
  } catch (e) {}
}

function renderPrintersList() {
  const box = $('#printers-list');
  if (!box) return;

  box.innerHTML = PRINTERS.map(p => `
    <div style="background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <b style="font-size:16px">${esc(p.name)}</b>
        <div style="font-size:12px;color:var(--mut)">Destino: <b>${p.target.toUpperCase()}</b> · Bobina: <b>${p.paperWidth}mm</b></div>
        <div style="font-size:12px;color:var(--green)">${p.autoPrintOnApproved ? 'Auto-impressão ativa ao confirmar pagamento' : 'Auto-impressão desligada'}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-sm btn-print" onclick="testPrinterPrint('${p.id}')">Imprimir Teste</button>
      </div>
    </div>
  `).join('');
}

window.testPrinterPrint = function(printerId) {
  const dummyText = `
================================
     EXPLOSÃO AÇAÍ - TESTE
================================
Impressora Conectada com Sucesso!
Data: ${new Date().toLocaleString('pt-BR')}
Largura: 80mm / ESC-POS Suportado
Corte Automático Ativado.
================================
  `;
  executeBrowserPrint(dummyText);
};

// ==================== CHAT AO VIVO DE ATENDIMENTO ====================
async function loadChatConversations() {
  try {
    const res = await fetch(`${API_URL}/chat/conversations`, { headers: authHeaders() });
    const data = await res.json();
    if (data.ok) {
      CHAT_CONVERSATIONS = data.conversations;
      renderChatConversationsList();
      if (!ACTIVE_CHAT_PHONE && CHAT_CONVERSATIONS.length > 0) {
        selectChat(CHAT_CONVERSATIONS[0].customerPhone, CHAT_CONVERSATIONS[0].customerName);
      }
    }
  } catch (e) {}
}

function renderChatConversationsList() {
  const box = $('#chat-conversations-list');
  if (!box) return;

  if (CHAT_CONVERSATIONS.length === 0) {
    box.innerHTML = `<p style="color:var(--mut);text-align:center;padding:20px">Nenhuma conversa recente.</p>`;
    return;
  }

  box.innerHTML = CHAT_CONVERSATIONS.map(c => `
    <div onclick="selectChat('${c.customerPhone}', '${esc(c.customerName)}')" 
         style="background:${ACTIVE_CHAT_PHONE === c.customerPhone ? 'var(--p2)' : 'var(--card)'};border:1px solid var(--ln);border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer">
      <div style="display:flex;justify-content:space-between">
        <b>${esc(c.customerName)}</b>
        <small style="color:var(--mut)">${new Date(c.lastTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
      </div>
      <div style="font-size:12px;color:var(--tx);opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${esc(c.lastMessage)}
      </div>
      ${c.unreadCount > 0 ? `<span class="badge" style="background:var(--y);color:#000;font-size:10px;padding:2px 6px;border-radius:99px">${c.unreadCount} nova</span>` : ''}
    </div>
  `).join('');
}

window.selectChat = function(phone, name) {
  ACTIVE_CHAT_PHONE = phone;
  if ($('#active-chat-name')) $('#active-chat-name').textContent = name;
  if ($('#active-chat-phone')) $('#active-chat-phone').textContent = phone;
  if ($('#btn-edit-chat-name')) $('#btn-edit-chat-name').style.display = 'inline-block';
  if ($('#btn-close-chat')) $('#btn-close-chat').style.display = 'inline-block';
  if ($('#chat-fast-sender')) $('#chat-fast-sender').value = SETTINGS.chatSenderName || 'Delivery';
  
  const inp = $('#admin-chat-input');
  if (inp) {
    inp.placeholder = `Responder para ${name}... (Pressione Enter para enviar)`;
    inp.focus();
  }
  renderChatConversationsList();
  loadChatMessages(phone);

  if (window.innerWidth <= 768) {
    const chatWin = $('.admin-chat-window');
    if (chatWin) chatWin.scrollIntoView({ behavior: 'smooth' });
  }
};

async function loadChatMessages(phone) {
  try {
    const res = await fetch(`${API_URL}/chat?phone=${phone}&markRead=true`);
    const data = await res.json();
    if (data.ok) {
      const box = $('#admin-chat-messages');
      if (!box) return;
      box.innerHTML = data.messages.map(m => {
        if (m.isSystemClose) {
          return `
            <div class="admin-msg-bubble system">
              🏁 ${esc(m.message)}
            </div>
          `;
        }
        const isStore = m.sender === 'admin';
        const senderLabel = isStore ? `${esc(m.senderName || SETTINGS.chatSenderName || 'Delivery')} (Loja)` : `${esc(m.customerName || 'Cliente')}`;
        const timeStr = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        return `
          <div class="admin-msg-bubble ${isStore ? 'store' : 'client'}">
            <div style="font-size:11px;font-weight:700;margin-bottom:3px;color:${isStore ? '#34d399' : '#c084fc'}">
              ${senderLabel}
            </div>
            <div style="line-height:1.45">${esc(m.message)}</div>
            <div style="font-size:10px;opacity:0.75;text-align:right;margin-top:4px">
              ${timeStr}
            </div>
          </div>
        `;
      }).join('');
      box.scrollTop = box.scrollHeight;
    }
  } catch (e) {}
}

window.sendAdminChatMessage = async function() {
  const inp = $('#admin-chat-input');
  if (!inp || !inp.value.trim()) return;

  if (!ACTIVE_CHAT_PHONE && CHAT_CONVERSATIONS.length > 0) {
    selectChat(CHAT_CONVERSATIONS[0].customerPhone, CHAT_CONVERSATIONS[0].customerName);
  }

  if (!ACTIVE_CHAT_PHONE) {
    adminToast('Nenhuma conversa de cliente selecionada. Clique em um cliente na lista ao lado.', 'info');
    return;
  }

  const text = inp.value.trim();
  inp.value = '';
  const senderName = $('#chat-fast-sender')?.value.trim() || SETTINGS.chatSenderName || 'Delivery';

  try {
    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        sender: 'admin',
        senderName: senderName,
        customerPhone: ACTIVE_CHAT_PHONE,
        customerName: $('#active-chat-name')?.textContent || 'Cliente',
        message: text
      })
    });
    const d = await res.json();
    if (d.ok) {
      loadChatMessages(ACTIVE_CHAT_PHONE);
      loadChatConversations();
    } else {
      adminToast(d.error || 'Erro ao enviar mensagem.', 'danger');
    }
  } catch (e) {
    adminToast('Erro de conexão ao enviar mensagem no chat.', 'danger');
  }
};

window.saveFastSenderName = async function() {
  const val = $('#chat-fast-sender')?.value.trim();
  if (!val) return;
  try {
    const res = await fetch(`${API_URL}/store/settings`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ chatSenderName: val })
    });
    const d = await res.json();
    if (d.ok) {
      SETTINGS = d.settings;
      if ($('#st-chatsender')) $('#st-chatsender').value = val;
      adminToast(`Nome de envio no chat alterado para "${val}"!`, 'success');
    }
  } catch(e) {}
};

window.editCurrentCustomerName = async function() {
  if (!ACTIVE_CHAT_PHONE) return;
  const currentName = $('#active-chat-name')?.textContent || '';
  const newName = prompt('Digite o nome correto deste cliente:', currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;

  try {
    const res = await fetch(`${API_URL}/chat/customer-name`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        customerPhone: ACTIVE_CHAT_PHONE,
        newName: newName.trim()
      })
    });
    const d = await res.json();
    if (d.ok) {
      $('#active-chat-name').textContent = newName.trim();
      const conv = CHAT_CONVERSATIONS.find(c => c.customerPhone === ACTIVE_CHAT_PHONE);
      if (conv) conv.customerName = newName.trim();
      renderChatConversationsList();
      loadChatMessages(ACTIVE_CHAT_PHONE);
      adminToast('Nome do cliente atualizado com sucesso!', 'success');
    } else {
      adminToast(d.error || 'Erro ao atualizar nome.', 'danger');
    }
  } catch(e) {
    adminToast('Erro de conexão ao salvar nome.', 'danger');
  }
};

window.closeCurrentChat = function() {
  if (!ACTIVE_CHAT_PHONE) return;
  const name = $('#active-chat-name')?.textContent || 'Cliente';

  showConfirmModal({
    icon: '🏁',
    title: 'Finalizar Atendimento',
    message: `Deseja realmente encerrar a conversa com <b>${esc(name)}</b>? Uma mensagem de agradecimento será enviada ao cliente.`,
    btnText: 'Finalizar Chat',
    btnClass: 'btn-danger',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API_URL}/chat/close`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ customerPhone: ACTIVE_CHAT_PHONE })
        });
        const d = await res.json();
        if (d.ok) {
          adminToast('Atendimento finalizado com sucesso!', 'info');
          loadChatMessages(ACTIVE_CHAT_PHONE);
          loadChatConversations();
        }
      } catch (e) {
        adminToast('Erro ao finalizar atendimento.', 'danger');
      }
    }
  });
};

// ==================== MODAL DE ALTERAÇÃO DE SENHA DO ADMIN ====================
window.openAdminPasswordModal = function() {
  if ($('#modal-adm-cur-pass')) $('#modal-adm-cur-pass').value = '';
  if ($('#modal-adm-new-pass')) $('#modal-adm-new-pass').value = '';
  if ($('#modal-adm-conf-pass')) $('#modal-adm-conf-pass').value = '';
  const m = $('#admin-password-modal');
  if (m) m.style.display = 'flex';
};

window.closeAdminPasswordModal = function() {
  const m = $('#admin-password-modal');
  if (m) m.style.display = 'none';
};

window.saveNewAdminPasswordModal = async function(e) {
  if (e) e.preventDefault();
  const curPass = $('#modal-adm-cur-pass')?.value;
  const newPass = $('#modal-adm-new-pass')?.value;
  const confPass = $('#modal-adm-conf-pass')?.value;

  if (!curPass || !newPass) {
    adminToast('Preencha a senha atual e a nova senha.', 'danger');
    return;
  }
  if (newPass.length < 4) {
    adminToast('A nova senha deve ter pelo menos 4 caracteres.', 'danger');
    return;
  }
  if (newPass !== confPass) {
    adminToast('A confirmação da nova senha não confere.', 'danger');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/change-password`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ currentPassword: curPass, newPassword: newPass })
    });
    const data = await res.json();
    if (data.ok) {
      ADMIN_TOKEN = newPass;
      localStorage.setItem('admin_token', newPass);
      closeAdminPasswordModal();
      adminToast('Senha do administrador alterada com sucesso!', 'success');
    } else {
      adminToast(data.error || 'Erro ao alterar senha. Verifique a senha atual.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao alterar senha.', 'danger');
  }
};
