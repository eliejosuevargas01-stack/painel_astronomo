(() => {
  'use strict';

  const LOGIN_FILE = 'login.html';
  const PRIMARY_KEY = 'astronomo_session';
  const LEGACY_KEY = 'userSession';

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

  function currentPage() {
    const path = window.location.pathname || '';
    const parts = path.split('/');
    return parts[parts.length - 1].toLowerCase();
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

  window.AstroAuth = { getSession, requireAuth, logout, hasActiveSession };

  if (!onLoginPage()) {
    requireAuth();
    window.addEventListener('storage', onStorage);
  }
})();
