/**
 * Explosão Açaí — Gestor Pro
 * Componente Global de Modal Moderno e Reutilizável
 * Substituição completa de window.alert, window.confirm e window.prompt
 */

(function () {
  'use strict';

  // Injeção dos estilos CSS do Modal Global
  function injectStyles() {
    if (document.getElementById('global-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'global-modal-styles';
    style.textContent = `
      .global-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(10, 3, 22, 0.82);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        padding: 16px;
        box-sizing: border-box;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.22s ease, visibility 0.22s ease;
      }

      .global-modal-overlay.active {
        opacity: 1;
        visibility: visible;
      }

      .global-modal-card {
        background: linear-gradient(150deg, #1c0b30 0%, #120622 100%);
        border: 1.5px solid #3B1E54;
        border-radius: 22px;
        padding: 26px 24px 22px;
        width: min(460px, 92vw);
        max-width: 460px;
        box-sizing: border-box;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.75), 0 0 24px rgba(147, 51, 234, 0.18);
        text-align: center;
        transform: scale(0.92) translateY(10px);
        transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .global-modal-overlay.active .global-modal-card {
        transform: scale(1) translateY(0);
      }

      .global-modal-icon-badge {
        width: 58px;
        height: 58px;
        border-radius: 18px;
        margin-bottom: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        flex-shrink: 0;
        transition: all 0.2s ease;
      }

      .global-modal-icon-badge.theme-purple {
        background: rgba(147, 51, 234, 0.16);
        border: 1.5px solid rgba(147, 51, 234, 0.45);
        color: #c084fc;
        box-shadow: 0 0 16px rgba(147, 51, 234, 0.2);
      }

      .global-modal-icon-badge.theme-whatsapp,
      .global-modal-icon-badge.theme-green {
        background: rgba(22, 163, 74, 0.18);
        border: 1.5px solid rgba(22, 163, 74, 0.5);
        color: #22c55e;
        box-shadow: 0 0 16px rgba(22, 163, 74, 0.25);
      }

      .global-modal-icon-badge.theme-danger,
      .global-modal-icon-badge.theme-red {
        background: rgba(220, 38, 38, 0.18);
        border: 1.5px solid rgba(220, 38, 38, 0.45);
        color: #f87171;
        box-shadow: 0 0 16px rgba(220, 38, 38, 0.2);
      }

      .global-modal-icon-badge.theme-warning,
      .global-modal-icon-badge.theme-yellow {
        background: rgba(250, 204, 21, 0.15);
        border: 1.5px solid rgba(250, 204, 21, 0.45);
        color: #facc15;
        box-shadow: 0 0 16px rgba(250, 204, 21, 0.2);
      }

      .global-modal-title {
        font-size: 19px;
        font-weight: 800;
        color: #ffffff;
        margin: 0 0 8px 0;
        line-height: 1.3;
        font-family: inherit;
        letter-spacing: -0.2px;
      }

      .global-modal-message {
        font-size: 13.5px;
        line-height: 1.55;
        color: rgba(255, 255, 255, 0.82);
        margin: 0 0 18px 0;
        font-family: inherit;
        word-break: break-word;
      }

      .global-modal-message b {
        color: #ffffff;
        font-weight: 700;
      }

      .global-modal-input-wrap {
        width: 100%;
        margin-bottom: 20px;
        position: relative;
      }

      .global-modal-input {
        width: 100%;
        box-sizing: border-box;
        background: rgba(255, 255, 255, 0.06);
        border: 1.5px solid #3B1E54;
        border-radius: 12px;
        padding: 12px 16px;
        font-size: 15px;
        color: #ffffff;
        font-family: inherit;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
        text-align: left;
      }

      .global-modal-input:focus {
        border-color: #9333EA;
        background: rgba(147, 51, 234, 0.08);
        box-shadow: 0 0 0 3px rgba(147, 51, 234, 0.25);
      }

      .global-modal-input::placeholder {
        color: rgba(255, 255, 255, 0.35);
      }

      .global-modal-actions {
        display: flex;
        gap: 10px;
        width: 100%;
        margin-top: 4px;
      }

      .global-modal-btn {
        padding: 12px 18px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.18s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-family: inherit;
        border: none;
        outline: none;
        min-height: 44px;
        box-sizing: border-box;
      }

      .global-modal-btn-cancel {
        flex: 1;
        background: rgba(255, 255, 255, 0.08);
        border: 1.5px solid rgba(255, 255, 255, 0.14);
        color: rgba(255, 255, 255, 0.85);
      }

      .global-modal-btn-cancel:hover {
        background: rgba(255, 255, 255, 0.14);
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.25);
      }

      .global-modal-btn-confirm {
        flex: 1.25;
        background: linear-gradient(135deg, #9333EA 0%, #7E22CE 100%);
        color: #ffffff;
        box-shadow: 0 4px 14px rgba(147, 51, 234, 0.35);
      }

      .global-modal-btn-confirm:hover {
        background: linear-gradient(135deg, #A855F7 0%, #9333EA 100%);
        box-shadow: 0 6px 18px rgba(147, 51, 234, 0.5);
        transform: translateY(-1px);
      }

      .global-modal-btn-confirm.theme-whatsapp,
      .global-modal-btn-confirm.btn-whatsapp {
        background: linear-gradient(135deg, #16A34A 0%, #15803D 100%);
        box-shadow: 0 4px 14px rgba(22, 163, 74, 0.4);
      }

      .global-modal-btn-confirm.theme-whatsapp:hover,
      .global-modal-btn-confirm.btn-whatsapp:hover {
        background: linear-gradient(135deg, #22C55E 0%, #16A34A 100%);
        box-shadow: 0 6px 18px rgba(22, 163, 74, 0.55);
      }

      .global-modal-btn-confirm.theme-danger,
      .global-modal-btn-confirm.btn-danger {
        background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%);
        box-shadow: 0 4px 14px rgba(220, 38, 38, 0.4);
      }

      .global-modal-btn-confirm.theme-danger:hover,
      .global-modal-btn-confirm.btn-danger:hover {
        background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
        box-shadow: 0 6px 18px rgba(220, 38, 38, 0.55);
      }

      @media (max-width: 480px) {
        .global-modal-card {
          padding: 22px 18px 18px;
          border-radius: 20px;
        }
        .global-modal-title {
          font-size: 18px;
        }
        .global-modal-message {
          font-size: 13px;
          margin-bottom: 16px;
        }
        .global-modal-input {
          font-size: 14px;
          padding: 11px 14px;
        }
        .global-modal-btn {
          font-size: 13.5px;
          padding: 11px 14px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Elementos do DOM mantidos pelo Singleton
  let overlayEl = null;
  let cardEl = null;
  let iconBadgeEl = null;
  let titleEl = null;
  let messageEl = null;
  let inputWrapEl = null;
  let inputEl = null;
  let cancelBtnEl = null;
  let confirmBtnEl = null;

  let currentResolver = null;
  let currentMode = null;
  let currentMaskType = null;

  function ensureModalDOM() {
    injectStyles();
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'global-system-modal';
    overlayEl.className = 'global-modal-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');

    overlayEl.innerHTML = `
      <div class="global-modal-card" id="global-modal-card" onclick="event.stopPropagation()">
        <div class="global-modal-icon-badge" id="global-modal-icon-badge">💬</div>
        <h3 class="global-modal-title" id="global-modal-title">Título</h3>
        <div class="global-modal-message" id="global-modal-message">Mensagem descritiva...</div>
        
        <div class="global-modal-input-wrap" id="global-modal-input-wrap" style="display:none">
          <input type="text" class="global-modal-input" id="global-modal-input" autocomplete="off" spellcheck="false" />
        </div>

        <div class="global-modal-actions" id="global-modal-actions">
          <button type="button" class="global-modal-btn global-modal-btn-cancel" id="global-modal-btn-cancel">Cancelar</button>
          <button type="button" class="global-modal-btn global-modal-btn-confirm" id="global-modal-btn-confirm">Confirmar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    cardEl = overlayEl.querySelector('#global-modal-card');
    iconBadgeEl = overlayEl.querySelector('#global-modal-icon-badge');
    titleEl = overlayEl.querySelector('#global-modal-title');
    messageEl = overlayEl.querySelector('#global-modal-message');
    inputWrapEl = overlayEl.querySelector('#global-modal-input-wrap');
    inputEl = overlayEl.querySelector('#global-modal-input');
    cancelBtnEl = overlayEl.querySelector('#global-modal-btn-cancel');
    confirmBtnEl = overlayEl.querySelector('#global-modal-btn-confirm');

    // Fechar ao clicar fora (no overlay)
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) {
        handleCancel();
      }
    });

    // Tecla ESC para fechar, Enter no input para confirmar
    document.addEventListener('keydown', (e) => {
      if (!overlayEl.classList.contains('active')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        if (currentMode === 'prompt' && document.activeElement === inputEl) {
          e.preventDefault();
          handleConfirm();
        } else if (currentMode !== 'prompt') {
          e.preventDefault();
          handleConfirm();
        }
      }
    });

    cancelBtnEl.addEventListener('click', handleCancel);
    confirmBtnEl.addEventListener('click', handleConfirm);

    // Máscara dinâmica de telefone no input
    inputEl.addEventListener('input', (e) => {
      if (currentMaskType === 'phone') {
        const raw = e.target.value.replace(/\D/g, '');
        e.target.value = formatPhone(raw);
      }
    });
  }

  // Formatador de telefone brasileiro (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
  function formatPhone(digits) {
    if (!digits) return '';
    const d = digits.slice(0, 11);
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }

  function handleCancel() {
    if (!overlayEl || !overlayEl.classList.contains('active')) return;
    overlayEl.classList.remove('active');
    const resolver = currentResolver;
    currentResolver = null;
    if (resolver) {
      if (currentMode === 'prompt') {
        resolver(null); // prompt cancelado retorna null (como o nativo)
      } else if (currentMode === 'confirm') {
        resolver(false); // confirm cancelado retorna false
      } else {
        resolver(true); // alert cancelado / fechado
      }
    }
  }

  function handleConfirm() {
    if (!overlayEl || !overlayEl.classList.contains('active')) return;
    overlayEl.classList.remove('active');
    const resolver = currentResolver;
    currentResolver = null;
    if (resolver) {
      if (currentMode === 'prompt') {
        resolver(inputEl.value); // retorna o texto digitado
      } else if (currentMode === 'confirm') {
        resolver(true); // confirm aprovado retorna true
      } else {
        resolver(true);
      }
    }
  }

  /**
   * customPrompt — Substituição assíncrona para window.prompt
   * Suporta chamada com objeto de opções ou sintaxe clássica (message, defaultValue)
   * @returns {Promise<string|null>}
   */
  function customPrompt(optsOrMessage, defaultVal) {
    ensureModalDOM();
    let opts = {};
    if (typeof optsOrMessage === 'string') {
      opts = { message: optsOrMessage, defaultValue: defaultVal || '' };
    } else if (optsOrMessage && typeof optsOrMessage === 'object') {
      opts = { ...optsOrMessage };
    }

    currentMode = 'prompt';
    currentMaskType = opts.maskType || (
      (opts.title || '').toLowerCase().includes('whatsapp') ||
      (opts.message || '').toLowerCase().includes('whatsapp') ||
      (opts.placeholder || '').includes('9999')
        ? 'phone'
        : null
    );

    // Ícone e Tema
    const isWpp = currentMaskType === 'phone' || (opts.title || '').toLowerCase().includes('whatsapp') || (opts.icon === 'whatsapp');
    const icon = opts.icon || (isWpp ? '🛵' : '✏️');
    iconBadgeEl.textContent = icon;
    iconBadgeEl.className = `global-modal-icon-badge ${isWpp ? 'theme-whatsapp' : 'theme-purple'}`;

    // Título e Mensagem
    titleEl.textContent = opts.title || (isWpp ? 'Enviar Rota via WhatsApp' : 'Entrada de Dados');
    messageEl.innerHTML = opts.message || 'Digite a informação solicitada:';

    // Input
    inputWrapEl.style.display = 'block';
    let val = opts.defaultValue !== undefined && opts.defaultValue !== null ? String(opts.defaultValue) : '';
    if (currentMaskType === 'phone' && val) {
      val = formatPhone(val.replace(/\D/g, ''));
    }
    inputEl.value = val;
    inputEl.placeholder = opts.placeholder || (currentMaskType === 'phone' ? '(16) 99999-9999' : 'Digite aqui...');

    // Botões
    cancelBtnEl.style.display = 'inline-flex';
    cancelBtnEl.textContent = opts.cancelText || 'Cancelar';

    confirmBtnEl.textContent = opts.confirmText || (isWpp ? 'Enviar no WhatsApp' : 'Confirmar');
    confirmBtnEl.className = `global-modal-btn global-modal-btn-confirm ${isWpp ? 'theme-whatsapp' : (opts.confirmClass || '')}`;

    // Exibe overlay
    overlayEl.classList.add('active');

    // Foco imediato no campo
    setTimeout(() => {
      inputEl.focus();
      if (val) {
        inputEl.select();
      }
    }, 50);

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  /**
   * customConfirm — Substituição assíncrona para window.confirm
   * @returns {Promise<boolean>}
   */
  function customConfirm(optsOrMessage) {
    ensureModalDOM();
    let opts = {};
    if (typeof optsOrMessage === 'string') {
      opts = { message: optsOrMessage };
    } else if (optsOrMessage && typeof optsOrMessage === 'object') {
      opts = { ...optsOrMessage };
    }

    currentMode = 'confirm';
    currentMaskType = null;

    const isDanger = (opts.confirmClass || '').includes('danger') || (opts.btnClass || '').includes('danger') || (opts.title || '').toLowerCase().includes('excluir') || (opts.title || '').toLowerCase().includes('cancelar');
    const icon = opts.icon || (isDanger ? '🗑️' : '⚠️');
    iconBadgeEl.textContent = icon;
    iconBadgeEl.className = `global-modal-icon-badge ${isDanger ? 'theme-danger' : 'theme-warning'}`;

    titleEl.textContent = opts.title || 'Confirmar Ação';
    messageEl.innerHTML = opts.message || 'Deseja realmente prosseguir com esta ação?';

    inputWrapEl.style.display = 'none';

    cancelBtnEl.style.display = 'inline-flex';
    cancelBtnEl.textContent = opts.cancelText || 'Cancelar';

    confirmBtnEl.textContent = opts.confirmText || opts.btnText || 'Confirmar';
    confirmBtnEl.className = `global-modal-btn global-modal-btn-confirm ${isDanger ? 'theme-danger' : (opts.confirmClass || opts.btnClass || '')}`;

    overlayEl.classList.add('active');

    setTimeout(() => {
      confirmBtnEl.focus();
    }, 50);

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  /**
   * customAlert — Substituição assíncrona para window.alert
   * @returns {Promise<boolean>}
   */
  function customAlert(optsOrMessage) {
    ensureModalDOM();
    let opts = {};
    if (typeof optsOrMessage === 'string') {
      opts = { message: optsOrMessage };
    } else if (optsOrMessage && typeof optsOrMessage === 'object') {
      opts = { ...optsOrMessage };
    }

    currentMode = 'alert';
    currentMaskType = null;

    const icon = opts.icon || 'ℹ️';
    iconBadgeEl.textContent = icon;
    iconBadgeEl.className = `global-modal-icon-badge theme-purple`;

    titleEl.textContent = opts.title || 'Aviso';
    messageEl.innerHTML = opts.message || '';

    inputWrapEl.style.display = 'none';

    cancelBtnEl.style.display = 'none'; // Apenas OK no alerta
    confirmBtnEl.textContent = opts.btnText || opts.confirmText || 'OK / Entendi';
    confirmBtnEl.className = `global-modal-btn global-modal-btn-confirm`;

    overlayEl.classList.add('active');

    setTimeout(() => {
      confirmBtnEl.focus();
    }, 50);

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  // Compatibilidade com código existente (showConfirmModal / openConfirmModal)
  function showConfirmModalBridge(opts) {
    if (!opts) return;
    const { icon, title, message, btnText, btnClass, onConfirm, onCancel } = opts;
    customConfirm({
      icon: icon || '⚠️',
      title: title || 'Confirmar Ação',
      message: message || '',
      confirmText: btnText || 'Confirmar',
      confirmClass: btnClass || 'btn-next'
    }).then(confirmed => {
      if (confirmed && typeof onConfirm === 'function') {
        onConfirm();
      } else if (!confirmed && typeof onCancel === 'function') {
        onCancel();
      }
    });
  }

  function closeConfirmModalBridge() {
    handleCancel();
  }

  // Exportações Globais
  window.customPrompt = customPrompt;
  window.customConfirm = customConfirm;
  window.customAlert = customAlert;
  window.showConfirmModal = showConfirmModalBridge;
  window.openConfirmModal = showConfirmModalBridge;
  window.closeConfirmModal = closeConfirmModalBridge;

  // Inicializa DOM assim que a página carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureModalDOM);
  } else {
    ensureModalDOM();
  }
})();
