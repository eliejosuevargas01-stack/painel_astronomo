(() => {
  'use strict';

  const LOGIN_FILE = 'login.html';
  const PRIMARY_KEY = 'astronomo_session';
  const LEGACY_KEY = 'userSession';
  const POPUP_STYLE_ID = 'astro-popup-style';
  const POPUP_CONTAINER_ID = 'astro-popup-container';

  function safeParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function pickAstronomoId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const candidates = [
      obj.id_astronomo,
      obj.astronomo_id,
      obj.id,
      obj.user_id,
      obj.usuario_id,
      obj.assistant_id,
      obj.row_number,
      obj.row_num,
    ];
    for (const v of candidates) {
      if (v === undefined || v === null || v === '') continue;
      const num = Number(v);
      if (Number.isFinite(num)) return num;
      return v;
    }
    return null;
  }

  function hasActiveSession(session) {
    if (!session || typeof session !== 'object') return false;
    if (session.loggedIn === true) return true;
    if (session.loginTime || session.token || session.sessionId || session.session_id) return true;
    if (session.id_astronomo != null) return true;
    if (session.usuario || session.username || session.astronomo) return true;
    return false;
  }

  function normalizeLegacySession(legacy) {
    if (!legacy || typeof legacy !== 'object') return null;
    const base =
      legacy.astronomer && typeof legacy.astronomer === 'object'
        ? legacy.astronomer
        : legacy;
    const astroId = pickAstronomoId(base);
    const loginTime = legacy.loginTime || base.loginTime || null;
    const token = legacy.token || base.token || null;
    const timestamp = loginTime ? Date.parse(loginTime) : null;
    return {
      ...base,
      loggedIn: true,
      username: base.usuario || base.username || base.astronomo || null,
      usuario: base.usuario || base.username || base.astronomo || null,
      astronomo: base.astronomo || base.nome_completo || base.nome || base.usuario || null,
      id_astronomo: astroId,
      sessionId: token || base.sessionId || base.session_id || null,
      session_id: token || base.session_id || base.sessionId || null,
      loginTime: loginTime,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    };
  }

  function getSession() {
    const primary = safeParse(localStorage.getItem(PRIMARY_KEY));
    if (hasActiveSession(primary)) return primary;

    const legacy = safeParse(localStorage.getItem(LEGACY_KEY));
    const normalized = normalizeLegacySession(legacy);
    if (hasActiveSession(normalized)) {
      try {
        localStorage.setItem(PRIMARY_KEY, JSON.stringify(normalized));
      } catch (_) {}
      return normalized;
    }
    return null;
  }

  const PUBLIC_PAGES = new Set([
    'index.html',
    'rotas.html',
    'despesas.html',
    'historico.html',
    'feedbacks.html',
    'account.html',
    'apresentacao.html',
  ]);

  function currentPage() {
    const path = window.location.pathname || '';
    const parts = path.split('/');
    const page = (parts[parts.length - 1] || '').toLowerCase();
    return page || 'index.html';
  }

  function isPublicPage() {
    return PUBLIC_PAGES.has(currentPage());
  }

  function onLoginPage() {
    return currentPage() === LOGIN_FILE;
  }

  function redirectToLogin() {
    if (onLoginPage()) return;
    try {
      window.location.replace(LOGIN_FILE);
    } catch (_) {
      window.location.href = LOGIN_FILE;
    }
  }

  function requireAuth() {
    const session = getSession();
    if (!hasActiveSession(session)) {
      try {
        localStorage.removeItem(PRIMARY_KEY);
      } catch (_) {}
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch (_) {}
      redirectToLogin();
      return null;
    }
    return session;
  }

  function logout() {
    try {
      localStorage.removeItem(PRIMARY_KEY);
    } catch (_) {}
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {}
    redirectToLogin();
  }

  function onStorage(event) {
    if (!event) return;
    if (event.key !== PRIMARY_KEY && event.key !== LEGACY_KEY) return;
    if (event.newValue) return;
    requireAuth();
  }

  function ensurePopupStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(POPUP_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = POPUP_STYLE_ID;
    style.textContent = `
      .astro-popup-container{position:fixed;top:16px;right:16px;display:flex;flex-direction:column;gap:10px;z-index:100000;pointer-events:none}
      .astro-popup{min-width:220px;max-width:360px;background:rgba(15,23,42,0.95);color:#e2e8f0;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:12px 14px;box-shadow:0 14px 36px rgba(0,0,0,0.35);display:flex;gap:10px;align-items:flex-start;opacity:0;transform:translateY(-6px);transition:opacity .2s ease,transform .2s ease;pointer-events:auto}
      .astro-popup.show{opacity:1;transform:translateY(0)}
      .astro-popup--warning{border-color:rgba(245,158,11,0.55)}
      .astro-popup--error{border-color:rgba(239,68,68,0.55)}
      .astro-popup--success{border-color:rgba(16,185,129,0.55)}
      .astro-popup__text{flex:1;font-size:0.9rem;line-height:1.4}
      .astro-popup__action{background:rgba(148,163,184,0.16);color:#e2e8f0;border:1px solid rgba(148,163,184,0.35);border-radius:999px;padding:6px 10px;font-size:0.78rem;font-weight:700;cursor:pointer}
      .astro-popup__close{background:transparent;border:0;color:inherit;cursor:pointer;font-size:1rem;line-height:1;padding:0}
    `;
    document.head.appendChild(style);
  }

  function ensurePopupContainer() {
    if (typeof document === 'undefined') return null;
    let container = document.getElementById(POPUP_CONTAINER_ID);
    if (container) return container;
    if (!document.body) return null;
    container = document.createElement('div');
    container.id = POPUP_CONTAINER_ID;
    container.className = 'astro-popup-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
    return container;
  }

  function removePopup(node) {
    if (!node) return;
    node.classList.remove('show');
    setTimeout(() => {
      try { node.remove(); } catch (_) {}
    }, 220);
  }

  function showPopup(message, type = 'info', timeout = 3500, options) {
    if (timeout && typeof timeout === 'object') {
      options = timeout;
      timeout = options && typeof options.timeout === 'number' ? options.timeout : 3500;
    }
    options = options || {};
    if (!message) return;
    try { ensurePopupStyles(); } catch (_) {}
    const container = ensurePopupContainer();
    if (!container) {
      try { window.alert(message); } catch (_) {}
      return;
    }
    const item = document.createElement('div');
    item.className = `astro-popup astro-popup--${type}`;
    const text = document.createElement('div');
    text.className = 'astro-popup__text';
    text.textContent = String(message);
    const actionLabel = options.actionLabel;
    const onAction = typeof options.onAction === 'function' ? options.onAction : null;
    const closeOnAction = options.closeOnAction !== false;
    let actionBtn = null;
    if (actionLabel) {
      actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'astro-popup__action';
      actionBtn.textContent = String(actionLabel);
      if (onAction) {
        actionBtn.addEventListener('click', () => {
          try { onAction(actionBtn, item); } catch (_) {}
          if (closeOnAction) cleanup();
        });
      }
    }
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'astro-popup__close';
    closeBtn.setAttribute('aria-label', 'Fechar');
    closeBtn.textContent = 'x';
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      removePopup(item);
    };
    closeBtn.addEventListener('click', cleanup);
    item.appendChild(text);
    if (actionBtn) item.appendChild(actionBtn);
    item.appendChild(closeBtn);
    container.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    if (timeout != null && timeout !== 0) {
      timer = setTimeout(cleanup, timeout);
    }
  }

  function showNoDataPopup(message) {
    showPopup(message || 'Sem dados', 'warning');
  }

  window.AstroPopup = { show: showPopup, showNoData: showNoDataPopup };
  window.showNoDataPopup = showNoDataPopup;
  window.AstroAuth = { getSession, requireAuth, logout, hasActiveSession };

  if (!onLoginPage() && !isPublicPage()) {
    requireAuth();
    window.addEventListener('storage', onStorage);
  }
})();
