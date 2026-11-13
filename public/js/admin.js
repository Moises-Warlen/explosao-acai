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

let TITLE_FLASH_TIMER = null;
function flashPageTitle(message) {
  const originalTitle = 'Explosão Açaí Painel admin';
  if (TITLE_FLASH_TIMER) clearInterval(TITLE_FLASH_TIMER);
  let showMessage = true;
  let count = 0;
  TITLE_FLASH_TIMER = setInterval(() => {
    document.title = showMessage ? message : originalTitle;
    showMessage = !showMessage;
    count++;
    if (count >= 10) {
      clearInterval(TITLE_FLASH_TIMER);
      TITLE_FLASH_TIMER = null;
      document.title = originalTitle;
    }
  }, 1000);
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

function adminToastHtml(html, type = 'info', duration = 6500) {
  const toast = $('#admin-toast');
  if (!toast) return;
  toast.innerHTML = html;
  toast.className = `show ${type}`;
  clearTimeout(window.__adminToastTimer);
  window.__adminToastTimer = setTimeout(() => {
    toast.className = '';
  }, duration);
}

window.syncTopbarHeight = function() {
  const topbar = document.getElementById('admin-topbar');
  const spacer = document.getElementById('admin-topbar-spacer');
  if (topbar && spacer) {
    const h = topbar.offsetHeight;
    if (h > 0) {
      spacer.style.height = `${h}px`;
      document.documentElement.style.setProperty('--admin-topbar-h', `${h}px`);
    }
  }
};
window.addEventListener('resize', () => window.syncTopbarHeight());
window.addEventListener('orientationchange', () => setTimeout(window.syncTopbarHeight, 100));

window.addEventListener('DOMContentLoaded', async () => {
  const dash = $('#dashboard-wrapper');
  if (!ADMIN_TOKEN) {
    if (dash) dash.style.display = 'none';
    showLoginModal();
  } else {
    // Valida o token com o backend para evitar que o painel abra bloqueado ou sem permissão
    try {
      const checkRes = await fetch(`${API_URL}/orders`, { headers: authHeaders() });
      if (checkRes.status === 401) {
        handleUnauthorized();
        return;
      }
    } catch (e) {}

    if (dash) dash.style.display = 'block';
    window.syncTopbarHeight();
    initDashboard();
  }
});

// Autenticação do Administrador
function showLoginModal() {
  const modal = $('#login-modal');
  if (modal) modal.style.display = 'flex';
}

window.handleUnauthorized = function() {
  localStorage.removeItem('admin_token');
  sessionStorage.removeItem('explosao_admin_token');
  ADMIN_TOKEN = null;
  if (WS) {
    try { WS.close(); } catch (e) {}
  }
  const dash = $('#dashboard-wrapper');
  if (dash) dash.style.display = 'none';
  const passInput = $('#admin-pass-input');
  if (passInput) passInput.value = '';
  showLoginModal();
  adminToast('Sua sessão expirou ou a senha é inválida. Por favor, faça login com a senha de admin.', 'danger');
};

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
      sessionStorage.setItem('explosao_admin_token', ADMIN_TOKEN);
      if (WS && WS.readyState === WebSocket.OPEN) {
        WS.send(JSON.stringify({ type: 'AUTHENTICATE_ADMIN', token: ADMIN_TOKEN }));
      }
      $('#login-modal').style.display = 'none';
      const dash = $('#dashboard-wrapper');
      if (dash) dash.style.display = 'block';
      window.syncTopbarHeight();
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
  sessionStorage.removeItem('explosao_admin_token');
  ADMIN_TOKEN = null;
  if (WS) {
    try { WS.close(); } catch (e) {}
  }
  const dash = $('#dashboard-wrapper');
  if (dash) dash.style.display = 'none';
  const passInput = $('#admin-pass-input');
  if (passInput) passInput.value = '';
  showLoginModal();
  adminToast('Sessão encerrada com sucesso.', 'info');
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
  startRealtimeClock();
  setKanbanViewMode('live');
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
  updateHeaderKPIs();
  window.syncTopbarHeight();
}

// Conexão WebSocket para Atualizações em Tempo Real
function initWebSocket() {
  try {
    WS = new WebSocket(WS_URL);
    WS.onopen = () => {
      if (ADMIN_TOKEN) {
        WS.send(JSON.stringify({ type: 'AUTHENTICATE_ADMIN', token: ADMIN_TOKEN }));
      }
    };
    WS.onmessage = async (event) => {
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
          } else {
            ORDERS.unshift(data.payload);
          }
          renderKanban();
          updateOrdersBadge();
          loadSalesReport({ period: $('#report-period-select')?.value || 'today' });
        }
        if (data.event === 'ORDERS_ARCHIVED') {
          await loadOrders();
        }
        if (data.event === 'CHAT_MESSAGE') {
          playNotificationChime();
          flashPageTitle(`💬 Nova mensagem de ${data.payload.senderName || 'Cliente'}!`);
          loadChatConversations();
          if (ACTIVE_CHAT_PHONE === data.payload.customerPhone) {
            loadChatMessages(ACTIVE_CHAT_PHONE);
          }
        }
        if (data.event === 'CHAT_CLOSED') {
          loadChatConversations();
          if (ACTIVE_CHAT_PHONE === data.payload.customerPhone) {
            ACTIVE_CHAT_PHONE = null;
            if ($('#active-chat-name')) $('#active-chat-name').textContent = 'Selecione uma conversa';
            if ($('#active-chat-phone')) $('#active-chat-phone').textContent = '';
            if ($('#btn-edit-chat-name')) $('#btn-edit-chat-name').style.display = 'none';
            if ($('#btn-close-chat')) $('#btn-close-chat').style.display = 'none';
            if ($('#admin-chat-messages')) {
              $('#admin-chat-messages').innerHTML = '<p style="text-align:center;color:var(--mut);margin:auto">Atendimento finalizado com sucesso.</p>';
            }
          }
        }
        if (data.event === 'PRINT_JOB') {
          executeBrowserPrint(data.payload.ticketText);
        }
        if (data.event === 'CATALOG_UPDATED') {
          await loadProducts();
          await loadAccompaniments();
          await loadStoreStatus();
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

      // Sincroniza active state no dock lateral esquerdo
      $$('.dock-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab-target') === tab.dataset.tab);
      });

      if (tab.dataset.tab === 'tab-reports') {
        const period = $('#report-period-select')?.value || 'today';
        loadSalesReport({ period });
      }

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
      const glowBtn = $('#store-status-glow-btn');
      if (sw) sw.checked = data.isOpen;
      if (glowBtn) {
        glowBtn.className = `store-glow-pill ${data.isOpen ? 'open' : 'closed'}`;
      }
      if (label) {
        label.textContent = data.isOpen ? 'LOJA ABERTA' : 'LOJA FECHADA';
        label.style.color = data.isOpen ? '#34d399' : '#f87171';
      }
    }

    const setRes = await fetch(`${API_URL}/store/settings`);
    const setData = await setRes.json();
    if (setData.ok) {
      SETTINGS = setData.settings;
      renderStoreSettingsForm();
      renderBestSellersManager();
    }
  } catch (e) {}
}

window.toggleStoreStatus = async function() {
  const sw = $('#store-toggle-switch');
  const label = $('#store-toggle-label');
  const glowBtn = $('#store-status-glow-btn');
  const nextState = sw ? !sw.checked : (glowBtn ? !glowBtn.classList.contains('open') : true);
  try {
    const res = await fetch(`${API_URL}/store/toggle-status`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ isOpen: nextState })
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.ok) {
      if (sw) sw.checked = data.isOpen;
      if (glowBtn) {
        glowBtn.className = `store-glow-pill ${data.isOpen ? 'open' : 'closed'}`;
      }
      if (label) {
        label.textContent = data.isOpen ? 'LOJA ABERTA' : 'LOJA FECHADA';
        label.style.color = data.isOpen ? '#34d399' : '#f87171';
      }
      adminToast(data.isOpen ? 'A loja agora está ABERTA para receber pedidos!' : 'A loja foi FECHADA.', data.isOpen ? 'success' : 'info');
    } else {
      adminToast(data.error || 'Erro ao atualizar status da loja.', 'danger');
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
  if ($('#st-pix-key')) $('#st-pix-key').value = SETTINGS.pixKey || '';
  if ($('#st-mp-token')) $('#st-mp-token').value = SETTINGS.mercadoPagoAccessToken || '';
  if ($('#st-address')) $('#st-address').value = SETTINGS.address || '';
  if ($('#st-wpp-api-url')) $('#st-wpp-api-url').value = SETTINGS.whatsappApiUrl || '';
  if ($('#st-wpp-api-token')) $('#st-wpp-api-token').value = SETTINGS.whatsappApiToken || '';
  if ($('#st-autoreply-closed-enabled')) $('#st-autoreply-closed-enabled').checked = SETTINGS.autoReplyClosedEnabled !== false;
  if ($('#st-autoreply-closed-msg')) $('#st-autoreply-closed-msg').value = SETTINGS.autoReplyClosedMessage || '';
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
    pixKey: $('#st-pix-key') ? $('#st-pix-key').value.trim() : (SETTINGS.pixKey || '16991098863'),
    mercadoPagoAccessToken: $('#st-mp-token') ? $('#st-mp-token').value.trim() : (SETTINGS.mercadoPagoAccessToken || ''),
    address: $('#st-address').value.trim(),
    whatsappApiUrl: $('#st-wpp-api-url') ? $('#st-wpp-api-url').value.trim() : '',
    whatsappApiToken: $('#st-wpp-api-token') ? $('#st-wpp-api-token').value.trim() : '',
    autoReplyClosedEnabled: $('#st-autoreply-closed-enabled') ? $('#st-autoreply-closed-enabled').checked : true,
    autoReplyClosedMessage: $('#st-autoreply-closed-msg') ? $('#st-autoreply-closed-msg').value.trim() : ''
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
  if (curPass === newPass) {
    adminToast('A nova senha não pode ser igual à senha atual.', 'danger');
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
    const res = await fetch(`${API_URL}/orders`, { headers: authHeaders() });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.ok) {
      ORDERS = data.orders;
      renderKanban();
      updateOrdersBadge();
    }
  } catch (e) {}
}

function updateOrdersBadge() {
  const newOrdersCount = ORDERS.filter(o => o.status === 'received').length;
  const activeOrdersCount = ORDERS.filter(o => o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'returned').length;
  const badge = $('#badge-pending-orders');
  if (badge) {
    const count = newOrdersCount > 0 ? newOrdersCount : activeOrdersCount;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
    if (newOrdersCount > 0) {
      badge.style.background = 'var(--danger)';
      badge.style.color = '#fff';
    } else {
      badge.style.background = 'var(--y)';
      badge.style.color = '#000';
    }
  }
}

function getBrasiliaDateString(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

const KANBAN_PAGE = {
  received: 1,
  preparing: 1,
  ready: 1,
  delivered: 1,
  history: 1,
  returned: 1,
  cancelled: 1
};
const KANBAN_PER_PAGE = 3;

// Controle de Cards Minimizados em Todas as Colunas do Kanban
const EXPANDED_ORDERS = new Set();
window.toggleOrderCardExpand = function(orderId) {
  if (EXPANDED_ORDERS.has(orderId)) {
    EXPANDED_ORDERS.delete(orderId);
  } else {
    EXPANDED_ORDERS.add(orderId);
  }
  renderKanban();
};
window.toggleDeliveredCardExpand = window.toggleOrderCardExpand;

window.toggleColumnExpand = function(colKey) {
  const todayBrasilia = getBrasiliaDateString(new Date());
  const colOrders = ORDERS.filter(o => {
    if (colKey === 'received') return o.status === 'received';
    if (colKey === 'preparing') return o.status === 'preparing';
    if (colKey === 'ready') return o.status === 'ready' || o.status === 'out_for_delivery';
    if (colKey === 'delivered') return o.status === 'delivered' && !o.archivedToHistory && getBrasiliaDateString(o.deliveredAt || o.createdAt) === todayBrasilia;
    if (colKey === 'history') return o.status === 'delivered' && (o.archivedToHistory || getBrasiliaDateString(o.deliveredAt || o.createdAt) < todayBrasilia);
    if (colKey === 'returned') return o.status === 'returned';
    if (colKey === 'cancelled') return o.status === 'cancelled';
    return false;
  });

  const allExp = colOrders.length > 0 && colOrders.every(o => EXPANDED_ORDERS.has(o.id));
  if (allExp) {
    colOrders.forEach(o => EXPANDED_ORDERS.delete(o.id));
  } else {
    colOrders.forEach(o => EXPANDED_ORDERS.add(o.id));
  }
  renderKanban();
};
window.toggleAllDeliveredCards = () => window.toggleColumnExpand('delivered');

window.handleKanbanSearchInput = function() {
  const q = ($('#kanban-search')?.value || '').trim();
  const clearBtn = $('#btn-clear-search');
  if (clearBtn) clearBtn.style.display = q ? 'inline-flex' : 'none';
  Object.keys(KANBAN_PAGE).forEach(k => { KANBAN_PAGE[k] = 1; });
  renderKanban();
};

window.clearKanbanSearch = function() {
  const input = $('#kanban-search');
  if (input) input.value = '';
  const clearBtn = $('#btn-clear-search');
  if (clearBtn) clearBtn.style.display = 'none';
  Object.keys(KANBAN_PAGE).forEach(k => { KANBAN_PAGE[k] = 1; });
  renderKanban();
};

window.handleKanbanFilterChange = function() {
  Object.keys(KANBAN_PAGE).forEach(k => { KANBAN_PAGE[k] = 1; });
  renderKanban();
};

window.clearAllKanbanFilters = function() {
  const sInput = $('#kanban-search');
  if (sInput) sInput.value = '';
  const clearBtn = $('#btn-clear-search');
  if (clearBtn) clearBtn.style.display = 'none';
  const stFilter = $('#kanban-status-filter');
  if (stFilter) stFilter.value = 'all';
  const payFilter = $('#kanban-pay-filter');
  if (payFilter) payFilter.value = 'all';
  const dateFilter = $('#kanban-date-filter');
  if (dateFilter) dateFilter.value = 'all';
  Object.keys(KANBAN_PAGE).forEach(k => { KANBAN_PAGE[k] = 1; });
  renderKanban();
};

let AUDIO_NOTIFICATIONS_ENABLED = true;
window.toggleAudioNotifications = function() {
  AUDIO_NOTIFICATIONS_ENABLED = !AUDIO_NOTIFICATIONS_ENABLED;
  const bell = $('#btn-sound-toggle');
  if (bell) {
    bell.classList.toggle('off', !AUDIO_NOTIFICATIONS_ENABLED);
  }
  const bellBadge = $('#badge-bell-count');
  if (bellBadge) {
    bellBadge.textContent = AUDIO_NOTIFICATIONS_ENABLED ? '1' : '0';
    bellBadge.style.display = AUDIO_NOTIFICATIONS_ENABLED ? 'flex' : 'none';
  }
  adminToast(AUDIO_NOTIFICATIONS_ENABLED ? 'Alerta sonoro de pedidos ATIVADO 🔔' : 'Alerta sonoro SILENCIADO 🔕', AUDIO_NOTIFICATIONS_ENABLED ? 'success' : 'info');
};

let realtimeClockTimer = null;
function startRealtimeClock() {
  const clockEl = $('#header-realtime-clock');
  if (!clockEl) return;
  const update = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  };
  update();
  if (realtimeClockTimer) clearInterval(realtimeClockTimer);
  realtimeClockTimer = setInterval(update, 1000);
}

window.setKanbanViewMode = function(mode = 'live') {
  const board = $('.kanban-board');
  if (!board) return;

  board.classList.remove('view-live', 'view-all', 'view-archive');
  board.classList.add(`view-${mode}`);

  const btnLive = $('#btn-view-live');
  const btnAll = $('#btn-view-all');
  const btnArchive = $('#btn-view-archive');
  if (btnLive) btnLive.classList.toggle('active', mode === 'live');
  if (btnAll) btnAll.classList.toggle('active', mode === 'all');
  if (btnArchive) btnArchive.classList.toggle('active', mode === 'archive');

  const colReceived = $('#col-received-wrapper');
  const colPreparing = $('#col-preparing-wrapper');
  const colReady = $('#col-ready-wrapper');
  const colDelivered = $('#col-delivered-wrapper');
  const colHistory = $('#col-history-wrapper');
  const colReturned = $('#col-returned-wrapper');
  const colCancelled = $('#col-cancelled-wrapper');

  if (mode === 'live') {
    if (colReceived) colReceived.style.display = 'flex';
    if (colPreparing) colPreparing.style.display = 'flex';
    if (colReady) colReady.style.display = 'flex';
    if (colDelivered) colDelivered.style.display = 'flex';
    if (colHistory) colHistory.style.display = 'none';
    if (colReturned) colReturned.style.display = 'none';
    if (colCancelled) colCancelled.style.display = 'none';
  } else if (mode === 'all') {
    if (colReceived) colReceived.style.display = 'flex';
    if (colPreparing) colPreparing.style.display = 'flex';
    if (colReady) colReady.style.display = 'flex';
    if (colDelivered) colDelivered.style.display = 'flex';
    if (colHistory) colHistory.style.display = 'flex';
    if (colReturned) colReturned.style.display = 'flex';
    if (colCancelled) colCancelled.style.display = 'flex';
  } else if (mode === 'archive') {
    if (colReceived) colReceived.style.display = 'none';
    if (colPreparing) colPreparing.style.display = 'none';
    if (colReady) colReady.style.display = 'none';
    if (colDelivered) colDelivered.style.display = 'none';
    if (colHistory) colHistory.style.display = 'flex';
    if (colReturned) colReturned.style.display = 'flex';
    if (colCancelled) colCancelled.style.display = 'flex';
  }
};

window.switchAdminTab = function(tabId) {
  const tabBtn = $(`.nav-tab[data-tab="${tabId}"]`);
  if (tabBtn) {
    tabBtn.click();
  }
  $$('.dock-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab-target') === tabId);
  });
};

function updateHeaderKPIs() {
  const kpiFaturamento = $('#kpi-faturamento');
  const kpiPedidos = $('#kpi-pedidos');
  const kpiTempo = $('#kpi-tempo');
  if (!kpiFaturamento && !kpiPedidos && !kpiTempo) return;

  const todayBrasilia = getBrasiliaDateString(new Date());
  const todayOrders = (ORDERS || []).filter(o => {
    const oDate = getBrasiliaDateString(o.deliveredAt || o.createdAt);
    return oDate === todayBrasilia;
  });

  const validTodayOrders = todayOrders.filter(o => o.status !== 'cancelled' && o.status !== 'returned');
  const revenue = validTodayOrders
    .filter(o => o.payment?.status === 'approved' || o.status === 'delivered')
    .reduce((acc, o) => acc + (Number(o.total) || 0), 0);

  if (kpiFaturamento) {
    kpiFaturamento.textContent = R(revenue);
  }
  if (kpiPedidos) {
    kpiPedidos.textContent = String(validTodayOrders.length);
  }
  if (kpiTempo) {
    const deliveredWithTime = validTodayOrders.filter(o => o.status === 'delivered' && o.deliveryTimeMinutes != null);
    if (deliveredWithTime.length > 0) {
      const avg = Math.round(deliveredWithTime.reduce((sum, o) => sum + o.deliveryTimeMinutes, 0) / deliveredWithTime.length);
      kpiTempo.textContent = `${avg} min`;
    } else {
      kpiTempo.textContent = `~25 min`;
    }
  }
}

window.setKanbanPage = function(column, page) {
  KANBAN_PAGE[column] = page;
  renderKanban();
};

function renderKanban() {
  const colReceived = $('#cards-received');
  if (!colReceived) return;

  const todayBrasilia = getBrasiliaDateString(new Date());
  const now = new Date();
  const yesterdayObj = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayBrasilia = getBrasiliaDateString(yesterdayObj);
  const sevenDaysAgoObj = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoBrasilia = getBrasiliaDateString(sevenDaysAgoObj);

  const q = ($('#kanban-search')?.value || '').trim().toLowerCase();
  const stFilter = $('#kanban-status-filter')?.value || 'all';
  const payFilter = $('#kanban-pay-filter')?.value || 'all';
  const dateFilter = $('#kanban-date-filter')?.value || 'all';

  const filteredOrders = ORDERS.filter(order => {
    const isDeliveredStatus = order.status === 'delivered';
    const orderDateBrasilia = getBrasiliaDateString(order.deliveredAt || order.createdAt);
    const isTodayDelivered = isDeliveredStatus && !order.archivedToHistory && orderDateBrasilia === todayBrasilia;
    const isHistoryDelivered = isDeliveredStatus && (order.archivedToHistory || orderDateBrasilia < todayBrasilia);

    // 1. Filtro de Data
    if (dateFilter !== 'all') {
      if (dateFilter === 'today') {
        if (orderDateBrasilia !== todayBrasilia && !isTodayDelivered) return false;
      } else if (dateFilter === 'yesterday') {
        if (orderDateBrasilia !== yesterdayBrasilia) return false;
      } else if (dateFilter === '7days') {
        if (orderDateBrasilia < sevenDaysAgoBrasilia) return false;
      }
    }

    // 2. Filtro de Status
    if (stFilter !== 'all') {
      if (stFilter === 'received' && order.status !== 'received') return false;
      if (stFilter === 'preparing' && order.status !== 'preparing') return false;
      if (stFilter === 'ready' && order.status !== 'ready' && order.status !== 'out_for_delivery') return false;
      if (stFilter === 'delivered' && !isTodayDelivered) return false;
      if (stFilter === 'history' && !isHistoryDelivered) return false;
      if (stFilter === 'returned' && order.status !== 'returned') return false;
      if (stFilter === 'cancelled' && order.status !== 'cancelled') return false;
    }

    // 3. Filtro de Pagamento
    if (payFilter !== 'all') {
      const isApproved = order.payment?.status === 'approved';
      const isDeliveryPayment = order.payment?.timing === 'delivery' || order.payment?.method === 'Dinheiro';
      const isPending = !isApproved && !isDeliveryPayment;
      const methodStr = String(order.payment?.method || '').toLowerCase();

      if (payFilter === 'approved' && !isApproved) return false;
      if ((payFilter === 'waiting' || payFilter === 'pending') && !isPending) return false;
      if (payFilter === 'delivery' && !isDeliveryPayment) return false;
      if (payFilter === 'pix' && !methodStr.includes('pix')) return false;
      if (payFilter === 'dinheiro' && !methodStr.includes('dinheiro')) return false;
      if (payFilter === 'cartao' && !methodStr.includes('cart') && !methodStr.includes('crédito') && !methodStr.includes('débito')) return false;
    }

    // 4. Busca por Texto (q) - Pesquisa abrangente e inteligente
    if (q) {
      const cleanQ = q.replace('#', '').trim();
      const matchNo = String(order.orderNo || '').toLowerCase().includes(cleanQ);
      const matchId = String(order.id || '').toLowerCase().includes(cleanQ);
      const matchName = String(order.customer?.name || '').toLowerCase().includes(q);
      const matchPhone = String(order.customer?.phone || '').includes(cleanQ);
      const matchReason = String(order.returnReason || order.cancellationReason || '').toLowerCase().includes(q);

      const street = String(order.delivery?.street || '').toLowerCase();
      const bairro = String(order.delivery?.bairro || '').toLowerCase();
      const city = String(order.delivery?.city || '').toLowerCase();
      const number = String(order.delivery?.number || '').toLowerCase();
      const matchAddress = street.includes(q) || bairro.includes(q) || city.includes(q) || number.includes(q);

      const matchItems = Array.isArray(order.items) && order.items.some(it => {
        const iName = String(it.name || '').toLowerCase();
        const iNote = String(it.note || '').toLowerCase();
        const iAcomp = Array.isArray(it.accompaniments) && it.accompaniments.some(ac => String(ac).toLowerCase().includes(q));
        const iExt = Array.isArray(it.extras) && it.extras.some(ex => String(ex).toLowerCase().includes(q));
        return iName.includes(q) || iNote.includes(q) || iAcomp || iExt;
      });

      const matchPay = String(order.payment?.method || '').toLowerCase().includes(q);
      const matchType = (order.delivery?.type === 'pickup' && (q.includes('retirada') || q.includes('balcão') || q.includes('balcao'))) ||
                        (order.delivery?.type === 'delivery' && q.includes('entrega'));

      if (!matchNo && !matchId && !matchName && !matchPhone && !matchReason && !matchAddress && !matchItems && !matchPay && !matchType) {
        return false;
      }
    }

    return true;
  });

  // Atualiza barra de feedback de filtros
  const feedbackEl = $('#kanban-filter-feedback');
  const feedbackText = $('#kanban-filter-feedback-text');
  const isFiltered = Boolean(q || stFilter !== 'all' || payFilter !== 'all' || (dateFilter !== 'all' && dateFilter !== 'today'));
  if (feedbackEl && feedbackText) {
    if (isFiltered) {
      feedbackEl.style.display = 'flex';
      feedbackText.innerHTML = `🔍 <b>${filteredOrders.length} pedido(s)</b> encontrado(s) com os filtros ativos (de ${ORDERS.length} no total)`;
    } else {
      feedbackEl.style.display = 'none';
    }
  }

  // Atualiza métricas rápidas no header
  updateHeaderKPIs();

  const ordersReceived = filteredOrders.filter(o => o.status === 'received');
  const ordersPreparing = filteredOrders.filter(o => o.status === 'preparing');
  const ordersReady = filteredOrders.filter(o => o.status === 'ready' || o.status === 'out_for_delivery');
  const ordersDelivered = filteredOrders.filter(o => o.status === 'delivered' && !o.archivedToHistory && getBrasiliaDateString(o.deliveredAt || o.createdAt) === todayBrasilia);
  const ordersHistory = filteredOrders.filter(o => o.status === 'delivered' && (o.archivedToHistory || getBrasiliaDateString(o.deliveredAt || o.createdAt) < todayBrasilia));
  const ordersReturned = filteredOrders.filter(o => o.status === 'returned');
  const ordersCancelled = filteredOrders.filter(o => o.status === 'cancelled');

  renderKanbanColumn('received', ordersReceived, 'cards-received', 'cards-received-pagination', 'col-header-received', 'Novos Pedidos');
  renderKanbanColumn('preparing', ordersPreparing, 'cards-preparing', 'cards-preparing-pagination', 'col-header-preparing', 'Em Preparo (Cozinha)');
  renderKanbanColumn('ready', ordersReady, 'cards-ready', 'cards-ready-pagination', 'col-header-ready', 'Pronto / Saiu para Entrega');
  renderKanbanColumn('delivered', ordersDelivered, 'cards-delivered', 'cards-delivered-pagination', 'col-header-delivered', 'Entregues Hoje');
  renderKanbanColumn('history', ordersHistory, 'cards-history', 'cards-history-pagination', 'col-header-history', 'Pedidos Concluídos', true);
  renderKanbanColumn('returned', ordersReturned, 'cards-returned', 'cards-returned-pagination', 'col-header-returned', 'Devolvidos à Loja');
  renderKanbanColumn('cancelled', ordersCancelled, 'cards-cancelled', 'cards-cancelled-pagination', 'col-header-cancelled', 'Cancelados');
}

function renderKanbanColumn(colKey, list, containerId, paginationId, headerId, title, isHistory = false) {
  const container = $(`#${containerId}`);
  const paginationBox = $(`#${paginationId}`);
  const header = $(`#${headerId}`);

  if (header) {
    if (list.length > 0) {
      const allExp = list.every(o => EXPANDED_ORDERS.has(o.id));
      header.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
          <span>${title} <span style="font-size:11px;opacity:0.85;background:rgba(255,255,255,0.12);padding:1px 7px;border-radius:99px;margin-left:4px;color:#fff">${list.length}</span></span>
          <button class="btn-sm btn-secondary" style="font-size:10px;padding:2px 7px" onclick="toggleColumnExpand('${colKey}')" title="${allExp ? 'Minimizar todos os pedidos desta coluna' : 'Expandir todos os pedidos desta coluna'}">
            ${allExp ? '▲ Minimizar' : '▼ Expandir'}
          </button>
        </div>
      `;
    } else {
      header.innerHTML = `${title} <span style="font-size:11px;opacity:0.85;background:rgba(255,255,255,0.12);padding:1px 7px;border-radius:99px;margin-left:4px;color:#fff">${list.length}</span>`;
    }
  }
  if (!container) return;

  const q = ($('#kanban-search')?.value || '').trim();
  const effectivePerPage = q ? 25 : KANBAN_PER_PAGE;
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / effectivePerPage));
  if (KANBAN_PAGE[colKey] > totalPages) KANBAN_PAGE[colKey] = totalPages;
  if (KANBAN_PAGE[colKey] < 1) KANBAN_PAGE[colKey] = 1;

  const curPage = KANBAN_PAGE[colKey];
  const start = (curPage - 1) * effectivePerPage;
  const pageOrders = list.slice(start, start + effectivePerPage);

  container.innerHTML = pageOrders.length === 0
    ? `<div style="color:var(--mut);text-align:center;padding:24px 10px;font-size:12px">Nenhum pedido</div>`
    : pageOrders.map(o => createOrderCardHtml(o, isHistory)).join('');

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

function createOrderCardHtml(order, isHistory = false) {
  const isMoney = order.payment?.method === 'Dinheiro';
  const isDeliveryPayment = order.payment?.timing === 'delivery' || isMoney;
  const isApproved = order.payment?.status === 'approved';
  // Regra de impressão: dinheiro ou cartão na entrega imprime na hora; online só após aprovado pelo banco
  const canPrint = isDeliveryPayment || isApproved;
  const hasTroco = isMoney && order.payment?.trocoValue > 0;
  const isDelivery = order.delivery?.type === 'delivery';

  // Data e hora de conclusão ou registro no fuso de Brasília
  const orderTimeStr = new Date(order.deliveredAt || order.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  let nextAction = '';
  if (!isHistory) {
    if (order.status === 'received') {
      const isOnlinePending = !isDeliveryPayment && !isApproved;
      if (isOnlinePending) {
        nextAction = `
          <button class="btn-sm btn-print" style="background:#059669;color:#fff;font-weight:700;font-size:11px;padding:4px 8px" onclick="simulateBankApproval('${order.id}')" title="Confirmar pagamento Pix recebido e aceitar pedido para a cozinha">
            ✓ Confirmar Pix & Aceitar
          </button>
        `;
      } else {
        // 1. Novos Pedidos: apenas envia para a cozinha
        nextAction = `<button class="btn-sm btn-next btn-next-received" onclick="advanceOrderStatus('${order.id}', 'preparing')">Aceitar / Mandar p/ Cozinha</button>`;
      }
    } else if (order.status === 'preparing') {
      // 2. Em Preparo: move para a coluna de Pronto / Saiu para Entrega
      nextAction = isDelivery 
        ? `<button class="btn-sm btn-next btn-next-preparing" onclick="advanceOrderStatus('${order.id}', 'out_for_delivery')">Pronto p/ Entrega</button>`
        : `<button class="btn-sm btn-next btn-next-preparing" onclick="advanceOrderStatus('${order.id}', 'ready')">Pronto no Balcão</button>`;
    } else if (order.status === 'out_for_delivery' || order.status === 'ready') {
      // 3. Pronto / Saiu para Entrega: confirma entrega/retirada e move para Concluídos
      if (isDelivery) {
        nextAction = `
          <button class="btn-sm btn-next btn-next-ready" onclick="confirmOrderDeliveryAndPayment('${order.id}')" title="Confirmar que o cliente recebeu e o pagamento foi concluído">
            ✓ Entregue & Recebido
          </button>
          <button class="btn-sm btn-secondary" style="font-size:10px;padding:4px 6px" onclick="copyMotoboyLink('${order.id}')" title="Copiar link para o celular do entregador">
            📱 Link Motoboy
          </button>
          <button class="btn-sm" style="background:#b45309;color:#fff;font-size:10px;padding:4px 6px" onclick="openReturnOrderModal('${order.id}', '${order.orderNo}')" title="Marcar como devolvido à loja se o cliente não atendeu">
            ↩ Devolver
          </button>
        `;
      } else {
        nextAction = `
          <button class="btn-sm btn-next btn-next-ready" onclick="confirmPickupOrder('${order.id}')" title="Marcar como Pago e Retirado pelo Cliente no Balcão">
            ✓ Concluir Retirada (Pago)
          </button>
        `;
      }
    } else if (order.status === 'returned') {
      nextAction = `
        <button class="btn-sm btn-next" onclick="advanceOrderStatus('${order.id}', 'preparing')" title="Reenviar este pedido para a cozinha preparar novamente">
          Reenviar p/ Cozinha
        </button>
      `;
    }
  }

  // Regra de Cancelamento:
  // - Retirada no balcão em Pronto/Saiu para entrega: pode cancelar!
  // - Entrega em Pronto/Saiu para entrega: NÃO pode cancelar nessa etapa!
  // - Novos Pedidos, Em Preparo e Devolvidos: cancelamento permitido
  // - Entregues Hoje, Pedidos Concluídos e Cancelados: sem botão de cancelamento
  let canCancel = false;
  if (!isHistory) {
    if (order.status === 'received' || order.status === 'preparing' || order.status === 'returned') {
      canCancel = true;
    } else if (order.status === 'ready' || order.status === 'out_for_delivery') {
      canCancel = !isDelivery;
    }
  }

  // Botões de WhatsApp: permitidos em Novos Pedidos, Em Preparo, Pronto/Saiu para Entrega e Entregues Hoje
  // Bloqueados: Cancelados, Devolvidos à Loja e Histórico Concluído
  const showWppButton = !isHistory && (
    order.status === 'received' ||
    order.status === 'preparing' ||
    order.status === 'ready' ||
    order.status === 'out_for_delivery' ||
    order.status === 'delivered'
  );

  let wppBtnTextMin = '💬 Zap';
  let wppBtnTitleMin = 'Avisar cliente no WhatsApp';
  let wppBtnTextExp = '💬 Avisar no Zap';
  let wppBtnTitleExp = 'Enviar atualização de status do pedido para o WhatsApp do cliente';

  if (order.status === 'delivered') {
    wppBtnTextMin = '💬 Agradecer';
    wppBtnTitleMin = 'Enviar mensagem de agradecimento no WhatsApp';
    wppBtnTextExp = '💬 Agradecer';
    wppBtnTitleExp = 'Enviar mensagem de agradecimento no WhatsApp';
  } else if (order.status === 'out_for_delivery' || (order.status === 'ready' && isDelivery)) {
    wppBtnTextMin = '💬 Saiu Entrega';
    wppBtnTitleMin = 'Avisar cliente que o pedido saiu para entrega';
    wppBtnTextExp = '💬 Avisar Entrega';
    wppBtnTitleExp = 'Avisar cliente que o pedido saiu para entrega';
  } else if (order.status === 'ready' && !isDelivery) {
    wppBtnTextMin = '💬 Pedido Pronto';
    wppBtnTitleMin = 'Avisar cliente que o pedido está pronto para retirada';
    wppBtnTextExp = '💬 Avisar Retirada';
    wppBtnTitleExp = 'Avisar cliente que o pedido está pronto para retirada';
  }

  // ================= CARTÕES MINIMIZADOS (PADRÃO PARA TODAS AS COLUNAS) =================
  if (!EXPANDED_ORDERS.has(order.id)) {
    const payMethod = order.payment?.method ? order.payment.method.toUpperCase() : 'PAGO';
    let statusSummary = '';
    if (isHistory) {
      statusSummary = `<span style="color:#34d399;font-weight:600">✓ Concluído (${payMethod})</span>`;
    } else if (order.status === 'received') {
      const isOnlinePending = !isDeliveryPayment && !isApproved;
      if (isOnlinePending) {
        statusSummary = `<span style="color:#f59e0b;font-weight:700">⏳ Aguardando Pagamento Pix</span>`;
      } else {
        statusSummary = `<span style="color:#fde047;font-weight:600">Novos Pedidos (Aguardando Cozinha)</span>`;
      }
    } else if (order.status === 'preparing') {
      statusSummary = `<span style="color:#60a5fa;font-weight:600">Em Preparo (Cozinha)</span>`;
    } else if (order.status === 'out_for_delivery') {
      statusSummary = `<span style="color:#f97316;font-weight:600">🛵 Saiu p/ Entrega</span>`;
    } else if (order.status === 'ready') {
      statusSummary = `<span style="color:#a78bfa;font-weight:600">🛍️ Pronto no Balcão</span>`;
    } else if (order.status === 'delivered') {
      statusSummary = `<span style="color:#a7f3d0;font-weight:600">✓ Entregue & Pago (${payMethod})</span>`;
    } else if (order.status === 'returned') {
      statusSummary = `<span style="color:#fed7aa;font-weight:600">↩ Devolvido à Loja</span>`;
    } else if (order.status === 'cancelled') {
      statusSummary = `<span style="color:#fca5a5;font-weight:600">✕ Cancelado</span>`;
    }

    return `
      <div class="order-card minimized" id="card-${order.id}">
        <div class="order-card-head" style="cursor:pointer" onclick="toggleOrderCardExpand('${order.id}')" title="Clique para expandir os detalhes deste pedido">
          <div style="display:flex;align-items:center;gap:6px">
            <b style="font-size:15px;color:var(--y)">#${order.orderNo}</b>
            <span style="font-weight:700;font-size:13px;color:#fff">${esc(order.customer.name)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="order-badge ${order.payment?.method === 'Pix' ? 'pix' : (isMoney ? 'money' : 'card')}">
              ${order.payment?.method}
            </span>
            <b style="color:var(--green);font-size:14px">${R(order.total)}</b>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:11px;flex-wrap:wrap;gap:4px">
          <div>${statusSummary} ${isHistory ? `<span style="color:var(--mut);margin-left:4px">(${orderTimeStr})</span>` : ''}</div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
            ${showWppButton ? `
            <button class="btn-sm" style="background:#25d366;color:#fff;font-size:10px;padding:3px 7px;font-weight:600" onclick="event.stopPropagation(); sendWppStatusNotice('${order.id}')" title="${wppBtnTitleMin}">
              ${wppBtnTextMin}
            </button>
            ` : ''}
            ${(!isHistory && order.status === 'returned') ? `
              <button class="btn-sm btn-print" style="font-size:10px;padding:3px 7px" onclick="event.stopPropagation(); printOrderStation('${order.id}', 'counter')" title="Reimprimir Comanda Balcão">
                Reimprimir
              </button>
            ` : ''}
            ${nextAction ? `<span onclick="event.stopPropagation()">${nextAction}</span>` : ''}
            <button class="btn-sm btn-secondary" style="font-size:10px;padding:3px 7px" onclick="event.stopPropagation(); toggleOrderCardExpand('${order.id}')" title="Ver detalhes completos do pedido">
              ▼ Detalhes
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Identificação clara da forma e timing do pagamento
  let paymentBadgeHtml = '';
  if (isHistory) {
    const payMethod = order.payment?.method ? order.payment.method.toUpperCase() : 'PAGO';
    paymentBadgeHtml = `
      <div class="payment-approved" style="background:#064e3b;color:#a7f3d0;border:1px solid #10b981;font-weight:700;padding:6px 10px;border-radius:8px">
        ✓ PEDIDO CONCLUÍDO & PAGO (${payMethod})
      </div>
    `;
  } else if (order.status === 'delivered') {
    const payMethod = order.payment?.method ? order.payment.method.toUpperCase() : 'PAGO';
    paymentBadgeHtml = `
      <div class="payment-approved" style="background:#064e3b;color:#a7f3d0;border:1px solid #10b981;font-weight:700;padding:6px 10px;border-radius:8px">
        ✓ PEDIDO FINALIZADO & PAGO (${payMethod})
      </div>
    `;
  } else if (order.status === 'returned') {
    paymentBadgeHtml = `
      <div class="troco-alert" style="background:#451a03;color:#fed7aa;border:1px solid #f97316;padding:6px 10px;border-radius:8px">
        ↩ PEDIDO DEVOLVIDO À LOJA
        <div style="font-size:12px;margin-top:4px;color:#fff"><b>Motivo:</b> ${esc(order.returnReason || 'Cliente não atendeu / não localizado')}</div>
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

  const isOrderExpanded = EXPANDED_ORDERS.has(order.id);

  return `
    <div class="order-card ${isOrderExpanded ? 'expanded' : ''}" id="card-${order.id}">
      <div class="order-card-head" style="cursor:pointer" onclick="toggleOrderCardExpand('${order.id}')" title="Clique para minimizar">
        <div style="display:flex;align-items:center;gap:6px">
          <b style="font-size:16px;color:var(--y)">#${order.orderNo}</b>
          <span class="order-badge ${order.payment?.method === 'Pix' ? 'pix' : (isMoney ? 'money' : 'card')}">
            ${order.payment?.method}
          </span>
        </div>
        <button class="btn-sm btn-secondary" style="font-size:10px;padding:2px 7px" onclick="event.stopPropagation(); toggleOrderCardExpand('${order.id}')" title="Minimizar card">
          ▲ Minimizar
        </button>
      </div>

      ${paymentBadgeHtml}

      <div style="font-size:12px;color:var(--mut);margin-top:4px">
        ${isHistory ? `Concluído em: <b style="color:#fff">${orderTimeStr}</b>` : `Registrado em: ${orderTimeStr}`}
      </div>

      <div style="font-weight:600;font-size:14px;margin-top:6px;display:flex;justify-content:space-between;align-items:center">
        <div>
          Cliente: ${esc(order.customer.name)} 
          ${!isHistory ? `<a href="https://wa.me/55${order.customer.phone}" target="_blank" style="color:var(--green);text-decoration:none;font-size:12px;margin-left:4px" title="Abrir conversa no WhatsApp">WhatsApp</a>` : ''}
        </div>
        ${showWppButton ? `
        <button class="btn-sm" style="background:#25d366;color:#fff;font-size:11px;padding:3px 8px;font-weight:600;display:inline-flex;align-items:center;gap:4px" onclick="sendWppStatusNotice('${order.id}')" title="${wppBtnTitleExp}">
          ${wppBtnTextExp}
        </button>
        ` : ''}
      </div>

      ${isDelivery ? `
        <div style="font-size:12px;color:var(--mut);display:flex;align-items:center;justify-content:space-between;gap:6px">
          <span>Entrega: ${esc(order.delivery.street)}, ${esc(order.delivery.number)} — ${esc(order.delivery.bairro)} (${(order.delivery.km || 0).toFixed(1)} km)</span>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.delivery.street || ''}, ${order.delivery.number || ''}, ${order.delivery.bairro || ''}, Franca - SP`)}" target="_blank" title="Abrir localização no Google Maps" style="color:#60a5fa;text-decoration:none;font-size:13px;padding:1px 5px;border-radius:4px;background:rgba(96,165,250,0.15);flex-shrink:0">📍 Mapa</a>
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
        <span>Total:</span>
        <span style="color:var(--green)">${R(order.total)}</span>
      </div>

      <!-- Ações de Impressão e Status -->
      <div class="order-actions" style="flex-wrap:wrap;gap:6px">
        ${(!isHistory && order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'returned' && order.status !== 'ready' && order.status !== 'out_for_delivery') ? `
          <button class="btn-sm btn-print" ${!canPrint ? 'disabled title="Impressão bloqueada até confirmação bancária do pagamento"' : ''} onclick="printOrderStation('${order.id}', 'kitchen')">
            Imprimir 1ª Via (Cozinha)
          </button>
        ` : ''}
        ${(!isHistory && order.status !== 'cancelled' && order.status !== 'delivered') ? `
          <button class="btn-sm btn-print" ${!canPrint ? 'disabled title="Impressão bloqueada até confirmação bancária do pagamento"' : ''} onclick="printOrderStation('${order.id}', 'counter')">
            ${order.status === 'returned' ? 'Reimprimir Comanda' : 'Imprimir 2ª Via (Balcão)'}
          </button>
        ` : ''}
        ${nextAction}
        <button class="btn-sm btn-secondary" style="margin-left:auto;font-size:11px;padding:3px 8px" onclick="toggleOrderCardExpand('${order.id}')" title="Minimizar detalhes deste pedido">
          ▲ Minimizar
        </button>
        ${canCancel ? `
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
      promptWppStatusNotice(data.order);
    } else {
      adminToast(data.error || 'Erro ao cancelar pedido.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao cancelar pedido.', 'danger');
  }
};

window.openReturnOrderModal = function(orderId, orderNo) {
  if ($('#return-order-id')) $('#return-order-id').value = orderId;
  if ($('#return-modal-title')) $('#return-modal-title').textContent = `Devolver Pedido #${orderNo} à Loja`;
  if ($('#return-order-reason')) $('#return-order-reason').selectedIndex = 0;
  if ($('#return-order-obs')) $('#return-order-obs').value = '';
  const modal = $('#return-order-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeReturnOrderModal = function() {
  const modal = $('#return-order-modal');
  if (modal) modal.style.display = 'none';
};

window.confirmReturnOrder = async function(e) {
  if (e) e.preventDefault();
  const orderId = $('#return-order-id')?.value;
  const reasonVal = $('#return-order-reason')?.value || 'Cliente não atendeu no interfone / portaria';
  const obs = $('#return-order-obs')?.value.trim();
  const fullReason = obs ? `${reasonVal} - ${obs}` : reasonVal;

  try {
    const res = await fetch(`${API_URL}/orders/${orderId}/return`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ reason: fullReason })
    });
    const data = await res.json();
    if (data.ok) {
      closeReturnOrderModal();
      const idx = ORDERS.findIndex(o => o.id === orderId);
      if (idx !== -1) ORDERS[idx] = data.order;
      renderKanban();
      updateOrdersBadge();
      const periodSelect = $('#report-period-select');
      loadSalesReport({ period: periodSelect ? periodSelect.value : 'today' });
      adminToast(`Pedido #${data.order.orderNo} registrado como Devolvido!`, 'info');
      promptWppStatusNotice(data.order);
    } else {
      adminToast(data.error || 'Erro ao registrar devolução.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao registrar devolução.', 'danger');
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
      promptWppStatusNotice(data.order);
    }
  } catch (e) {
    adminToast('Erro ao atualizar status.', 'danger');
  }
};

// ==================== NOTIFICAÇÃO E AVISOS WHATSAPP (SEM EMOJIS / UTF-8) ====================
window.getWppStatusMessage = function(order) {
  const nome = (order.customer?.name || 'Cliente').trim();
  const numero = order.orderNo || '';

  switch (order.status) {
    case 'received':
      return `Olá, ${nome}! Seu pedido #${numero} na Explosão Açaí foi aceito! Já já começamos a preparar.`;
    case 'preparing':
      return `Seu pedido #${numero} já está sendo preparado com muito carinho!`;
    case 'ready':
    case 'out_for_delivery':
      // Se for entrega (delivery), mensagem de entrega a caminho:
      if (order.delivery?.type === 'delivery') {
        return `Boa notícia, ${nome}! Seu pedido #${numero} saiu para entrega e já está a caminho!`;
      }
      // Se for retirada (pickup/balcão), mensagem de pronto para retirada:
      if (order.delivery?.type === 'pickup' || order.delivery?.type === 'retirada' || order.delivery?.type === 'balcao') {
        return `Boa notícia, ${nome}! Seu pedido #${numero} está pronto e já pode ser retirado na loja!`;
      }
      // Fallback quando não há delivery configurado:
      if (order.status === 'out_for_delivery') {
        return `Boa notícia, ${nome}! Seu pedido #${numero} saiu para entrega e já está a caminho!`;
      }
      return `Boa notícia, ${nome}! Seu pedido #${numero} está pronto e já pode ser retirado na loja!`;
    case 'delivered':
      return `Obrigado por comprar com a Explosão Açaí, ${nome}! Esperamos que você curta sua explosão de sabor! Nos siga no Instagram: https://www.instagram.com/expl.osaoacai?mdxt=Zm1obWhpaTFhbmV3`;
    default:
      return `Olá, ${nome}! Seu pedido #${numero} na Explosão Açaí teve o status atualizado para: ${order.status}.`;
  }
};

window.sendWppStatusNotice = function(orderId) {
  const order = ORDERS.find(o => o.id === orderId);
  if (!order) {
    adminToast('Pedido não encontrado.', 'danger');
    return;
  }
  const rawPhone = order.customer?.phone ? String(order.customer.phone).replace(/\D/g, '') : '';
  if (!rawPhone || rawPhone.length < 10) {
    adminToast('Telefone do cliente não cadastrado ou inválido.', 'danger');
    return;
  }
  let fullPhone = rawPhone;
  if (fullPhone.length === 10 || fullPhone.length === 11) {
    fullPhone = `55${fullPhone}`;
  }
  const msg = window.getWppStatusMessage(order);
  const url = `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
};

window.promptWppStatusNotice = function(order) {
  if (!order || !order.customer?.phone) return;
  // Apenas status permitidos disparam alerta de WhatsApp.
  // Colunas 'returned', 'cancelled' e histórico NÃO devem ter aviso no WhatsApp.
  const allowedStatuses = ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
  if (!allowedStatuses.includes(order.status)) {
    return;
  }
  const rawPhone = String(order.customer.phone).replace(/\D/g, '');
  if (rawPhone.length < 10) return;

  const isDelivery = order.delivery?.type === 'delivery';
  let statusLabel = 'Recebido';
  let btnLabel = '💬 Avisar no Zap';

  if (order.status === 'received') {
    statusLabel = 'Recebido';
    btnLabel = '💬 Avisar no Zap';
  } else if (order.status === 'preparing') {
    statusLabel = 'Em Preparo';
    btnLabel = '💬 Avisar no Zap';
  } else if (order.status === 'ready' || order.status === 'out_for_delivery') {
    statusLabel = isDelivery ? 'Saiu para Entrega' : 'Pronto para Retirada';
    btnLabel = isDelivery ? '💬 Avisar Entrega' : '💬 Avisar Retirada';
  } else if (order.status === 'delivered') {
    statusLabel = 'Entregue';
    btnLabel = '💬 Agradecer';
  }

  adminToastHtml(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%">
      <span>Status (#${order.orderNo}): <b>${statusLabel}</b></span>
      <button class="btn-sm" style="background:#25d366;color:#fff;font-weight:700;padding:4px 10px;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;font-size:12px" onclick="sendWppStatusNotice('${order.id}')">
        ${btnLabel}
      </button>
    </div>
  `, 'info', 7000);
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
      const cb = CONFIRM_MODAL_CALLBACK;
      closeConfirmModal();
      if (typeof cb === 'function') cb();
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
          promptWppStatusNotice(data.order);
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
          promptWppStatusNotice(data.order);
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

let LAST_PRINT_TEXT = '';
let LAST_PRINT_TIME = 0;
let IS_PRINTING_BUSY = false;

function executeBrowserPrint(text) {
  if (!text) return;

  // Deduplicação: se o mesmo texto foi enviado nos últimos 4 segundos, ignora chamada duplicada
  const now = Date.now();
  if (LAST_PRINT_TEXT === text && (now - LAST_PRINT_TIME) < 4000) {
    return;
  }
  LAST_PRINT_TEXT = text;
  LAST_PRINT_TIME = now;

  if (IS_PRINTING_BUSY) {
    return;
  }
  IS_PRINTING_BUSY = true;

  document.body.classList.remove('printing-report');
  document.body.classList.remove('printing-recipe');
  const printArea = $('#thermal-print-area');
  if (printArea) {
    printArea.innerHTML = `
      <div style="text-align:center;margin-bottom:6px">
        <img src="imagens/Logo.png" alt="Logo" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:1.5px solid #000;display:block;margin:0 auto 4px auto" onerror="this.style.display='none'">
        <div style="font-weight:900;font-size:14px;letter-spacing:0.5px">EXPLOSÃO AÇAÍ - DELIVERY</div>
      </div>
      <pre style="font-family:monospace;white-space:pre-wrap;margin:0;font-size:11px;line-height:1.3">${esc(text)}</pre>
    `;
    setTimeout(() => {
      try {
        window.print();
      } finally {
        setTimeout(() => {
          if (printArea) printArea.innerHTML = '';
          IS_PRINTING_BUSY = false;
        }, 1200);
      }
    }, 180);
  } else {
    IS_PRINTING_BUSY = false;
  }
}

// Limpeza garantida da área de impressão ao fechar diálogo
window.addEventListener('afterprint', () => {
  const printArea = $('#thermal-print-area');
  if (printArea) printArea.innerHTML = '';
  IS_PRINTING_BUSY = false;
});

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
  if ($('#kpi-returned')) $('#kpi-returned').textContent = `${sum.returnedOrdersCount || 0}`;
  if ($('#kpi-returned-sub')) $('#kpi-returned-sub').textContent = `${R(sum.returnedTotal || 0)} devolvido`;
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

  // Inteligência de Vendas: Horários de Pico e Acompanhamentos Mais Consumidos
  renderPeakHoursAndAcompRank(rep.orders || ORDERS || []);

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
      const matchReason = String(o.returnReason || o.cancellationReason || '').toLowerCase().includes(q);
      if (!matchNo && !matchName && !matchReason) return false;
    }
    if (st !== 'all') {
      if (st === 'cancelled' && !o.isCancelled) return false;
      if (st === 'returned' && !o.isReturned) return false;
      if (st === 'delivered' && (o.isCancelled || o.isReturned || o.status !== 'delivered')) return false;
      if (st === 'completed' && (o.isCancelled || o.isReturned)) return false;
      if (st === 'open' && (o.status === 'delivered' || o.isCancelled || o.isReturned)) return false;
    }
    if (pay !== 'all') {
      const isDelivery = o.paymentTiming === 'delivery';
      if (pay === 'approved' && isDelivery) return false;
      if (pay === 'delivery' && !isDelivery) return false;
      if (pay !== 'approved' && pay !== 'delivery' && o.paymentMethod !== pay) return false;
    }
    return true;
  });
}

let REPORT_PAGE = 1;
const REPORT_PER_PAGE = 6;

window.setReportPage = function(page) {
  REPORT_PAGE = page;
  applyReportTableFilters(false);
};

window.applyReportTableFilters = function(resetPage = false) {
  if (!CURRENT_REPORT) return;
  const tbody = $('#report-orders-table-body');
  const paginationBox = $('#report-orders-pagination');
  if (!tbody) return;

  if (resetPage) {
    REPORT_PAGE = 1;
  }

  const filtered = getFilteredReportOrders(CURRENT_REPORT.orders || []);
  const total = filtered.length;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:18px;color:var(--mut)">Nenhum pedido encontrado para os filtros selecionados.</td></tr>`;
    if (paginationBox) paginationBox.innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / REPORT_PER_PAGE));
  if (REPORT_PAGE > totalPages) REPORT_PAGE = totalPages;
  if (REPORT_PAGE < 1) REPORT_PAGE = 1;

  const start = (REPORT_PAGE - 1) * REPORT_PER_PAGE;
  const pageOrders = filtered.slice(start, start + REPORT_PER_PAGE);

  tbody.innerHTML = pageOrders.map(o => `
    <tr style="${o.isCancelled ? 'opacity:0.8;background:rgba(239,68,68,0.06)' : (o.isReturned ? 'opacity:0.85;background:rgba(245,158,11,0.06)' : '')}">
      <td><b>#${o.orderNo}</b></td>
      <td>
        ${o.isCancelled 
          ? `<span class="order-badge danger" style="font-size:10px">Cancelado</span>${o.cancellationReason ? `<div style="font-size:10px;color:var(--danger);max-width:140px;line-height:1.2;margin-top:2px">${esc(o.cancellationReason)}</div>` : ''}` 
          : (o.isReturned
            ? `<span class="order-badge" style="background:#b45309;color:#fff;font-size:10px">Devolvido</span>${o.returnReason ? `<div style="font-size:10px;color:#f59e0b;max-width:140px;line-height:1.2;margin-top:2px">${esc(o.returnReason)}</div>` : ''}`
            : (o.status === 'delivered'
              ? `<span class="order-badge success" style="font-size:10px">Concluído</span>`
              : `<span class="order-badge warning" style="font-size:10px">Em Andamento</span>`
            )
          )
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

  if (paginationBox) {
    let pageNumbersHtml = '';
    for (let p = 1; p <= totalPages; p++) {
      pageNumbersHtml += `
        <button class="btn-sm ${p === REPORT_PAGE ? 'btn-next' : 'btn-secondary'}" 
                style="padding:4px 9px;min-width:30px;font-size:12px;font-weight:${p === REPORT_PAGE ? 'bold' : 'normal'}" 
                onclick="setReportPage(${p})">${p}</button>
      `;
    }

    paginationBox.innerHTML = `
      <div style="font-size:13px;color:var(--mut)">
        Mostrando <b>${start + 1} - ${Math.min(start + REPORT_PER_PAGE, total)}</b> de <b>${total}</b> pedidos (6 por página)
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <button class="btn-sm btn-secondary" style="padding:4px 10px;font-size:12px" onclick="setReportPage(${REPORT_PAGE - 1})" ${REPORT_PAGE <= 1 ? 'disabled' : ''}>◀ Anterior</button>
        <div style="display:flex;gap:4px">${pageNumbersHtml}</div>
        <button class="btn-sm btn-secondary" style="padding:4px 10px;font-size:12px" onclick="setReportPage(${REPORT_PAGE + 1})" ${REPORT_PAGE >= totalPages ? 'disabled' : ''}>Próximo ▶</button>
      </div>
    `;
  }
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

// Renderização Inteligente: Horários de Maior Volume e Top Acompanhamentos Mais Consumidos
function renderPeakHoursAndAcompRank(orders) {
  const peakBox = $('#report-peak-hours-container');
  const acompBox = $('#report-top-acomp-container');

  if (!orders || !orders.length) {
    if (peakBox) peakBox.innerHTML = '<p style="color:var(--mut);font-size:13px">Nenhum dado de horário no período selecionado.</p>';
    if (acompBox) acompBox.innerHTML = '<p style="color:var(--mut);font-size:13px">Nenhum dado de acompanhamentos no período selecionado.</p>';
    return;
  }

  // 1. Horários de Pico (Contagem 00h às 23h)
  const hourCounts = {};
  for (let i = 0; i < 24; i++) hourCounts[i] = 0;

  // 2. Acompanhamentos Mais Pedidos
  const acompCounts = {};

  orders.forEach(o => {
    if (o.createdAt) {
      try {
        const d = new Date(o.createdAt);
        const h = d.getHours();
        if (!isNaN(h)) hourCounts[h] = (hourCounts[h] || 0) + 1;
      } catch (e) {}
    }

    if (!o.isCancelled && Array.isArray(o.items)) {
      o.items.forEach(it => {
        const list = [];
        if (Array.isArray(it.accompaniments)) {
          it.accompaniments.forEach(a => {
            const name = typeof a === 'string' ? a : (a && a.name ? a.name : '');
            if (name) list.push(name);
          });
        }
        if (Array.isArray(it.fruits)) {
          it.fruits.forEach(f => {
            const name = typeof f === 'string' ? f : (f && f.name ? f.name : '');
            if (name) list.push(name);
          });
        }
        if (Array.isArray(it.extras)) {
          it.extras.forEach(ex => {
            const name = typeof ex === 'string' ? ex : (ex && ex.name ? ex.name : '');
            if (name) list.push(name);
          });
        }
        list.forEach(name => {
          const clean = name.trim();
          if (clean) acompCounts[clean] = (acompCounts[clean] || 0) + (it.quantity || 1);
        });
      });
    }
  });

  // Renderiza Gráfico de Barras de Horários
  if (peakBox) {
    const hoursWithOrders = Object.entries(hourCounts)
      .map(([h, cnt]) => ({ hour: parseInt(h, 10), count: cnt }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count);

    if (hoursWithOrders.length === 0) {
      peakBox.innerHTML = '<p style="color:var(--mut);font-size:13px">Nenhum pedido no período para análise de horários.</p>';
    } else {
      const topHours = hoursWithOrders.slice(0, 6);
      const maxCount = Math.max(...topHours.map(x => x.count), 1);

      peakBox.innerHTML = topHours.map(item => {
        const pct = Math.round((item.count / maxCount) * 100);
        const isPeak = pct >= 80;
        const hourStr = `${String(item.hour).padStart(2, '0')}:00`;

        return `
          <div class="peak-hour-bar-row">
            <span class="peak-hour-label">${hourStr}</span>
            <div class="peak-hour-track">
              <div class="peak-hour-fill ${isPeak ? 'peak' : ''}" style="width: ${Math.max(pct, 10)}%"></div>
            </div>
            <span class="peak-hour-val">${item.count} ped. (${pct}%)</span>
          </div>
        `;
      }).join('');
    }
  }

  // Renderiza Top 5 Acompanhamentos / Frutas / Insumos
  if (acompBox) {
    const sortedAcomps = Object.entries(acompCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    if (sortedAcomps.length === 0) {
      acompBox.innerHTML = '<p style="color:var(--mut);font-size:13px">Nenhum acompanhamento registrado nos pedidos deste período.</p>';
    } else {
      const medals = ['🥇', '🥈', '🥉', '4º', '5º'];
      acompBox.innerHTML = sortedAcomps.map((item, idx) => `
        <div class="acomp-rank-row">
          <div class="acomp-rank-name">
            <span style="font-size:15px">${medals[idx] || `${idx + 1}º`}</span>
            <span>${esc(item.name)}</span>
          </div>
          <span class="acomp-rank-badge">${item.count} saídas</span>
        </div>
      `).join('');
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
      renderBestSellersManager();
    }
  } catch (e) {}
}

// ================= GESTÃO DA SEÇÃO MAIS VENDIDOS =================
function renderBestSellersManager() {
  const container = $('#bestsellers-manager-list');
  const select = $('#sel-add-bestseller');
  if (!container || !select) return;

  const currentIds = Array.isArray(SETTINGS.bestSellerProductIds) ? SETTINGS.bestSellerProductIds : [];
  const currentProducts = currentIds.map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);

  // Lista todos os produtos e combos ativos cadastrados que ainda não estão nos Mais Vendidos (sem repetição)
  const availableToAdd = PRODUCTS.filter(p => p.active && !currentIds.includes(p.id));
  
  select.innerHTML = availableToAdd.length === 0
    ? `<option value="">Todos os itens já foram adicionados</option>`
    : `<option value="">-- Selecione para adicionar --</option>` +
      availableToAdd.map(p => {
        const cat = p.categorySlug === 'combos' ? 'Combo' : (p.categorySlug || 'Produto');
        return `<option value="${p.id}">${esc(p.name)} [${cat}]</option>`;
      }).join('');

  if (currentProducts.length === 0) {
    container.innerHTML = `
      <div style="color:var(--mut);font-size:12px;padding:6px 0;font-style:italic">
        Nenhum item adicionado aos Mais Vendidos. A seção não aparecerá no cardápio até você adicionar itens aqui.
      </div>
    `;
    return;
  }

  container.innerHTML = currentProducts.map((p, idx) => `
    <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.06);border:1px solid var(--ln);padding:6px 12px;border-radius:8px">
      <img src="${p.image || 'imagens/do seu jeitinho.png'}" style="width:34px;height:34px;border-radius:6px;object-fit:cover" onerror="this.src='imagens/do seu jeitinho.png'">
      <div>
        <div style="font-size:12px;font-weight:700;color:#fff">${esc(p.name)}</div>
        <small style="font-size:10px;color:var(--y);font-weight:700">★ #${idx + 1} em Mais Vendidos</small>
      </div>
      <button class="btn-sm btn-danger" style="font-size:10px;padding:3px 8px;margin-left:6px" onclick="removeBestSeller('${p.id}')" title="Remover da seção Mais Vendidos">Remover ✕</button>
    </div>
  `).join('');
}

window.addSelectedToBestSellers = async function() {
  const sel = $('#sel-add-bestseller');
  if (!sel || !sel.value) {
    adminToast('Selecione um produto para adicionar aos Mais Vendidos.', 'danger');
    return;
  }
  const prodId = sel.value;
  const currentIds = Array.isArray(SETTINGS.bestSellerProductIds) ? [...SETTINGS.bestSellerProductIds] : [];
  if (!currentIds.includes(prodId)) {
    currentIds.push(prodId);
    await saveBestSellersList(currentIds);
  }
};

window.removeBestSeller = async function(prodId) {
  const currentIds = Array.isArray(SETTINGS.bestSellerProductIds) ? [...SETTINGS.bestSellerProductIds] : [];
  const updated = currentIds.filter(id => id !== prodId);
  await saveBestSellersList(updated);
};

window.toggleProductBestSeller = async function(prodId) {
  const currentIds = Array.isArray(SETTINGS.bestSellerProductIds) ? [...SETTINGS.bestSellerProductIds] : [];
  let updated;
  if (currentIds.includes(prodId)) {
    updated = currentIds.filter(id => id !== prodId);
  } else {
    updated = [...currentIds, prodId];
  }
  await saveBestSellersList(updated);
};

async function saveBestSellersList(newList) {
  try {
    const res = await fetch(`${API_URL}/catalog/best-sellers`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ productIds: newList })
    });
    const data = await res.json();
    if (data.ok) {
      SETTINGS.bestSellerProductIds = newList;
      renderBestSellersManager();
      renderProductsTable();
      adminToast('Seção Mais Vendidos atualizada com sucesso!', 'success');
    } else {
      adminToast(data.error || 'Erro ao atualizar Mais Vendidos.', 'danger');
    }
  } catch (err) {
    adminToast('Erro de conexão ao salvar Mais Vendidos.', 'danger');
  }
}

let PRODUCTS_PAGE = 1;
let PRODUCTS_PER_PAGE = 10;
let PRODUCT_VIEW_MODE = 'table';

window.setProductViewMode = function(mode) {
  PRODUCT_VIEW_MODE = mode;
  const btnTable = $('#btn-prod-view-table');
  const btnGrid = $('#btn-prod-view-grid');
  const tableCont = $('#products-table-container');
  const gridCont = $('#products-grid-view');

  if (mode === 'grid') {
    if (btnGrid) btnGrid.classList.add('active');
    if (btnTable) btnTable.classList.remove('active');
    if (tableCont) tableCont.style.display = 'none';
    if (gridCont) gridCont.style.display = 'grid';
    renderProductsVitrineGrid();
  } else {
    if (btnTable) btnTable.classList.add('active');
    if (btnGrid) btnGrid.classList.remove('active');
    if (tableCont) tableCont.style.display = 'block';
    if (gridCont) gridCont.style.display = 'none';
  }
};

function renderProductsVitrineGrid() {
  const grid = $('#products-grid-view');
  if (!grid) return;
  const total = PRODUCTS.length;
  const perPage = PRODUCTS_PER_PAGE || 10;
  const start = (PRODUCTS_PAGE - 1) * perPage;
  const pageProducts = PRODUCTS.slice(start, start + perPage);

  if (pageProducts.length === 0) {
    grid.innerHTML = '<p style="color:var(--mut);font-size:13px;grid-column:1/-1;text-align:center;padding:24px">Nenhum produto cadastrado.</p>';
    return;
  }

  grid.innerHTML = pageProducts.map(p => {
    const isBest = Array.isArray(SETTINGS.bestSellerProductIds) && SETTINGS.bestSellerProductIds.includes(p.id);
    const prices = Array.isArray(p.prices) ? p.prices : [];
    const minPrice = prices.length ? Math.min(...prices.map(pr => pr.price)) : 0;
    const maxPrice = prices.length ? Math.max(...prices.map(pr => pr.price)) : 0;
    const priceLabel = minPrice === maxPrice ? R(minPrice) : `${R(minPrice)} ~ ${R(maxPrice)}`;
    
    const margins = prices.map(pr => pr.price > 0 ? Math.round(((pr.price - (pr.costPrice || 0)) / pr.price) * 100) : 0);
    const avgMargin = margins.length ? Math.round(margins.reduce((a, b) => a + b, 0) / margins.length) : 0;

    return `
      <div class="prod-vitrine-card ${p.active ? '' : 'paused'}">
        <div class="prod-vitrine-img-wrap">
          <img src="${p.image || 'imagens/do seu jeitinho.png'}" alt="${esc(p.name)}" class="prod-vitrine-img" loading="lazy">
          <span class="prod-vitrine-badge ${p.active ? 'badge-active' : 'badge-paused'}">
            ${p.active ? '● Ativo' : '⏸ Pausado'}
          </span>
          ${isBest ? '<span class="prod-vitrine-best">★ Mais Vendido</span>' : ''}
        </div>
        <div class="prod-vitrine-body">
          <div class="prod-vitrine-cat">${esc(p.categorySlug || p.category || 'Geral')}</div>
          <div class="prod-vitrine-title" title="${esc(p.name)}">${esc(p.name)}</div>
          <div class="prod-vitrine-prices">
            <span class="prod-vitrine-val">${priceLabel}</span>
            <span class="prod-vitrine-margin ${avgMargin >= 40 ? 'high' : (avgMargin > 0 ? 'med' : 'low')}">
              ${avgMargin > 0 ? `Lucro ~${avgMargin}%` : (p.hasAnyLoss ? 'Prejuízo' : 'Margem 0%')}
            </span>
          </div>
          <div class="prod-vitrine-actions">
            <button class="btn-sm ${p.active ? 'btn-next' : 'btn-secondary'}" onclick="toggleProductPause('${p.id}')" title="Pausar ou Ativar produto">
              ${p.active ? 'Ativo' : 'Pausado'}
            </button>
            <button class="btn-sm btn-print" onclick="openRecipeModal('${p.id}')" title="Ficha Técnica & PDF">Receita</button>
            <button class="btn-sm btn-secondary" onclick="editProductModal('${p.id}')">Editar</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

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
    const isBest = Array.isArray(SETTINGS.bestSellerProductIds) && SETTINGS.bestSellerProductIds.includes(p.id);
    if (isBest) flags.push('<span class="profit-badge" style="background:#f59e0b;color:#000;font-weight:700">★ Mais Vendido</span>');
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
            <button class="btn-sm" style="font-size:11px;padding:3px 7px;background:${isBest ? '#b45309' : 'transparent'};color:${isBest ? '#fff' : 'var(--tx)'};border:1px solid ${isBest ? '#f59e0b' : 'var(--ln)'}" onclick="toggleProductBestSeller('${p.id}')" title="${isBest ? 'Remover dos Mais Vendidos' : 'Destacar na seção Mais Vendidos'}">
              ${isBest ? '★ No Topo' : '☆ + Mais Vendido'}
            </button>
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

  // Mantém a visualização em grade (vitrine) sincronizada
  renderProductsVitrineGrid();
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

window.renderProductAccompanimentsCheckboxes = function(selectedIds = null) {
  const box = $('#product-accompaniments-checkboxes');
  if (!box) return;

  if (!ACCOMPANIMENTS || ACCOMPANIMENTS.length === 0) {
    box.innerHTML = `<span style="font-size:12px;color:var(--mut)">Nenhum acompanhamento cadastrado. Cadastre novos na aba "Acompanhamentos".</span>`;
    return;
  }

  box.innerHTML = ACCOMPANIMENTS.map(ac => {
    const isChecked = selectedIds === null || selectedIds === undefined
      ? (ac.active !== false)
      : (Array.isArray(selectedIds) ? selectedIds.includes(ac.id) : true);

    return `
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin:0;color:#fff">
        <input type="checkbox" class="prod-acomp-cb" value="${ac.id}" ${isChecked ? 'checked' : ''} style="width:auto">
        <span>${esc(ac.name)}</span>
      </label>
    `;
  }).join('');
};

window.toggleAllProductAccompaniments = function(checked) {
  const checkboxes = $$('#product-accompaniments-checkboxes input[type="checkbox"]');
  checkboxes.forEach(cb => { cb.checked = !!checked; });
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
  
  renderProductSizeRows([
    { size: 300, price: 15.90, costPrice: 6.80, maxAccompaniments: 3, promoPrice: null },
    { size: 500, price: 19.90, costPrice: 9.40, maxAccompaniments: 4, promoPrice: null },
    { size: 700, price: 26.90, costPrice: 12.50, maxAccompaniments: 5, promoPrice: null }
  ]);

  $('#loss-alert-box').style.display = 'none';
  handleCategoryChange($('#p-category')?.value);
  renderProductAccompanimentsCheckboxes(null);
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

  renderProductSizeRows(prod.prices || []);

  handleCategoryChange(prod.categoryId, prod.comboProductIds || []);
  // Produto que nunca teve lista salva só oferece acompanhamentos ao cliente se for o "Monte seu açaí";
  // por isso a tela mostra desmarcado (reflete exatamente o que o cliente vê) até você marcar e salvar.
  const isMonteProd = !!prod.isCustomizable || prod.categorySlug === 'monte' || prod.id === 'prod_monte';
  renderProductAccompanimentsCheckboxes(prod.allowedAccompanimentIds || (isMonteProd ? null : []));
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
    const rows = Array.from($$('#p-sizes-list .p-size-row'));
    const row500 = rows.find(r => parseInt(r.querySelector('.p-size-ml').value, 10) === 500) || rows[0];
    if (row500) row500.querySelector('.p-size-cost').value = totalComboCost.toFixed(2);
    checkFormPrejuizo();
  }
};

// ==================== TAMANHOS DO PRODUTO (LISTA DINÂMICA) ====================
function defaultMaxAcompForSize(size) {
  if (size <= 300) return 3;
  if (size <= 500) return 4;
  return 5;
}

function productSizeRowHtml(r) {
  const val = (v) => (v === null || v === undefined || Number.isNaN(v)) ? '' : v;
  return `
    <div class="p-size-row" data-promo="${val(r.promoPrice)}" style="background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b style="color:var(--y)">Tamanho do copo</b>
        <button type="button" class="btn-sm btn-danger" style="font-size:11px;padding:2px 8px" onclick="removeProductSizeRow(this)">Remover</button>
      </div>
      <label style="margin-top:4px">Tamanho (ml)</label>
      <input type="number" min="1" step="1" class="p-size-ml" value="${val(r.size)}" placeholder="Ex: 400" oninput="checkFormPrejuizo()">
      <label style="margin-top:4px">Preço Venda (R$)</label>
      <input type="number" min="0" step="0.01" class="p-size-price" value="${val(r.price)}" oninput="checkFormPrejuizo()">
      <label style="margin-top:4px">Custo Insumos (R$)</label>
      <input type="number" min="0" step="0.01" class="p-size-cost" value="${val(r.costPrice)}" oninput="checkFormPrejuizo()">
      <label style="margin-top:4px">Acomp. Inclusos</label>
      <input type="number" min="0" step="1" class="p-size-max" value="${val(r.maxAccompaniments)}">
    </div>
  `;
}

window.renderProductSizeRows = function(list) {
  const box = $('#p-sizes-list');
  if (!box) return;
  const sorted = [...(list || [])].sort((a, b) => (a.size || 0) - (b.size || 0));
  box.innerHTML = sorted.map(productSizeRowHtml).join('');
};

window.getProductSizeRows = function() {
  return Array.from($$('#p-sizes-list .p-size-row')).map(row => {
    const size = parseInt(row.querySelector('.p-size-ml').value, 10);
    const price = parseFloat(row.querySelector('.p-size-price').value);
    const cost = parseFloat(row.querySelector('.p-size-cost').value) || 0;
    const max = parseInt(row.querySelector('.p-size-max').value, 10) || (Number.isFinite(size) ? defaultMaxAcompForSize(size) : 4);
    const promo = parseFloat(row.dataset.promo);
    return { size, price, cost, max, promoPrice: Number.isFinite(promo) ? promo : null };
  });
};

window.addProductSizeRow = function() {
  const box = $('#p-sizes-list');
  if (!box) return;
  const current = getProductSizeRows().filter(r => Number.isFinite(r.size));
  const biggest = current.reduce((m, r) => Math.max(m, r.size), 0);
  const nextSize = biggest > 0 ? biggest + 200 : 300;
  box.insertAdjacentHTML('beforeend', productSizeRowHtml({
    size: nextSize,
    price: '',
    costPrice: '',
    maxAccompaniments: defaultMaxAcompForSize(nextSize),
    promoPrice: null
  }));
  const rows = Array.from($$('#p-sizes-list .p-size-row'));
  const last = rows[rows.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const priceInput = last.querySelector('.p-size-price');
    if (priceInput) priceInput.focus();
  }
};

window.removeProductSizeRow = function(btn) {
  const rows = Array.from($$('#p-sizes-list .p-size-row'));
  if (rows.length <= 1) {
    adminToast('O produto precisa ter pelo menos um tamanho.', 'danger');
    return;
  }
  const row = btn.closest('.p-size-row');
  if (row) row.remove();
  checkFormPrejuizo();
};

// Checagem em tempo real de prejuízo na edição do produto
window.checkFormPrejuizo = function() {
  const box = $('#loss-alert-box');
  const losses = [];

  getProductSizeRows().forEach(r => {
    const price = Number.isFinite(r.price) ? r.price : 0;
    if (price > 0 && r.cost > price) {
      losses.push(`Tamanho ${r.size || '?'}ml: Custo R$ ${r.cost.toFixed(2)} é MAIOR que Preço R$ ${price.toFixed(2)} (Prejuízo de R$ ${(r.cost - price).toFixed(2)})`);
    }
  });

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

  // Tamanhos do copo (lista dinâmica: adicionar / editar / remover)
  const sizeRows = getProductSizeRows();
  if (sizeRows.length === 0) return adminToast('Adicione pelo menos um tamanho para o produto.', 'danger');

  const prices = [];
  const seenSizes = new Set();
  for (const r of sizeRows) {
    if (!Number.isFinite(r.size) || r.size <= 0) return adminToast('Informe o tamanho em ml de todos os tamanhos.', 'danger');
    if (seenSizes.has(r.size)) return adminToast(`O tamanho ${r.size} ml está repetido. Cada tamanho deve aparecer uma vez.`, 'danger');
    if (!Number.isFinite(r.price) || r.price < 0) return adminToast(`Informe o preço de venda do tamanho ${r.size} ml.`, 'danger');
    seenSizes.add(r.size);
    prices.push({ size: r.size, price: r.price, costPrice: r.cost, maxAccompaniments: r.max, promoPrice: r.promoPrice });
  }
  prices.sort((a, b) => a.size - b.size);

  // Acompanhamentos selecionados para este copo
  const acompCheckboxes = $$('#product-accompaniments-checkboxes input[type="checkbox"]:checked');
  const allowedAccompanimentIds = Array.from(acompCheckboxes).map(cb => cb.value);

  const payload = {
    name,
    categoryId,
    description,
    image,
    isNewLaunch,
    isPromo,
    comboProductIds,
    allowedAccompanimentIds,
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
      if ($('#product-edit-modal')?.style.display === 'flex') {
        // Mantém as marcações atuais do modal aberto (não reseta para "todos marcados")
        const currentlyChecked = Array.from($$('#product-accompaniments-checkboxes input[type="checkbox"]:checked')).map(cb => cb.value);
        renderProductAccompanimentsCheckboxes(currentlyChecked);
      }
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
    <div style="background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <b style="font-size:16px">${esc(p.name)}</b>
        <div style="font-size:12px;color:var(--mut)">Destino: <b>${p.target.toUpperCase()}</b> · Bobina: <b>${p.paperWidth}mm</b></div>
        <div style="font-size:13px;font-weight:600;margin-top:4px;color:${p.autoPrintOnApproved ? 'var(--green)' : 'var(--y)'}">
          ${p.autoPrintOnApproved ? '⚡ Auto-impressão ATIVA (Sai automático)' : '✋ Auto-impressão DESLIGADA (Impressão somente manual)'}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-sm" style="background:${p.autoPrintOnApproved ? 'rgba(239,68,68,0.2);color:#ef4444;border:1px solid #ef4444' : 'rgba(16,185,129,0.2);color:#10b981;border:1px solid #10b981'};padding:7px 12px;font-weight:700" onclick="togglePrinterAutoPrint('${p.id}')">
          ${p.autoPrintOnApproved ? 'Desativar Auto' : 'Ativar Auto'}
        </button>
        <button class="btn-sm btn-print" onclick="testPrinterPrint('${p.id}')">Imprimir Teste</button>
      </div>
    </div>
  `).join('');
}

window.togglePrinterAutoPrint = async function(printerId) {
  const p = PRINTERS.find(x => x.id === printerId);
  if (!p) return;
  p.autoPrintOnApproved = !p.autoPrintOnApproved;
  try {
    const res = await fetch(`${API_URL}/printers`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ printers: PRINTERS })
    });
    const data = await res.json();
    if (data.ok) {
      PRINTERS = data.printers;
      renderPrintersList();
      adminToast(`Auto-impressão de ${p.name} ${p.autoPrintOnApproved ? 'ativada' : 'desativada'} com sucesso!`, 'success');
    }
  } catch (e) {
    adminToast('Erro ao atualizar configuração de impressora.', 'danger');
  }
};

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
function updateChatBadge() {
  const badge = $('#badge-unread-chat');
  if (!badge) return;
  const unreadTotal = (CHAT_CONVERSATIONS || []).reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  const activeChats = (CHAT_CONVERSATIONS || []).length;
  const count = unreadTotal > 0 ? unreadTotal : activeChats;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-block' : 'none';
  if (unreadTotal > 0) {
    badge.style.background = 'var(--danger)';
    badge.style.color = '#fff';
  } else {
    badge.style.background = 'var(--y)';
    badge.style.color = '#000';
  }
}

async function loadChatConversations() {
  try {
    const res = await fetch(`${API_URL}/chat/conversations`, { headers: authHeaders() });
    const data = await res.json();
    if (data.ok) {
      CHAT_CONVERSATIONS = data.conversations || [];
      renderChatConversationsList();
      updateChatBadge();
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
  renderChatActiveOrderSummary(phone);
  loadChatMessages(phone);

  if (window.innerWidth <= 768) {
    const chatWin = $('.admin-chat-window');
    if (chatWin) chatWin.scrollIntoView({ behavior: 'smooth' });
  }
};

window.renderChatActiveOrderSummary = function(phone) {
  const container = $('#chat-customer-active-order');
  const textEl = $('#chat-order-summary-text');
  if (!container || !textEl) return;

  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 8) {
    container.style.display = 'none';
    return;
  }

  // Localiza pedido recente do cliente
  const order = (ORDERS || []).find(o => {
    const op = String(o.customer?.phone || '').replace(/\D/g, '');
    const isActive = o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'returned';
    return isActive && (op.endsWith(cleanPhone) || cleanPhone.endsWith(op));
  }) || (ORDERS || []).find(o => {
    const op = String(o.customer?.phone || '').replace(/\D/g, '');
    return op && (op.endsWith(cleanPhone) || cleanPhone.endsWith(op));
  });

  if (!order) {
    container.style.display = 'none';
    return;
  }

  const statusMap = {
    received: '📥 Recebido',
    preparing: '🍧 Em Preparo',
    ready: order.delivery?.type === 'pickup' ? '🏪 Pronto no Balcão' : '🛵 Pronto / Saiu',
    out_for_delivery: '🛵 Saiu para Entrega',
    delivered: '✅ Entregue',
    cancelled: '❌ Cancelado',
    returned: '↩ Devolvido'
  };
  const stText = statusMap[order.status] || order.status;
  const itemsText = (order.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ');

  textEl.innerHTML = `
    <b>Pedido #${order.orderNo}</b> (${stText}) · <b>${R(order.total)}</b><br>
    <span style="opacity:0.85">${esc(itemsText)} · ${order.delivery?.type === 'pickup' ? 'Retirada' : esc(order.delivery?.bairro || 'Entrega')}</span>
  `;
  container.style.display = 'block';
};

window.insertQuickReply = function(text) {
  const inp = $('#admin-chat-input');
  if (!inp) return;
  inp.value = text;
  inp.focus();
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
        let senderLabel = '';
        if (isStore) {
          senderLabel = m.isAutoReply
            ? `🤖 ${esc(m.senderName || 'Explosão Açaí')} (Auto-Resposta · Loja Fechada)`
            : `${esc(m.senderName || SETTINGS.chatSenderName || 'Delivery')} (Loja)`;
        } else {
          senderLabel = `${esc(m.customerName || 'Cliente')}`;
        }
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
      setTimeout(() => { if (box) box.scrollTop = box.scrollHeight; }, 60);
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
  const phoneToClose = ACTIVE_CHAT_PHONE;
  const name = $('#active-chat-name')?.textContent || 'Cliente';

  showConfirmModal({
    icon: '🏁',
    title: 'Finalizar Atendimento',
    message: `Deseja realmente encerrar e limpar a conversa com <b>${esc(name)}</b>?`,
    btnText: 'Finalizar e Limpar Chat',
    btnClass: 'btn-danger',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API_URL}/chat/close`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ customerPhone: phoneToClose })
        });
        const d = await res.json();
        if (d.ok) {
          adminToast('Atendimento finalizado com sucesso!', 'info');
          // Limpa a tela do chat e redefine o atendente
          ACTIVE_CHAT_PHONE = null;
          if ($('#active-chat-name')) $('#active-chat-name').textContent = 'Selecione uma conversa';
          if ($('#active-chat-phone')) $('#active-chat-phone').textContent = '';
          if ($('#btn-edit-chat-name')) $('#btn-edit-chat-name').style.display = 'none';
          if ($('#btn-close-chat')) $('#btn-close-chat').style.display = 'none';
          if ($('#admin-chat-input')) {
            $('#admin-chat-input').placeholder = 'Digite sua resposta...';
            $('#admin-chat-input').value = '';
          }
          if ($('#admin-chat-messages')) {
            $('#admin-chat-messages').innerHTML = '<p style="text-align:center;color:var(--mut);margin:auto">Atendimento finalizado com sucesso. Nenhuma conversa selecionada no momento.</p>';
          }
          await loadChatConversations();
        } else {
          adminToast(d.error || 'Erro ao finalizar atendimento.', 'danger');
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
  if (curPass === newPass) {
    adminToast('A nova senha não pode ser igual à senha atual.', 'danger');
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

// ==================== MAPA DE ENTREGAS & OTIMIZADOR DE ROTAS ====================
let DELIVERY_MAP = null;
let DELIVERY_MARKERS_LAYER = null;
let DELIVERY_ROUTE_LAYER = null;

const STORE_COORDINATES = {
  lat: -20.5904206,
  lon: -47.3689222,
  name: 'Explosão Açaí',
  address: 'Rua Renato Lourenço Fernandes Rosa, 1721, Franca - SP'
};

// Coordenadas aproximadas dos bairros de Franca/SP para plotagem imediata no mapa
const FRANCA_BAIRROS_COORDS = {
  'aeroporto': { lat: -20.589, lon: -47.367 },
  'jd aeroporto': { lat: -20.589, lon: -47.367 },
  'aeroporto 1': { lat: -20.592, lon: -47.365 },
  'aeroporto 2': { lat: -20.588, lon: -47.369 },
  'aeroporto 3': { lat: -20.590, lon: -47.368 },
  'aeroporto 4': { lat: -20.585, lon: -47.366 },
  'santa cruz': { lat: -20.575, lon: -47.375 },
  'jd santa cruz': { lat: -20.575, lon: -47.375 },
  'aviacao': { lat: -20.581, lon: -47.371 },
  'jd aviacao': { lat: -20.581, lon: -47.371 },
  'esmeralda': { lat: -20.578, lon: -47.363 },
  'pq esmeralda': { lat: -20.578, lon: -47.363 },
  'elimar': { lat: -20.584, lon: -47.358 },
  'recanto elimar': { lat: -20.584, lon: -47.358 },
  'horto': { lat: -20.571, lon: -47.382 },
  'parque do horto': { lat: -20.571, lon: -47.382 },
  'sao sebastiao': { lat: -20.562, lon: -47.385 },
  'vila sao sebastiao': { lat: -20.562, lon: -47.385 },
  'progresso': { lat: -20.555, lon: -47.391 },
  'pq progresso': { lat: -20.555, lon: -47.391 },
  'paulistano': { lat: -20.548, lon: -47.396 },
  'jd paulistano': { lat: -20.548, lon: -47.396 },
  'noemia': { lat: -20.552, lon: -47.402 },
  'jd noemia': { lat: -20.552, lon: -47.402 },
  'formosa': { lat: -20.544, lon: -47.390 },
  'vila formosa': { lat: -20.544, lon: -47.390 },
  'polo club': { lat: -20.559, lon: -47.377 },
  'hipica': { lat: -20.550, lon: -47.384 },
  'estacao': { lat: -20.535, lon: -47.395 },
  'vila nova': { lat: -20.540, lon: -47.410 },
  'centro': { lat: -20.538, lon: -47.401 },
  'cidade nova': { lat: -20.528, lon: -47.412 },
  'sao jose': { lat: -20.522, lon: -47.405 },
  'chico julio': { lat: -20.518, lon: -47.415 },
  'brasilandia': { lat: -20.515, lon: -47.385 },
  'redentor': { lat: -20.510, lon: -47.390 },
  'guanabara': { lat: -20.525, lon: -47.382 },
  'leporace': { lat: -20.485, lon: -47.415 },
  'miramontes': { lat: -20.478, lon: -47.425 },
  'vera cruz': { lat: -20.470, lon: -47.430 },
  'santa terezinha': { lat: -20.505, lon: -47.408 },
  'city posto': { lat: -20.501, lon: -47.420 }
};

function resolveOrderCoordinates(order, index) {
  const bairro = (order.delivery?.bairro || '').toLowerCase().trim();
  const foundKey = Object.keys(FRANCA_BAIRROS_COORDS).find(k => bairro.includes(k) || k.includes(bairro));
  
  if (foundKey) {
    const base = FRANCA_BAIRROS_COORDS[foundKey];
    const jitter = (index % 5) * 0.0018 - 0.0036;
    return {
      lat: base.lat + jitter,
      lon: base.lon + ((index % 3) * 0.0015 - 0.0015)
    };
  }

  const offsetLat = ((index + 1) * 0.0035) * Math.sin(index);
  const offsetLon = ((index + 1) * 0.0035) * Math.cos(index);
  return {
    lat: STORE_COORDINATES.lat + offsetLat,
    lon: STORE_COORDINATES.lon + offsetLon
  };
}

window.openDeliveryMapModal = function() {
  const modal = $('#delivery-map-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  const savedMotoboys = localStorage.getItem('explosao_num_motoboys') || '1';
  if ($('#map-num-motoboys')) $('#map-num-motoboys').value = savedMotoboys;

  setTimeout(() => {
    initLeafletDeliveryMap();
    renderDeliveryMapMarkers();
  }, 100);
};

window.closeDeliveryMapModal = function() {
  const modal = $('#delivery-map-modal');
  if (modal) modal.style.display = 'none';
};

function initLeafletDeliveryMap() {
  if (typeof L === 'undefined') return;

  if (!DELIVERY_MAP) {
    DELIVERY_MAP = L.map('delivery-leaflet-map').setView([STORE_COORDINATES.lat, STORE_COORDINATES.lon], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(DELIVERY_MAP);

    DELIVERY_MARKERS_LAYER = L.layerGroup().addTo(DELIVERY_MAP);
    DELIVERY_ROUTE_LAYER = L.layerGroup().addTo(DELIVERY_MAP);
  } else {
    DELIVERY_MAP.invalidateSize();
  }
}

window.renderDeliveryMapMarkers = function() {
  if (!DELIVERY_MAP || !DELIVERY_MARKERS_LAYER) return;

  DELIVERY_MARKERS_LAYER.clearLayers();
  DELIVERY_ROUTE_LAYER.clearLayers();

  const filterStatus = $('#map-status-filter')?.value || 'active';

  const deliveryOrders = ORDERS.filter(o => {
    if (o.delivery?.type !== 'delivery') return false;
    if (o.status === 'cancelled' || o.status === 'returned') return false;

    if (filterStatus === 'ready') return o.status === 'ready' || o.status === 'out_for_delivery';
    if (filterStatus === 'preparing') return o.status === 'preparing';
    if (filterStatus === 'received') return o.status === 'received';
    return o.status !== 'delivered';
  });

  const storeIcon = L.divIcon({
    className: 'custom-map-pin-store',
    html: `
      <div style="background:#7c3aed;color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.6);border:2px solid #fff;font-size:18px">
        🏠
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  const storeMarker = L.marker([STORE_COORDINATES.lat, STORE_COORDINATES.lon], { icon: storeIcon })
    .bindPopup(`
      <div style="font-family:sans-serif;font-size:12px;color:#000">
        <b style="font-size:14px;color:#6b21a8">🏠 Explosão Açaí (Loja)</b><br>
        Rua Renato Lourenço F. Rosa, 1721 · Aeroporto 3<br>
        <small style="color:#666">Ponto inicial e final das entregas</small>
      </div>
    `);
  DELIVERY_MARKERS_LAYER.addLayer(storeMarker);

  const bounds = L.latLngBounds([[STORE_COORDINATES.lat, STORE_COORDINATES.lon]]);
  const routePoints = [[STORE_COORDINATES.lat, STORE_COORDINATES.lon]];

  const counterEl = $('#map-orders-counter');
  if (counterEl) counterEl.textContent = `${deliveryOrders.length} parada${deliveryOrders.length === 1 ? '' : 's'}`;

  const stopsListEl = $('#map-stops-list');
  const btnGoogleRoute = $('#btn-full-google-route');

  if (deliveryOrders.length === 0) {
    if (stopsListEl) {
      stopsListEl.innerHTML = `<div style="text-align:center;padding:24px 10px;color:var(--mut);font-size:12px">Nenhum pedido de delivery para o filtro selecionado.</div>`;
    }
    if (btnGoogleRoute) btnGoogleRoute.style.display = 'none';
    DELIVERY_MAP.setView([STORE_COORDINATES.lat, STORE_COORDINATES.lon], 14);
    return;
  }

  const sortedOrders = [...deliveryOrders].sort((a, b) => (a.freight || 0) - (b.freight || 0));
  CURRENT_MAP_SORTED_ORDERS = sortedOrders;

  let stopsHtml = '';
  const waypoints = [];

  sortedOrders.forEach((order, idx) => {
    const coords = resolveOrderCoordinates(order, idx);
    const stopNumber = idx + 1;
    bounds.extend([coords.lat, coords.lon]);
    routePoints.push([coords.lat, coords.lon]);

    const del = order.delivery || {};
    const fullAddress = `${del.street || 'Rua'}, ${del.number || 'S/N'}, ${del.bairro || 'Bairro'}, Franca - SP`;
    waypoints.push(fullAddress);

    const googleMapsSingleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
    const wazeSingleUrl = `https://waze.com/ul?q=${encodeURIComponent(fullAddress)}&navigate=yes`;

    const statusBadgeColor = order.status === 'ready' || order.status === 'out_for_delivery'
      ? '#3b82f6'
      : (order.status === 'preparing' ? '#f59e0b' : '#10b981');

    const statusBadgeLabel = order.status === 'ready' || order.status === 'out_for_delivery'
      ? 'Pronto / Em Rota'
      : (order.status === 'preparing' ? 'Em Preparo' : 'Novo Pedido');

    const orderIcon = L.divIcon({
      className: 'custom-map-pin-order',
      html: `
        <div style="background:${statusBadgeColor};color:#fff;font-weight:900;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.5);border:2px solid #fff;font-size:13px">
          ${stopNumber}
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([coords.lat, coords.lon], { icon: orderIcon })
      .bindPopup(`
        <div style="font-family:sans-serif;font-size:12px;color:#000;min-width:200px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <b style="font-size:14px;color:#7c3aed">#${order.orderNo} · Parada ${stopNumber}</b>
            <span style="font-size:10px;background:${statusBadgeColor};color:#fff;padding:2px 6px;border-radius:4px">${statusBadgeLabel}</span>
          </div>
          <b>Cliente:</b> ${esc(order.customer?.name || 'Cliente')}<br>
          <b>Endereço:</b> ${esc(fullAddress)}<br>
          ${del.reference ? `<b>Ref:</b> ${esc(del.reference)}<br>` : ''}
          <b>Total:</b> ${R(order.total)} (${esc(order.payment?.method || 'Dinheiro')})<br>
          <div style="display:flex;gap:6px;margin-top:8px">
            <a href="${googleMapsSingleUrl}" target="_blank" style="flex:1;background:#2563eb;color:#fff;text-align:center;padding:5px 8px;border-radius:6px;text-decoration:none;font-weight:700;font-size:11px">📍 Google Maps</a>
            <a href="${wazeSingleUrl}" target="_blank" style="flex:1;background:#059669;color:#fff;text-align:center;padding:5px 8px;border-radius:6px;text-decoration:none;font-weight:700;font-size:11px">🚗 Waze</a>
          </div>
        </div>
      `);
    DELIVERY_MARKERS_LAYER.addLayer(marker);

    stopsHtml += `
      <div style="background:rgba(255,255,255,0.05);border:1px solid var(--ln);border-radius:10px;padding:10px;transition:0.2s">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" class="map-stop-checkbox" data-order-id="${order.id}" checked onchange="updateSelectedMapRoute()">
            <span style="background:${statusBadgeColor};color:#fff;font-size:11px;font-weight:800;padding:2px 8px;border-radius:12px">
              Parada ${stopNumber} · Pedido #${order.orderNo}
            </span>
          </label>
          <b style="font-size:12px;color:var(--y)">${R(order.total)}</b>
        </div>
        <div style="font-size:12px;font-weight:700;color:#fff;margin-top:6px">${esc(order.customer?.name || 'Cliente')}</div>
        <div style="font-size:11px;color:var(--mut);line-height:1.3;margin-top:2px">${esc(fullAddress)}</div>
        ${del.reference ? `<div style="font-size:11px;color:#fef08a;margin-top:2px">Ref: ${esc(del.reference)}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:8px">
          <a href="${googleMapsSingleUrl}" target="_blank" style="flex:1;background:#1e40af;color:#fff;text-align:center;padding:4px 6px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:700">📍 Google Maps</a>
          <a href="${wazeSingleUrl}" target="_blank" style="flex:1;background:#047857;color:#fff;text-align:center;padding:4px 6px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:700">🚗 Waze</a>
        </div>
      </div>
    `;
  });

  if (stopsListEl) stopsListEl.innerHTML = stopsHtml;

  if (routePoints.length > 1) {
    const routeLine = L.polyline(routePoints, {
      color: '#a855f7',
      weight: 3,
      opacity: 0.8,
      dashArray: '8, 8'
    });
    DELIVERY_ROUTE_LAYER.addLayer(routeLine);
  }

  DELIVERY_MAP.fitBounds(bounds, { padding: [40, 40] });
  updateSelectedMapRoute();
};

let CURRENT_MAP_SORTED_ORDERS = [];
let CURRENT_SELECTED_ROUTE_LABEL = 'Todas as Entregas';

window.changeMotoboyCount = function(delta) {
  const inp = $('#map-num-motoboys');
  if (!inp) return;
  let val = (parseInt(inp.value, 10) || 1) + delta;
  if (val < 1) val = 1;
  if (val > 25) val = 25;
  inp.value = val;
  localStorage.setItem('explosao_num_motoboys', String(val));
  splitRoutesEqually();
};

window.getSelectedMapOrders = function() {
  const checkboxes = document.querySelectorAll('.map-stop-checkbox:checked');
  const ids = Array.from(checkboxes).map(cb => cb.dataset.orderId);
  return (CURRENT_MAP_SORTED_ORDERS || []).filter(o => ids.includes(o.id));
};

window.toggleSelectAllMapStops = function(isChecked, btnEl = null) {
  CURRENT_SELECTED_ROUTE_LABEL = 'Todas as Entregas';
  const checkboxes = document.querySelectorAll('.map-stop-checkbox');
  checkboxes.forEach(cb => cb.checked = isChecked);

  if (btnEl) {
    const allBtns = document.querySelectorAll('#map-split-routes-buttons button');
    allBtns.forEach(b => {
      b.style.background = b.textContent.includes('Todas') || b.textContent.includes('Todos') ? 'rgba(255,255,255,0.1)' : '#2563eb';
      b.style.border = '1px solid transparent';
      b.style.boxShadow = 'none';
    });
    btnEl.style.background = '#7c3aed';
    btnEl.style.border = '1.5px solid #fff';
    btnEl.style.boxShadow = '0 2px 8px rgba(124,58,237,0.5)';
  }

  updateSelectedMapRoute();
};

window.splitRoutesEqually = function() {
  const numMotoboys = Math.max(1, parseInt($('#map-num-motoboys')?.value || '1', 10));
  localStorage.setItem('explosao_num_motoboys', String(numMotoboys));
  const container = $('#map-split-routes-container');
  const buttonsBox = $('#map-split-routes-buttons');
  if (!container || !buttonsBox) return;

  const total = (CURRENT_MAP_SORTED_ORDERS || []).length;
  if (total === 0) {
    return adminToast('Nenhum pedido disponível para criar rotas.', 'warning');
  }

  // Caso tenha apenas 1 motoboy disponível hoje
  if (numMotoboys === 1) {
    const allIds = JSON.stringify(CURRENT_MAP_SORTED_ORDERS.map(o => o.id)).replace(/"/g, '&quot;');
    buttonsBox.innerHTML = `
      <button type="button" class="btn-sm" style="background:#7c3aed;color:#fff;border:1.5px solid #fff;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap;box-shadow:0 2px 8px rgba(124,58,237,0.5)" onclick="selectSpecificOrdersList(${allIds}, 'Rota Única (Todas as ${total} entregas)', this)">
        🛵 Rota Única (Todas as ${total} entregas)
      </button>
    `;
    container.style.display = 'block';
    const activeBtn = buttonsBox.querySelector('button');
    selectSpecificOrdersList(CURRENT_MAP_SORTED_ORDERS.map(o => o.id), 'Rota Única', activeBtn);
    adminToast(`✓ Rota única configurada com todos os ${total} pedidos!`, 'success');
    return;
  }

  // Divisão equilibrada para múltiplos motoboys (2, 3, 4, 5... quantos tiver!)
  const chunkSize = Math.ceil(total / numMotoboys);
  const groups = [];
  for (let i = 0; i < total; i += chunkSize) {
    groups.push(CURRENT_MAP_SORTED_ORDERS.slice(i, i + chunkSize));
  }

  let html = '';
  groups.forEach((group, idx) => {
    const routeNum = idx + 1;
    const orderIds = JSON.stringify(group.map(o => o.id)).replace(/"/g, '&quot;');
    const isFirst = idx === 0;
    html += `
      <button type="button" class="btn-sm" style="${isFirst ? 'background:#7c3aed;color:#fff;border:1.5px solid #fff;box-shadow:0 2px 8px rgba(124,58,237,0.5)' : 'background:#2563eb;color:#fff;border:1px solid transparent'};border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap" onclick="selectSpecificOrdersList(${orderIds}, 'Rota ${routeNum}', this)">
        🛵 Rota ${routeNum} (${group.length} entrega${group.length > 1 ? 's' : ''})
      </button>
    `;
  });

  html += `
    <button type="button" class="btn-sm" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid var(--ln);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap" onclick="toggleSelectAllMapStops(true, this)">
      Todas (${total})
    </button>
  `;

  buttonsBox.innerHTML = html;
  container.style.display = 'block';

  // Seleciona a Rota 1 por padrão
  if (groups.length > 0) {
    const firstBtn = buttonsBox.querySelector('button');
    selectSpecificOrdersList(groups[0].map(o => o.id), 'Rota 1', firstBtn);
    adminToast(`✓ Pedidos divididos em ${groups.length} rotas para ${numMotoboys} motoboy${numMotoboys > 1 ? 's' : ''}!`, 'success');
  }
};

window.selectSpecificOrdersList = function(orderIds, routeLabel = 'Rota', btnEl = null) {
  CURRENT_SELECTED_ROUTE_LABEL = routeLabel;
  const checkboxes = document.querySelectorAll('.map-stop-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = orderIds.includes(cb.dataset.orderId);
  });
  const selectAllCb = $('#map-select-all-stops');
  if (selectAllCb) selectAllCb.checked = (orderIds.length === (CURRENT_MAP_SORTED_ORDERS || []).length);

  // Destaca o botão da rota selecionada
  if (btnEl) {
    const allBtns = document.querySelectorAll('#map-split-routes-buttons button');
    allBtns.forEach(b => {
      b.style.background = (b.textContent.includes('Todas') || b.textContent.includes('Todos')) ? 'rgba(255,255,255,0.1)' : '#2563eb';
      b.style.border = '1px solid transparent';
      b.style.boxShadow = 'none';
    });
    btnEl.style.background = '#7c3aed';
    btnEl.style.border = '1.5px solid #fff';
    btnEl.style.boxShadow = '0 2px 8px rgba(124,58,237,0.5)';
  }

  updateSelectedMapRoute();
};

window.updateSelectedMapRoute = function() {
  const selected = getSelectedMapOrders();
  const btnGoogleRoute = $('#btn-full-google-route');
  const btnWppRoute = $('#btn-wpp-send-route');
  const btnCopyRoute = $('#btn-copy-route-text');
  const btnDispatchRoute = $('#btn-dispatch-selected-route');
  const counterEl = $('#map-orders-counter');
  const routeLabel = CURRENT_SELECTED_ROUTE_LABEL || 'Rota';

  if (counterEl) {
    counterEl.textContent = `${selected.length} de ${CURRENT_MAP_SORTED_ORDERS.length} (${routeLabel})`;
  }

  if (selected.length === 0) {
    if (btnGoogleRoute) btnGoogleRoute.style.display = 'none';
    if (btnWppRoute) btnWppRoute.style.display = 'none';
    if (btnCopyRoute) btnCopyRoute.style.display = 'none';
    if (btnDispatchRoute) btnDispatchRoute.style.display = 'none';
    return;
  }

  const waypoints = selected.map(order => {
    const del = order.delivery || {};
    return `${del.street || 'Rua'}, ${del.number || 'S/N'}, ${del.bairro || 'Bairro'}, Franca - SP`;
  });

  const lastStop = waypoints[waypoints.length - 1];
  const intermediate = waypoints.slice(0, waypoints.length - 1);
  const googleRouteUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(STORE_COORDINATES.address)}&destination=${encodeURIComponent(lastStop)}${intermediate.length > 0 ? `&waypoints=${encodeURIComponent(intermediate.join('|'))}` : ''}&travelmode=driving`;

  if (btnGoogleRoute) {
    btnGoogleRoute.href = googleRouteUrl;
    btnGoogleRoute.innerHTML = `🚀 Abrir ${routeLabel} no Google Maps`;
    btnGoogleRoute.style.display = 'flex';
  }
  if (btnWppRoute) {
    btnWppRoute.innerHTML = `📲 Enviar ${routeLabel} via WhatsApp para Entregador`;
    btnWppRoute.style.display = 'flex';
  }
  if (btnCopyRoute) {
    btnCopyRoute.innerHTML = `📋 Copiar ${routeLabel}`;
    btnCopyRoute.style.display = 'flex';
  }
  if (btnDispatchRoute) {
    btnDispatchRoute.innerHTML = `🛵 Marcar ${routeLabel} em Rota`;
    btnDispatchRoute.style.display = 'flex';
  }
};

window.generateRouteWhatsAppText = function(selected) {
  if (!selected || selected.length === 0) return '';

  const originUrl = window.location.origin;
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const rawRouteLabel = CURRENT_SELECTED_ROUTE_LABEL || 'Rota Geral';
  // Remove qualquer emoji do rótulo para evitar caracteres inválidos ()
  const routeLabel = rawRouteLabel.replace(/[^\w\sÀ-ÿ\(\)\-]/g, '').trim() || 'ROTA GERAL';

  let text = `*${routeLabel.toUpperCase()} - EXPLOSÃO AÇAÍ*\n`;
  text += `Data: ${dateStr} às ${timeStr} · Total: ${selected.length} entrega${selected.length > 1 ? 's' : ''}\n\n`;

  const waypoints = [];
  selected.forEach((order, idx) => {
    const del = order.delivery || {};
    const fullAddress = `${del.street || 'Rua'}, ${del.number || 'S/N'}${del.complement ? ' - ' + del.complement : ''}, ${del.bairro || 'Bairro'}`;
    waypoints.push(`${fullAddress}, Franca - SP`);

    const isMoney = order.payment?.method === 'Dinheiro';
    const isDeliveryPayment = order.payment?.timing === 'delivery' || isMoney;
    const isApproved = order.payment?.status === 'approved';

    let payStr = '';
    if (isDeliveryPayment) {
      if (isMoney) {
        payStr = `Receber em Dinheiro: ${R(order.total)}${order.payment?.trocoValue > 0 ? ` (Levar troco de ${R(order.payment.trocoValue)})` : ''}`;
      } else {
        payStr = `Passar na Maquininha: ${R(order.total)} (${order.payment?.method || 'Cartão'})`;
      }
    } else {
      payStr = isApproved ? `JÁ PAGO ONLINE (${order.payment?.method || 'PIX'}) - NÃO COBRAR` : `Cobrança: ${R(order.total)}`;
    }

    text += `------------------------------------\n`;
    text += `*Parada ${idx + 1} · Pedido #${order.orderNo}*\n`;
    text += `Cliente: ${order.customer?.name || 'Cliente'}\n`;
    text += `Endereço: ${fullAddress}\n`;
    if (del.reference && del.reference.trim()) {
      text += `Ref: ${del.reference.trim()}\n`;
    }
    text += `Pagamento: ${payStr}\n`;
    text += `Link da Entrega: ${originUrl}/motoboy?id=${order.id}\n\n`;
  });

  if (waypoints.length > 0) {
    const lastStop = waypoints[waypoints.length - 1];
    const intermediate = waypoints.slice(0, waypoints.length - 1);
    const googleRouteUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(STORE_COORDINATES.address)}&destination=${encodeURIComponent(lastStop)}${intermediate.length > 0 ? `&waypoints=${encodeURIComponent(intermediate.join('|'))}` : ''}&travelmode=driving`;
    text += `------------------------------------\n`;
    text += `*GPS ROTA COMPLETA (GOOGLE MAPS):*\n${googleRouteUrl}\n`;
  }

  return text;
};

window.openSendRouteToMotoboyModal = function() {
  const selected = getSelectedMapOrders();
  if (selected.length === 0) {
    return adminToast('Selecione pelo menos um pedido para a rota.', 'warning');
  }

  const routeLabel = CURRENT_SELECTED_ROUTE_LABEL || 'Rota';
  const routeText = generateRouteWhatsAppText(selected);
  const routeKey = `last_motoboy_phone_${routeLabel.replace(/\s+/g, '_')}`;
  const rememberedPhone = localStorage.getItem(routeKey) || localStorage.getItem('last_motoboy_phone') || '';
  const phone = prompt(`Digite o WhatsApp do entregador responsável pela [${routeLabel}] (DDD e número, ou deixe em branco para escolher no WhatsApp):`, rememberedPhone);
  if (phone === null) return;

  if (phone.trim()) {
    const clean = phone.replace(/\D/g, '');
    localStorage.setItem(routeKey, clean);
    localStorage.setItem('last_motoboy_phone', clean);
    const ddiPhone = clean.startsWith('55') ? clean : '55' + clean;
    window.open(`https://wa.me/${ddiPhone}?text=${encodeURIComponent(routeText)}`, '_blank');
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(routeText)}`, '_blank');
  }
  adminToast(`✓ ${routeLabel} enviada com sucesso!`, 'success');
};

window.copyFullRouteText = function() {
  const selected = getSelectedMapOrders();
  if (selected.length === 0) {
    return adminToast('Nenhum pedido selecionado.', 'warning');
  }
  const routeText = generateRouteWhatsAppText(selected);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(routeText).then(() => {
      adminToast(`✓ ${CURRENT_SELECTED_ROUTE_LABEL || 'Rota'} copiada para a área de transferência!`, 'success');
    }).catch(() => {
      prompt('Copie o texto da rota abaixo:', routeText);
    });
  } else {
    prompt('Copie o texto da rota abaixo:', routeText);
  }
};

window.dispatchSelectedOrdersRoute = async function() {
  const selected = getSelectedMapOrders();
  if (selected.length === 0) {
    return adminToast('Nenhum pedido selecionado.', 'warning');
  }

  const toDispatch = selected.filter(o => o.status !== 'delivered' && o.status !== 'out_for_delivery');
  if (toDispatch.length === 0) {
    return adminToast('Os pedidos selecionados já estão em rota ou entregues.', 'info');
  }

  try {
    for (const order of toDispatch) {
      await fetch(`${API_URL}/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: 'out_for_delivery' })
      });
      order.status = 'out_for_delivery';
    }
    adminToast(`✓ ${toDispatch.length} pedido(s) despachado(s) para entrega!`, 'success');
    await loadOrders();
    renderDeliveryMapMarkers();
  } catch (e) {
    adminToast('Erro ao atualizar status dos pedidos.', 'danger');
  }
};
