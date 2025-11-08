/* app.js — Dashboard do Astronauta (Agenda + Despesas Unificado)
   ----------------------------------------------------------------------------
   - Fonte de dados única: n8n /webhook/agenda-astronomos
   - Abas: Agenda (original), Despesas (integrada aqui)
   - Despesas:
       • Estimadas a partir dos próprios eventos (MESMA FONTE QUE REAIS)
       • Reais lançadas pelo usuário (por-evento e pelo formulário fixo)
       • Totais por período (Dia / Semana / Faturamento)
       • Lucro Base (26% do faturamento) e Lucro Líquido (26% - despesas)
       • Médias históricas locais (para preencher faltas futuras)
   - Envio de despesas reais: n8n /webhook/agenda-astronomos (POST com action)
   - Mantém: rotas, clima, próximos eventos, histórico, geoloc, WhatsApp etc.
   ----------------------------------------------------------------------------
*/

/* =========================
   CONFIGURAÇÕES / ENDPOINTS
   ========================= */
// Webhook unificado (agenda + login via actions). GET para atualizar agenda.
// Suporta múltiplos endpoints (proxy local, principal e teste)
// Webhook definitivo (produção) — usar sempre host da Urânia
const N8N_WEBHOOK_URLS = [
  'https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/agenda-astronomos',
];
const N8N_LANCAR_DESPESAS_URL = "https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/agenda-astronomos";
// Webhook específico para carregar Feedbacks (POST action=feedback)
const N8N_FEEDBACK_URL = "https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/feedback";

// (Opcional) endpoints para notificar cálculo de rotas
const N8N_CALCULAR_ROTAS_URLS = (function () {
  const overrides = [];
  if (typeof window !== 'undefined' && window.N8N_CALCULAR_ROTAS_URL) {
    overrides.push(String(window.N8N_CALCULAR_ROTAS_URL));
  }
  const defaults = [
    "https://credentialtest.app.n8n.cloud/webhook-test/calcular-rotas",
    "https://credentialtest.app.n8n.cloud/webhook/calcular-rotas",
  ];
  return overrides.concat(defaults).filter(Boolean);
})();

// Timeout mínimo 15min
const WEBHOOK_TIMEOUT_MS =
  typeof window !== "undefined" &&
  window.DASHBOARD_TIMEOUT_MS &&
  Number(window.DASHBOARD_TIMEOUT_MS) > 0
    ? Math.max(900000, Number(window.DASHBOARD_TIMEOUT_MS))
    : 900000;

// Atualização limitada (1x por dia)
const SYNC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_SYNC_KEY = 'agenda_last_sync';
function getLastSync(){ try{ const v = Number(localStorage.getItem(keyFor(LAST_SYNC_KEY))||0); return Number.isFinite(v)? v: 0; }catch(_){ return 0; } }
function setLastSync(){ try{ localStorage.setItem(keyFor(LAST_SYNC_KEY), String(Date.now())); }catch(_){ } }

/* =========================
   AUTENTICAÇÃO BÁSICA
   ========================= */
(function enforceAuthentication(){
  try {
    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
    if (path && /login\.html$/i.test(path)) return;

    const raw = localStorage.getItem('astronomo_session');
    if (!raw) {
      window.location.href = 'login.html';
      return;
    }
    const s = JSON.parse(raw);
    const ageHours = (Date.now() - Number((s && s.timestamp) || 0)) / 36e5;
    if (!s || !s.loggedIn || !Number.isFinite(ageHours) || ageHours >= 24) {
      try { localStorage.removeItem('astronomo_session'); } catch (_) {}
      window.location.href = 'login.html';
      return;
    }
  } catch (_) {
    try { window.location.href = 'login.html'; } catch(_){}
  }
})();

/* =========================
   HELPERS GENÉRICOS
   ========================= */
function getUserSession(){
  try{
    const raw = localStorage.getItem('astronomo_session');
    if(!raw) return null;
    const s = JSON.parse(raw);
    return s && s.loggedIn ? s : null;
  } catch(_){ return null; }
}

function withUserQuery(url){
  try{
    const s = getUserSession();
    if(!s) return url;
    const u = new URL(url);
    // Identificadores básicos do login
    if (s.username)     { u.searchParams.set('usuario', String(s.username)); u.searchParams.set('username', String(s.username)); }
    if (s.assistant_id) { u.searchParams.set('assistant_id', String(s.assistant_id)); }
    if (s.id_astronomo!=null) u.searchParams.set('id_astronomo', String(s.id_astronomo));
    if (s.row_number!=null)   u.searchParams.set('row_number', String(s.row_number));

    // Session ID (prioriza session_id; aceita sessionId apenas para preencher session_id)
    {
      const sid = s.session_id || s.sessionId;
      if (sid) u.searchParams.set('session_id', String(sid));
    }

    // user_id padronizado: sempre o id_astronomo
    try{ if (s.id_astronomo!=null) u.searchParams.set('user_id', String(s.id_astronomo)); }catch(_){ }

    // Não enviar metadados extras nem perfil_*
    return u.toString();
  }catch(_){ return url; }
}

// Fallback para obter id do astrônomo quando a sessão não tiver o campo
function fallbackAstronomoId(){
  try{
    const s = getUserSession();
    if (s && s.id_astronomo!=null) return String(s.id_astronomo);
  }catch(_){ }
  try{
    const ev = (Array.isArray(window.eventosEnriquecidos) && window.eventosEnriquecidos[0]) || null;
    const id = ev && (ev.id_astronomo!=null ? ev.id_astronomo : (ev.astronomo_id!=null ? ev.astronomo_id : null));
    if (id!=null) return String(id);
  }catch(_){ }
  return null;
}

function normalizeUrl(input){
  try {
    const base = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : undefined;
    return new URL(String(input), base).toString();
  } catch (_) {
    try { return encodeURI(String(input)); } catch(__) { return String(input); }
  }
}

// ===== Tema por usuário (paleta em CSS variables) =====
function loadUserTheme(){
  try{ return JSON.parse(localStorage.getItem(keyFor('user_theme'))||'null') || null; }catch(_){ return null; }
}
function saveUserTheme(theme){
  try{ localStorage.setItem(keyFor('user_theme'), JSON.stringify(theme||{})); }catch(_){ }
}
function deriveThemeFromUsername(username){
  try{
    if(!username) return null;
    const u = String(username).toLowerCase();
    // pequenas variações de paleta baseadas no hash do username
    const palettes = [
      { '--accent-purple':'#7b5cff','--accent-cyan':'#34d1f3','--accent-magenta':'#ff5ec4','--accent-gold':'#ffd86b' },
      { '--accent-purple':'#8b5cff','--accent-cyan':'#20e3b2','--accent-magenta':'#ff6b9f','--accent-gold':'#ffc857' },
      { '--accent-purple':'#6a6cff','--accent-cyan':'#4dd0e1','--accent-magenta':'#ff7ea5','--accent-gold':'#ffe082' }
    ];
    let h=0; for(let i=0;i<u.length;i++) h=(h*31+u.charCodeAt(i))>>>0;
    return palettes[h % palettes.length];
  }catch(_){ return null; }
}
function applyUserTheme(){
  try{
    const sess = getUserSession();
    const t = loadUserTheme() || deriveThemeFromUsername(sess && sess.username);
    if (!t) return;
    const root = document.documentElement;
    Object.entries(t).forEach(([k,v])=>{ try{ root.style.setProperty(k, String(v)); }catch(_){ } });
  }catch(_){ }
}

// ===== Google Maps Helpers (buscas locais) =====
function gerarLinkMapsBusca(termo, lat, lon, zoom = 14){
  const la = Number(lat), lo = Number(lon);
  const query = encodeURIComponent(String(termo || '').trim() || 'hotel');
  if (Number.isFinite(la) && Number.isFinite(lo)) {
    return `https://www.google.com/maps/search/${query}/@${la},${lo},${Number(zoom)||14}z`;
  }
  // Fallback: apenas termo (deixe a busca aberta sem coordenadas)
  return `https://www.google.com/maps/search/${query}`;
}

function gerarLinkHoteis(lat, lon, zoom = 14){
  const termo = (typeof window !== 'undefined' && window.HOTEL_SEARCH_TERM) || 'hotel pousada hostel hospedagem';
  return gerarLinkMapsBusca(termo, lat, lon, zoom);
}

function gerarLinkRestaurantes(lat, lon, zoom = 14){
  const termo = (typeof window !== 'undefined' && window.FOOD_SEARCH_TERM) || 'restaurante lanchonete comida';
  return gerarLinkMapsBusca(termo, lat, lon, zoom);
}

function abrirBuscaMaps(termo, lat, lon, cidade, zoom = 14){
  let url = '';
  const la = Number(lat), lo = Number(lon);
  const query = encodeURIComponent(String(termo || ''));
  if (Number.isFinite(la) && Number.isFinite(lo)) {
    url = `https://www.google.com/maps/search/${query}/@${la},${lo},${Number(zoom)||14}z`;
  } else if (cidade) {
    url = `https://www.google.com/maps/search/${query}+${encodeURIComponent(String(cidade))}`;
  } else {
    url = `https://www.google.com/maps/search/${query}`;
  }
  try{ window.open(url, '_blank'); }catch(_){ location.href = url; }
}

function abrirHoteisProximos(lat, lon, cidade){
  const termo = (typeof window !== 'undefined' && window.HOTEL_SEARCH_TERM) || 'hotel pousada hostel hospedagem';
  abrirBuscaMaps(termo, lat, lon, cidade, 14);
}

function abrirRestaurantesProximos(lat, lon, cidade){
  const termo = (typeof window !== 'undefined' && window.FOOD_SEARCH_TERM) || 'restaurante lanchonete comida';
  abrirBuscaMaps(termo, lat, lon, cidade, 14);
}

try{
  window.gerarLinkMapsBusca = gerarLinkMapsBusca;
  window.gerarLinkHoteis = gerarLinkHoteis;
  window.gerarLinkRestaurantes = gerarLinkRestaurantes;
  window.abrirBuscaMaps = abrirBuscaMaps;
  window.abrirHoteisProximos = abrirHoteisProximos;
  window.abrirRestaurantesProximos = abrirRestaurantesProximos;
}catch(_){}

async function getWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, Number(timeoutMs) || 0));
  try {
    const target = normalizeUrl(url);
    const resp = await fetch(target, { method: 'GET', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// Disparo GET tolerante a CORS (não precisa ler resposta)
async function getFireAndForget(url, timeoutMs){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, Number(timeoutMs) || 0));
  const target = normalizeUrl(url);
  try{
    const resp = await fetch(target, { method:'GET', cache:'no-store', signal: controller.signal, headers: { Accept: 'application/json' }, mode: 'cors' });
    return resp;
  } finally { clearTimeout(timer); }
}

function appendQueryParams(url, obj){
  try{
    if (!obj || typeof obj !== 'object') return normalizeUrl(url);
    const target = normalizeUrl(url);
    const u = new URL(target);
    for (const [k,v] of Object.entries(obj)){
      if (v === undefined || v === null) continue;
      const val = (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ? String(v) : JSON.stringify(v);
      try { u.searchParams.set(k, val); } catch(_){ }
    }
    return u.toString();
  }catch(_){ return normalizeUrl(url); }
}

async function postWithTimeout(url, payload, timeoutMs){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, Number(timeoutMs) || 0));
  const target = appendQueryParams(url, payload);
  try {
    // Sempre aguarda resposta do servidor (sem no-cors)
    const resp = await fetch(target, {
      method:'POST',
      headers:{ 'Accept':'application/json' },
      // Sem body: todas as informações vão na querystring
      cache:'no-store',
      signal: controller.signal,
      mode: 'cors'
    });
    return resp;
  } catch (err) {
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// POST que exige leitura do JSON de resposta (sem fallback no-cors)
async function postExpectJson(url, payload, timeoutMs){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, Number(timeoutMs) || 0));
  try {
    // Todas as informações seguem na querystring (compatível com n8n)
    const target = appendQueryParams(url, payload);
    const resp = await fetch(target, {
      method:'POST',
      headers:{ 'Accept':'application/json' },
      // Sem body: todas as informações vão na querystring
      cache:'no-store',
      signal: controller.signal,
      mode: 'cors'
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = (resp.headers.get('content-type')||'').toLowerCase();
    const data = ct.includes('application/json') ? await resp.json() : await resp.text();
    try { return typeof data === 'string' ? JSON.parse(data) : data; } catch(_) { return data; }
  } finally { clearTimeout(timer); }
}

const BRL = (n) => {
  const v = Number(n)||0;
  try { return v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
  catch(_) { return `R$ ${v.toFixed(2)}`; }
};

// Exibir apenas o nome da cidade (sem UF, barras ou complementos)
function sanitizeCityName(s){
  try {
    let v = String(s || '').trim();
    if (!v) return '';
    // remove parenteses e conteúdo
    v = v.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    // corta em separadores comuns: " - ", '-', '/', ',', '–'
    const idxs = [v.indexOf(' - '), v.indexOf('-'), v.indexOf('/'), v.indexOf(','), v.indexOf('–')].filter(i => i >= 0);
    if (idxs.length) v = v.slice(0, Math.min(...idxs));
    // remove pontos finais e normaliza espaços
    v = v.replace(/\.+$/, '').trim().replace(/\s+/g, ' ');
    return v;
  } catch (_) { return String(s||'').trim(); }
}

const parseNum = (v) => {
  if (v==null) return 0;
  if (typeof v === 'number' && isFinite(v)) return v;
  const s = String(v);
  // primeiro número, tolerando pt-BR
  const m = s.match(/-?\d{1,3}(?:[\.\s]\d{3})*(?:[\.,]\d+)?|-?\d+(?:[\.,]\d+)?/);
  if (!m) return 0;
  let num = m[0].trim();
  if (num.includes('.') && num.includes(',')) num = num.replace(/\./g,'').replace(',', '.');
  else if (num.includes(',')) num = num.replace(',', '.');
  else num = num.replace(/\s+/g,'');
  const n = Number(num);
  return isFinite(n) ? n : 0;
};

// Parse de data preservando o dia do evento (evita deslocamentos por fuso/UTC)
function parseDatePreserveUTC(val){
  try{
    if(!val) return null;
    if (val instanceof Date) {
      return new Date(val.getFullYear(), val.getMonth(), val.getDate());
    }
    const s = String(val).trim().replace(/^"|"$/g,'').replace(/^'|'$/g,'');
    // dd/mm/yyyy
    const mBR = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (mBR) return new Date(Number(mBR[3]), Number(mBR[2])-1, Number(mBR[1]));
    // yyyy-mm-dd (ou prefixo de ISO)
    const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) return new Date(Number(mISO[1]), Number(mISO[2])-1, Number(mISO[3]));
    const d = new Date(s);
    if (!isNaN(d)) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return null;
  }catch(_){ return null; }
}

// Parse completo com hora (quando existir); retorna Date ou null
function parseDateWithTime(val){
  try{
    if (!val) return null;
    if (val instanceof Date) return val;
    const s = String(val).trim().replace(/^"|"$/g,'').replace(/^'|'$/g,'');
    // dd/mm/yyyy hh:mm
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m){
      const d = new Date(Number(m[3]), Number(m[2])-1, Number(m[1]), Number(m[4]||'0'), Number(m[5]||'0'), Number(m[6]||'0'));
      return isNaN(d)? null : d;
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }catch(_){ return null; }
}

function toast(msg){
  try{
    const el = document.createElement('div');
    el.className = 'toast-message';
    el.textContent = msg;
    Object.assign(el.style, {
      position:'fixed', bottom:'16px', right:'16px',
      background:'rgba(0,0,0,0.85)', color:'#fff', padding:'10px 14px',
      borderRadius:'8px', zIndex:9999
    });
    document.body.appendChild(el);
    setTimeout(()=>{ try{ el.remove(); }catch(_){ } }, 2200);
  }catch(_){}
}

/* =========================
   ESTADO GLOBAL + STORAGE
   ========================= */
let eventosEnriquecidos = [];
let dadosSincronizados = null;
// Feedbacks que venham no payload fora dos eventos (ex.: listas específicas)
// Feedbacks obtidos diretamente do webhook (action=feedback)
let feedbacksExternos = [];
let feedbackResults = [];
let carregandoFeedbacks = false;
let userLocation = null;
let proximoEventoAtual = null;
let carregandoAgenda = false;

// storage de agenda/histórico
const MAX_PROXIMOS_EVENTOS = 5;
const STORAGE_COMPLETED_KEY = 'agenda_astronomo_eventos_finalizados';
const STORAGE_CANCELED_KEY = 'agenda_astronomo_eventos_cancelados';
const STORAGE_DELETED_KEY = 'agenda_astronomo_eventos_eliminados';
const STORAGE_EVENTS_CACHE_KEY = 'agenda_astronomo_cache_eventos';
const STORAGE_MULTI_DAYS_PROGRESS_KEY = 'agenda_astronomo_multi_days_progress';
const CACHE_TTL_DAYS = 30;
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
const STORAGE_COLLAPSE_KEY = 'agenda_astronomo_collapse';
const DEBUG_FLAG_KEY = 'dashboard_debug';

// Namespace por usuário (evita misturar cache entre astrônomos)
function cacheNamespace(){
  try{
    const s = getUserSession();
    const raw = (s && (s.username || s.USERNAME || s.id_astronomo || s.assistant_id)) || 'anon';
    return String(raw).toLowerCase().replace(/[^a-z0-9_-]+/g,'').slice(0,64) || 'anon';
  }catch(_){ return 'anon'; }
}
function keyFor(base){ return `${base}::${cacheNamespace()}`; }

// Flag opcional para exibir todos os eventos (inclusive antigos)
function showAllEventsEnabled(){
  try{
    const q = new URLSearchParams(location.search||'');
    if (q.get('show_all') === '1' || q.get('history') === 'all') return true;
    const v = localStorage.getItem(keyFor('show_all_events'));
    return v === '1';
  }catch(_){ return false; }
}

/* =========================
   DEBUG MODE (painel flutuante)
   ========================= */
function isDebugEnabled(){
  try{
    const q = new URLSearchParams(location.search);
    if (q.get('debug') === '1' || q.get('debug') === 'true') { localStorage.setItem(DEBUG_FLAG_KEY, '1'); return true; }
    if (q.get('debug') === '0' || q.get('debug') === 'false') { localStorage.removeItem(DEBUG_FLAG_KEY); return false; }
    return localStorage.getItem(DEBUG_FLAG_KEY) === '1';
  }catch(_){ return false; }
}
function toggleDebug(){ try{ const on = !isDebugEnabled(); if(on) localStorage.setItem(DEBUG_FLAG_KEY,'1'); else localStorage.removeItem(DEBUG_FLAG_KEY); location.reload(); }catch(_){}}

function createDebugPanel(){
  if (!isDebugEnabled()) return;
  try{
    const btn = document.createElement('button');
    btn.textContent = 'Debug';
    btn.title = 'Alternar painel de debug';
    Object.assign(btn.style, { position:'fixed', left:'12px', bottom:'12px', zIndex:99999, background:'#111', color:'#fff', border:'1px solid #333', borderRadius:'6px', padding:'6px 10px', cursor:'pointer', opacity:0.8 });
    btn.addEventListener('click', ()=>{ box.style.display = (box.style.display==='none'?'block':'none'); });
    document.body.appendChild(btn);

    const box = document.createElement('div');
    box.id = 'debug-panel';
    Object.assign(box.style, { position:'fixed', left:'12px', bottom:'48px', width:'min(520px, 96vw)', maxHeight:'60vh', overflow:'auto', zIndex:99998, background:'rgba(18,18,18,.96)', color:'#eaeaea', border:'1px solid #333', borderRadius:'8px', boxShadow:'0 6px 18px rgba(0,0,0,.4)', padding:'10px 12px', fontSize:'12px' });
    box.innerHTML = `
      <div id="debug-header" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:move; user-select:none;">
        <strong style="font-size:13px;">Painel de Debug</strong>
        <span id="debug-status" style="opacity:.8"></span>
        <div style="margin-left:auto; display:flex; gap:6px;">
          <button id="dbg-copy-payload" style="padding:4px 8px;">Copiar payload</button>
          <button id="dbg-save-payload" style="padding:4px 8px;">Salvar JSON</button>
          <button id="dbg-copy-normalized" style="padding:4px 8px;">Copiar normalizados</button>
          <button id="dbg-copy-merged" style="padding:4px 8px;">Copiar mesclados</button>
          <button id="dbg-off" style="padding:4px 8px;">Desligar</button>
        </div>
      </div>
      <div id="debug-content" style="display:grid; grid-template-columns: 1fr; gap:8px;"></div>`;
    document.body.appendChild(box);

    // Estiliza botões do cabeçalho para alto contraste (evita caixas esbranquiçadas)
    const styleBtn = (el)=>{
      if (!el) return;
      Object.assign(el.style, {
        appearance: 'none',
        background: '#1b1d24',
        color: '#eaeaea',
        border: '1px solid #3a3f4b',
        borderRadius: '6px',
        padding: '6px 10px',
        fontWeight: 600,
        letterSpacing: '0.2px',
        cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(0,0,0,.25) inset, 0 1px 0 rgba(255,255,255,.06)',
      });
      el.onmouseenter = ()=>{ el.style.background = '#242836'; };
      el.onmouseleave = ()=>{ el.style.background = '#1b1d24'; };
      el.onfocus = ()=>{ el.style.outline = '2px solid #7b5cff'; el.style.outlineOffset = '2px'; };
      el.onblur = ()=>{ el.style.outline = 'none'; };
    };
    const btnPayload = document.getElementById('dbg-copy-payload');
    const btnNorm = document.getElementById('dbg-copy-normalized');
    const btnMerged = document.getElementById('dbg-copy-merged');
    const btnOff = document.getElementById('dbg-off');
    const btnSave = document.getElementById('dbg-save-payload');
    [btnPayload, btnNorm, btnMerged, btnOff, btnSave].forEach(styleBtn);

    // Cores do status
    try{ const st = document.getElementById('debug-status'); if (st) { st.style.color = '#9ad8ff'; st.style.fontWeight = '600'; } }catch(_){ }

    // Handlers
    if (btnOff) btnOff.onclick = toggleDebug;
    if (btnPayload) btnPayload.onclick = ()=>{ try{ navigator.clipboard.writeText(JSON.stringify(window.__DEBUG_LAST_N8N_DATA||null, null, 2)); }catch(_){}};
    if (btnNorm) btnNorm.onclick = ()=>{ try{ navigator.clipboard.writeText(JSON.stringify(window.__DEBUG_LAST_NORMALIZED||null, null, 2)); }catch(_){}};
    if (btnMerged) btnMerged.onclick = ()=>{ try{ navigator.clipboard.writeText(JSON.stringify(window.__DEBUG_LAST_MERGED||null, null, 2)); }catch(_){}};
    if (btnSave) btnSave.onclick = ()=>{
      try{
        const data = window.__DEBUG_LAST_N8N_DATA;
        const blob = new Blob([JSON.stringify(data||null, null, 2)], { type:'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const ts = new Date().toISOString().replace(/[:.]/g,'-');
        a.download = `n8n-payload-${ts}.json`;
        document.body.appendChild(a); a.click(); setTimeout(()=>{ try{ a.remove(); URL.revokeObjectURL(a.href); }catch(_){ } }, 100);
      }catch(_){ }
    };

    // Tornar o painel arrastável
    try{
      const POS_KEY = 'debug_panel_pos';
      const header = document.getElementById('debug-header');
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

      // Restaurar posição anterior (se existir)
      try{
        const saved = JSON.parse(localStorage.getItem(POS_KEY)||'null');
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)){
          box.style.left = `${clamp(saved.left, 0, Math.max(0, window.innerWidth - box.offsetWidth))}px`;
          box.style.top = `${clamp(saved.top, 0, Math.max(0, window.innerHeight - box.offsetHeight))}px`;
          box.style.bottom = '';
        }
      }catch(_){ }

      let dragging = false; let startX = 0, startY = 0; let offX = 0, offY = 0;
      const onDown = (e)=>{
        if (e.button !== 0) return; // apenas botão esquerdo
        if (e.target.closest('button')) return; // não arrasta ao clicar nos botões
        const rect = box.getBoundingClientRect();
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        offX = e.clientX - rect.left; offY = e.clientY - rect.top;
        try{ header.setPointerCapture && header.setPointerCapture(e.pointerId); }catch(_){ }
        e.preventDefault();
      };
      const onMove = (e)=>{
        if (!dragging) return;
        const left = clamp(e.clientX - offX, 0, Math.max(0, window.innerWidth - box.offsetWidth));
        const top  = clamp(e.clientY - offY, 0, Math.max(0, window.innerHeight - box.offsetHeight));
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.bottom = '';
      };
      const onUp = (_e)=>{
        if (!dragging) return;
        dragging = false;
        // Persistir posição
        try{
          const rect = box.getBoundingClientRect();
          localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
        }catch(_){ }
      };
      header.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      // Ajuste ao redimensionar viewport
      window.addEventListener('resize', ()=>{
        try{
          const rect = box.getBoundingClientRect();
          const left = clamp(rect.left, 0, Math.max(0, window.innerWidth - box.offsetWidth));
          const top  = clamp(rect.top, 0, Math.max(0, window.innerHeight - box.offsetHeight));
          box.style.left = `${left}px`; box.style.top = `${top}px`; box.style.bottom = '';
        }catch(_){ }
      });
    }catch(_){ }

    window.__DEBUG_UPDATE = function(){
      try{
        const content = document.getElementById('debug-content'); if (!content) return;
        const evs = Array.isArray(window.eventosEnriquecidos) ? window.eventosEnriquecidos : [];
        const normalized = Array.isArray(window.__DEBUG_LAST_NORMALIZED) ? window.__DEBUG_LAST_NORMALIZED : [];
        const payload = window.__DEBUG_LAST_N8N_DATA;

        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const reaisMap = (typeof loadDespesasReais==='function') ? loadDespesasReais() : {};
        const pendentes = evs.filter(ev=>{ try{ const d=parseDatePreserveUTC(ev.data_agendamento); if(!d) return false; d.setHours(0,0,0,0); if (d>=hoje) return false; const id=String(ev.id); const temReal=!!(reaisMap && Object.prototype.hasOwnProperty.call(reaisMap, id)); return !temReal && !eventosFinalizados.has(id) && !eventosCancelados.has(id) && !eventosEliminados.has(id);}catch(_){ return false; } });
        const withFeedback = evs.filter(ev=> !!extrairFeedback(ev));

        const status = document.getElementById('debug-status');
        if (status) status.textContent = `payload: ${payload? (Array.isArray(payload)? payload.length: (payload && payload.eventos && payload.eventos.length? payload.eventos.length: 'obj')) : 'n/a'} • normalizados: ${normalized.length} • mesclados: ${evs.length}`;

        const sample = evs.slice(0, 8).map(ev=>{
          const d = parseDatePreserveUTC(ev.data_agendamento); const dd = d && !isNaN(d)? d.toLocaleDateString('pt-BR'): '-';
          const id = String(ev.id);
          const temReal = !!(reaisMap && Object.prototype.hasOwnProperty.call(reaisMap, id));
          const fb = extrairFeedback(ev);
          const status = eventosEliminados.has(id) ? 'eliminado' : (eventosCancelados.has(id) ? 'cancelado' : (eventosFinalizados.has(id) ? 'finalizado' : 'aberto'));
          return `${dd} • ${ev.nome_da_escola||ev.cidade||'Evento'} #${id} — ${status} — real:${temReal?'sim':'não'} — fb:${fb?'sim':'não'}`;
        });

        const rawBox = `
          <div style="background:#151515; border:1px solid #333; border-radius:6px; padding:8px; grid-column: 1/-1;">
            <div style="font-weight:600; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
              <span>Payload bruto (n8n)</span>
              <input id="debug-search" type="text" placeholder="Pesquisar..." style="margin-left:auto; background:#0f1117; color:#d5e5ff; border:1px solid #333; border-radius:6px; padding:4px 8px; min-width: 180px;">
            </div>
            <pre id="debug-raw-json" style="margin:0; background:#0f1117; color:#d5e5ff; border:1px solid #2c2f36; border-radius:6px; padding:8px; white-space:pre; overflow:auto; max-height:32vh; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size:12px; line-height:1.45;"></pre>
          </div>`;

        content.innerHTML = `
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:8px;">
            <div style="background:#151515; border:1px solid #333; border-radius:6px; padding:8px;">
              <div style="font-weight:600; margin-bottom:6px;">Contadores</div>
              <div>Total normalizados: ${normalized.length}</div>
              <div>Total mesclados: ${evs.length}</div>
              <div>Finalizados: ${eventosFinalizados.size}</div>
              <div>Cancelados: ${eventosCancelados.size}</div>
              <div>Eliminados: ${eventosEliminados.size}</div>
              <div>Pendentes de lançar: ${pendentes.length}</div>
              <div>Com avaliação: ${withFeedback.length}</div>
            </div>
            <div style="background:#151515; border:1px solid #333; border-radius:6px; padding:8px;">
              <div style="font-weight:600; margin-bottom:6px;">Amostra</div>
              <div style="white-space:pre-wrap; line-height:1.4; opacity:.9;">${sample.join('\n')}</div>
            </div>
          </div>
          ${rawBox}`;

        // Preenche RAW JSON com segurança
        try{
          const pre = document.getElementById('debug-raw-json');
          const text = payload ? JSON.stringify(payload, null, 2) : 'n/a';
          if (pre) pre.textContent = text;
          const input = document.getElementById('debug-search');
          if (input && pre){
            input.oninput = ()=>{
              const q = String(input.value||'').trim();
              if (!q){ pre.textContent = text; return; }
              // destaca correspondências simples mantendo JSON como texto
              const safe = text.replace(/[&<>]/g, m=> ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
              const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const re = new RegExp(esc, 'gi');
              pre.innerHTML = safe.replace(re, m=>`<mark style="background:#ffd86b;color:#111;border-radius:3px;">${m}</mark>`);
            };
          }
        }catch(_){ }
      }catch(_){ }
    };

    setTimeout(()=>{ try{ window.__DEBUG_UPDATE(); }catch(_){ } }, 250);
  }catch(_){ }
}

// Atalho de teclado: Ctrl+Alt+D para alternar debug
try{
  document.addEventListener('keydown', (e)=>{
    try{
      const k = (e.key||'').toLowerCase();
      if (e.ctrlKey && e.altKey && (k==='d')){ e.preventDefault(); toggleDebug(); }
    }catch(_){ }
  });
}catch(_){ }

// Botão para ativar o modo debug quando estiver desligado
function createDebugActivator(){
  if (isDebugEnabled()) return;
  try{
    const btn = document.createElement('button');
    btn.textContent = 'Ativar Debug';
    btn.title = 'Ativar modo debug (Ctrl+Alt+D)';
    Object.assign(btn.style, { position:'fixed', left:'12px', bottom:'12px', zIndex:99997, background:'#111', color:'#fff', border:'1px solid #333', borderRadius:'6px', padding:'6px 10px', cursor:'pointer', opacity:0.8 });
    btn.addEventListener('click', (e)=>{ e.preventDefault(); toggleDebug(); });
    document.addEventListener('DOMContentLoaded', ()=>{ try{ document.body.appendChild(btn); }catch(_){ } });
  }catch(_){ }
}

// Visuais mais evidentes quando o modo debug está ativo
function ensureDebugBadge(){
  try{
    let badge = document.getElementById('debug-active-badge');
    if (!isDebugEnabled()) { if (badge) badge.remove(); document.body && document.body.removeAttribute('data-debug'); return; }
    if (!badge){
      badge = document.createElement('div');
      badge.id = 'debug-active-badge';
      badge.innerHTML = '<i class="fas fa-bug"></i> DEBUG ATIVO';
      Object.assign(badge.style, { position:'fixed', top:'10px', right:'12px', zIndex:3000, background:'linear-gradient(90deg, rgba(255,94,94,.95), rgba(255,154,0,.95))', color:'#111', fontWeight:'800', padding:'6px 10px', borderRadius:'999px', border:'1px solid rgba(0,0,0,.2)', boxShadow:'0 6px 20px rgba(0,0,0,.35)', letterSpacing:'0.4px', cursor:'pointer' });
      badge.title = 'Abrir painel de debug';
      badge.addEventListener('click', ()=>{
        try{
          const panel = document.getElementById('debug-panel');
          if (panel){ panel.style.display = (panel.style.display==='none'?'block':'none'); }
          else { createDebugPanel(); }
        }catch(_){ }
      });
      document.body.appendChild(badge);
    }
    // Marca no body para CSS adicional
    try{ document.body.setAttribute('data-debug','1'); }catch(_){ }
    // Sinaliza no título
    try{
      if (!window.__ORIG_TITLE) window.__ORIG_TITLE = document.title;
      if (window.__ORIG_TITLE && !document.title.startsWith('[DEBUG] ')) document.title = '[DEBUG] ' + window.__ORIG_TITLE;
    }catch(_){ }
  }catch(_){ }
}

function applyDebugVisuals(){
  try{
    ensureDebugBadge();
    // Realça o botão de debug nos controles
    const dbgBtn = document.getElementById('debug-toggle-btn');
    if (dbgBtn){
      if (isDebugEnabled()) dbgBtn.classList.add('btn-debug-on'); else dbgBtn.classList.remove('btn-debug-on');
    }
  }catch(_){ }
}

let eventosFinalizados = new Set();
let eventosErroAoFinalizar = new Set();
let eventosCancelados = new Set();
let eventosEliminados = new Set();

function carregarDadosPersistidos() {
  try {
    const finalizadosRaw = localStorage.getItem(keyFor(STORAGE_COMPLETED_KEY));
    if (finalizadosRaw) {
      const ids = JSON.parse(finalizadosRaw);
      if (Array.isArray(ids)) eventosFinalizados = new Set(ids);
    }
  } catch (error) {
    console.warn('Não foi possível carregar eventos finalizados.', error);
    eventosFinalizados = new Set();
  }

  try {
    const canceladosRaw = localStorage.getItem(keyFor(STORAGE_CANCELED_KEY));
    if (canceladosRaw) {
      const ids = JSON.parse(canceladosRaw);
      if (Array.isArray(ids)) eventosCancelados = new Set(ids);
    }
  } catch (error) {
    console.warn('Não foi possível carregar eventos cancelados.', error);
    eventosCancelados = new Set();
  }
  try {
    const eliminadosRaw = localStorage.getItem(keyFor(STORAGE_DELETED_KEY));
    if (eliminadosRaw) {
      const ids = JSON.parse(eliminadosRaw);
      if (Array.isArray(ids)) eventosEliminados = new Set(ids);
    }
  } catch (error) {
    console.warn('Não foi possível carregar eventos eliminados.', error);
    eventosEliminados = new Set();
  }
}
function salvarEventosFinalizados(){ try{ localStorage.setItem(keyFor(STORAGE_COMPLETED_KEY), JSON.stringify(Array.from(eventosFinalizados))); }catch(e){} }
function salvarEventosCancelados(){ try{ localStorage.setItem(keyFor(STORAGE_CANCELED_KEY), JSON.stringify(Array.from(eventosCancelados))); }catch(e){} }
function salvarEventosEliminados(){ try{ localStorage.setItem(keyFor(STORAGE_DELETED_KEY), JSON.stringify(Array.from(eventosEliminados))); }catch(e){} }
function salvarCacheEventos(){
  try{
    const payload = { savedAt: Date.now(), events: Array.isArray(eventosEnriquecidos) ? eventosEnriquecidos : [] };
    localStorage.setItem(keyFor(STORAGE_EVENTS_CACHE_KEY), JSON.stringify(payload));
  }catch(e){}
}
function carregarCacheEventos(){
  try{
    const raw = localStorage.getItem(keyFor(STORAGE_EVENTS_CACHE_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { savedAt: 0, events: parsed };
    if (parsed && Array.isArray(parsed.events)) return parsed;
    return null;
  }catch(_){ return null; }
}

// Progresso de eventos multi-diárias
function loadMultiDaysProgress(){ try{ return JSON.parse(localStorage.getItem(keyFor(STORAGE_MULTI_DAYS_PROGRESS_KEY))||'{}')||{}; }catch(_){ return {}; } }
function saveMultiDaysProgress(map){ try{ localStorage.setItem(keyFor(STORAGE_MULTI_DAYS_PROGRESS_KEY), JSON.stringify(map||{})); }catch(_){ } }
function getMultiProgressFor(id){ try{ const m=loadMultiDaysProgress(); const v=m[String(id)]; const n=parseInt(v,10); return Number.isFinite(n)? n:0; }catch(_){ return 0; } }
function setMultiProgressFor(id, val){ const m=loadMultiDaysProgress(); m[String(id)]=Math.max(0, parseInt(val,10)||0); saveMultiDaysProgress(m); }

// Remove antigos exemplos (Pitanga/Joinville/evt_00x) caso ainda estejam no cache local
function isEventoExemplo(ev){
  try{
    if (!ev) return false;
    const id = String(ev.id||'');
    const escola = (ev.nome_da_escola||'').toString().toLowerCase();
    const cidade = (ev.cidade||'').toString().toLowerCase();
    if (/^evt_00\d$/i.test(id)) return true;
    if (cidade.includes('pitanga - pr')) return true;
    if (cidade.includes('joinville - sc')) return true;
    if (escola.includes('colégio são bento') || escola.includes('colegio sao bento')) return true;
    if (escola.includes('cei herondina')) return true;
    return false;
  }catch(_){ return false; }
}

function dentroDaJanelaDeCache(ev){
  try{
    // Se habilitado, não filtra por janela de cache
    if (showAllEventsEnabled()) return true;
    // Mantém sempre eventos com avaliação/feedback, mesmo fora da janela
    try{
      // Considera todos os campos conhecidos que podem conter texto de feedback
      const rawC = (ev && (
        ev.avaliacao_astronomo || ev.avaliacao_comentario || ev.feedback ||
        ev.comentario_feedback || ev.feedback_texto || ev.feedback_responsavel ||
        ev.feedback_responsavel_nome
      )) || '';
      const hasComment = typeof rawC==='string' && rawC.trim() && !/^\s*(null|nao avaliou|não avaliou|sem avaliacao|sem avaliação)\s*$/i.test(rawC);
      const hasNota = Number.isFinite(parseNum(ev && (ev.avaliacao_nota || ev.nota || ev.rating || ev.satisfacao))) && parseNum(ev && (ev.avaliacao_nota || ev.nota || ev.rating || ev.satisfacao))>0;
      if (hasComment || hasNota) return true;
    }catch(_){ }
    const d = parseDatePreserveUTC(ev && ev.data_agendamento);
    if (!d || Number.isNaN(d.getTime())) return true; // sem data, não descarta
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const limite = new Date(hoje.getTime() - CACHE_TTL_MS);
    return d >= limite || d >= hoje; // mantém últimos 30 dias e futuros
  }catch(_){ return true; }
}

function mesclarComCache(eventosNovosNormalizados){
  const cache = carregarCacheEventos();
  const antigosRaw = cache && Array.isArray(cache.events) ? cache.events : [];
  // limpa exemplos
  const antigos = antigosRaw.filter(e => !isEventoExemplo(e));

  // Índices por chave primária e por chave alternativa (data+escola+cidade)
  const byPrimary = new Map();
  const byAlt = new Map();
  const resultado = [];

  const altKey = (ev)=>{
    try{
      const d = parseDatePreserveUTC(ev && ev.data_agendamento);
      const data = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : 'data';
      const escola = schoolKeyName((ev && ev.nome_da_escola) || 'escola');
      const cidade = String((ev && ev.cidade) || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
      // Diferenciar por TEXTO DA TAREFA (não pelo tipo tarefa)
      const txtRaw = (ev && (ev.texto_tarefa ?? ev.textoTarefa ?? '')) || '';
      const texto = String(txtRaw)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/\s+/g,' ') // espaços
        .replace(/[^a-z0-9\- _]/g,'')
        .trim() || 'semtexto';
      return `alt_${data}_${escola}_${cidade}_${texto}`;
    }catch(_){ return `alt_${Math.random()}`; }
  };

  // Carrega antigos nos mapas
  for (const e of antigos){
    const pk = chaveEvento(e);
    const ak = altKey(e);
    byPrimary.set(pk, e);
    byAlt.set(ak, e);
    resultado.push(e);
  }

  // Mescla novos: se coincidir por primária OU alternativa, substitui o existente; senão adiciona
  for (const ev of (eventosNovosNormalizados||[])){
    const pk = chaveEvento(ev);
    const ak = altKey(ev);

    if (byPrimary.has(pk)){
      // Substitui o existente com mesma chave primária
      const idx = resultado.findIndex(x => chaveEvento(x) === pk);
      if (idx !== -1) resultado[idx] = ev; else resultado.push(ev);
      byPrimary.set(pk, ev);
      byAlt.set(ak, ev);
      continue;
    }

    if (byAlt.has(ak)){
      // Trata como o mesmo evento (id mudou no n8n, mas é a mesma ocorrência)
      const existente = byAlt.get(ak);
      const oldPk = chaveEvento(existente);
      const idx = resultado.findIndex(x => x === existente || chaveEvento(x) === oldPk);
      if (idx !== -1) resultado[idx] = ev; else resultado.push(ev);
      byAlt.set(ak, ev);
      // Atualiza índice primário: remove o antigo e registra o novo
      byPrimary.delete(oldPk);
      byPrimary.set(pk, ev);
      continue;
    }

    // Novo de fato
    resultado.push(ev);
    byPrimary.set(pk, ev);
    byAlt.set(ak, ev);
  }

  const filtrados = resultado.filter(dentroDaJanelaDeCache);
  // Dedup final por chave alternativa (mais robusto que id) mantendo o último
  try{
    const m = new Map();
    for (const ev of filtrados){ m.set(altKey(ev), ev); }
    const uniq = Array.from(m.values());
    uniq.sort((a,b)=>{
      const da = parseDatePreserveUTC(a.data_agendamento) || new Date(0);
      const db = parseDatePreserveUTC(b.data_agendamento) || new Date(0);
      return da - db;
    });
    return uniq;
  }catch(_){
    filtrados.sort((a,b)=>{
      const da = parseDatePreserveUTC(a.data_agendamento) || new Date(0);
      const db = parseDatePreserveUTC(b.data_agendamento) || new Date(0);
      return da - db;
    });
    return filtrados;
  }
}
function salvarEstadosColapso(est){ try{ localStorage.setItem(keyFor(STORAGE_COLLAPSE_KEY), JSON.stringify(est||{})); }catch(_){ } }
function carregarEstadosColapso(){ try{ const raw = localStorage.getItem(keyFor(STORAGE_COLLAPSE_KEY)); return raw? JSON.parse(raw):{}; }catch(_){ return {}; } }

carregarDadosPersistidos();

/* =========================
   ELEMENTOS DO DOM
   ========================= */
const elementos = {
  astronomoNome: document.getElementById('astronomoNome'),
  eventosMes: document.getElementById('eventosMes'),
  proximoEvento: document.getElementById('proximoEvento'),
  eventosConcluidos: document.getElementById('eventosConcluidos'),
  pendentesGastos: document.getElementById('pendentesGastos'),
  distanceNextEvent: document.getElementById('distance-next-event'),
  distanceStatus: document.getElementById('distance-status'),
  cidadesVisitadas: document.getElementById('cidadesVisitadas'),
  faturamentoTotal: document.getElementById('faturamentoTotal'),
  updateBtn: document.getElementById('update-btn'),
  calcWeekRoutesBtn: document.getElementById('calc-week-routes-btn'),
  updateStatus: document.getElementById('update-status'),
  upcomingEventsList: document.getElementById('upcoming-events-list'),
  eventsCount: document.getElementById('events-count'),
  upcomingSection: document.getElementById('upcoming-section'),
  toggleUpcomingBtn: document.getElementById('toggle-upcoming'),
  showAllUpcomingBtn: document.getElementById('show-all-upcoming'),
  todayEventsList: document.getElementById('today-events-list'),
  currentDate: document.getElementById('current-date'),
  todayTitle: document.getElementById('today-title'),
  calendarBox: document.getElementById('calendar-box'),
  toggleCalendarBtn: document.getElementById('toggle-calendar'),
  miniCalendarGrid: document.getElementById('mini-calendar-grid'),
  miniMonthLabel: (function(){ try{ return document.querySelector('.mini-calendar .mini-calendar-month'); }catch(_){ return null; } })(),
  calPrevBtn: document.getElementById('prev-month'),
  calNextBtn: document.getElementById('next-month'),
  calCurrentMonth: document.getElementById('current-month'),
  totalDistance: document.getElementById('total-distance'),
  totalTime: document.getElementById('total-time'),
  routeSteps: document.getElementById('route-steps'),
  openMaps: document.getElementById('open-maps'),
  weatherToday: document.getElementById('weather-today'),
  weatherDestination: document.getElementById('weather-destination'),
  weatherNext: document.getElementById('weather-next'),
  completedList: document.getElementById('completed-list'),
  canceledList: document.getElementById('canceled-list'),
  feedbacksList: document.getElementById('feedbacks-list'),
  pendingSection: document.getElementById('pending-expenses-section'),
  pendingList: document.getElementById('pending-expenses-list'),
  pendingCount: document.getElementById('pending-expenses-count'),
  deletedList: document.getElementById('deleted-list'),
  // Botão de envio rápido da localização
  sendLocationBtn: document.getElementById('send-location-btn'),
  currentLocationLabel: document.getElementById('current-location-label'),
  // Popup Localização manual
  locationModal: document.getElementById('location-modal'),
  locationClose: document.getElementById('location-close'),
  locationCancel: document.getElementById('location-cancel'),
  locationSend: document.getElementById('location-send'),
  locationUseCurrent: document.getElementById('location-use-current'),
  locationDecline: document.getElementById('location-decline'),
  manualCityInput: document.getElementById('manual-city-input'),
  manualStateInput: document.getElementById('manual-state-input'),

  // Modal de finalizar → CTA para lançar despesas
  finalizeModal: document.getElementById('finalize-modal'),
  finalizeClose: document.getElementById('finalize-close'),
  finalizeLater: document.getElementById('finalize-later'),
  finalizeLaunch: document.getElementById('finalize-open-expense'),

  // --- Aba Despesas (IDs do seu HTML) ---
  despesasContent: document.getElementById('despesas-content'),
  despesasEventsList: document.getElementById('despesas-events-list'),
  despesasEventsCount: document.getElementById('despesas-events-count'),
  estMediasHint: document.getElementById('est-medias-hint'),
  despesasHint: document.getElementById('despesas-hint-banner'),
  gerarMediasBtn: document.getElementById('generate-medias-btn'),
  despesasMediasUpdate: document.getElementById('update-medias-btn'),
  estFuel: document.getElementById('est-cost-fuel'),
  estHotel: document.getElementById('est-cost-hotel'),
  estFood: document.getElementById('est-cost-food'),
  estMonitor: document.getElementById('est-cost-monitor'),
  estTotal: document.getElementById('est-cost-total'),
  estFatTotal: document.getElementById('est-faturamento-total'),
  estFatBase: document.getElementById('est-faturamento-base'),
  estLucro: document.getElementById('est-lucro-liquido'),
  realFuel: document.getElementById('real-cost-fuel'),
  realHotel: document.getElementById('real-cost-hotel'),
  realFood: document.getElementById('real-cost-food'),
  realMonitor: document.getElementById('real-cost-monitor'),
  realTotal: document.getElementById('real-cost-total'),
  realFatTotal: document.getElementById('real-faturamento-total'),
  realFatBase: document.getElementById('real-faturamento-base'),
  realLucro: document.getElementById('real-lucro-liquido'),
  lucroBase: document.getElementById('faturamentoBase'),
  lucroLiquido: document.getElementById('lucroLiquido'),
  motivMessage: document.getElementById('motivation-message'),
  despesasReload: document.getElementById('reload-despesas-btn'),
  despesasReset: document.getElementById('reset-local-btn'),
  despesasForm: document.getElementById('real-expenses-form')
};

/* =========================
   TABS
   ========================= */
function inicializarTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  function activate(btn){
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const tabId = (btn.getAttribute('data-tab') || '').trim() + '-content';
    const explicitTarget = btn.getAttribute('data-target');
    let pane = null;
    if (explicitTarget) pane = document.querySelector(explicitTarget);
    if (!pane && tabId) pane = document.getElementById(tabId);
    if (!pane) pane = document.querySelector('#' + (btn.dataset.tab || '').trim() + '-content');
    if (!pane) pane = document.querySelector('.tab-content');
    if (pane) pane.classList.add('active');
    localStorage.setItem('activeTab', btn.dataset.tab || 'agenda');
  }

  tabBtns.forEach(btn => btn.addEventListener('click', () => activate(btn)));
  // Ao abrir a aba Feedbacks, dispara o webhook action=feedback e renderiza ao concluir
  try{
    tabBtns.forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if ((btn.getAttribute('data-tab')||'') === 'feedbacks'){
          try{ await carregarFeedbacksWebhook(); }catch(_){ }
        }
      });
    });
  }catch(_){ }

  // Restaurar aba ativa
  try {
    const saved = localStorage.getItem('activeTab');
    if (saved) {
      const btn = Array.from(tabBtns).find(b => (b.getAttribute('data-tab')||'') === saved);
      if (btn) activate(btn);
      // Se iniciar já na aba de Feedbacks, carrega imediatamente
      if ((saved||'') === 'feedbacks'){
        try{ setTimeout(()=>{ carregarFeedbacksWebhook(); }, 0); }catch(_){ }
      }
    }
  } catch(_){}
}

/* =========================
   EVENT LISTENERS BÁSICOS
   ========================= */
function inicializarEventListeners() {
  if (elementos.updateBtn) {
    console.log('[UI] Vinculando clique ao botão Atualizar Agenda');
    elementos.updateBtn.addEventListener('click', () => carregarAgendaWebhook(true));
  }

  // Botão "Estou em" — SEMPRE abre o popup de localização
  if (elementos.sendLocationBtn) {
    elementos.sendLocationBtn.addEventListener('click', async () => {
      try { abrirPromptLocalizacaoManual(true); } catch(__) {}
    });
  }

  // Botão limpar cache
  const clearBtn = document.getElementById('clear-cache-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', ()=>{
      try{
        // Remove todos os dados de cache namespaced do usuário (mantém login)
        const keysToClear = [
          STORAGE_EVENTS_CACHE_KEY,
          STORAGE_COMPLETED_KEY,
          STORAGE_CANCELED_KEY,
          STORAGE_DELETED_KEY,
          STORAGE_COLLAPSE_KEY,
          LAST_SYNC_KEY
        ];
        keysToClear.forEach(k=>{ try{ localStorage.removeItem(keyFor(k)); }catch(_){ } });
        // Despesas (locais)
        try{ localStorage.removeItem(keyFor(LS_KEY_REAIS)); }catch(_){ }
        try{ localStorage.removeItem(keyFor(LS_KEY_MEDIAS)); }catch(_){ }

        // Zera estado em memória
        eventosEnriquecidos = [];
        eventosFinalizados = new Set();
        eventosCancelados = new Set();
        if (typeof eventosEliminados !== 'undefined') eventosEliminados = new Set();
        dadosSincronizados = { eventos: [], total_eventos: 0 };

        // Atualiza todas as visões dependentes
        try{ document.dispatchEvent(new CustomEvent('eventsUpdated', { detail: { events: [] } })); }catch(_){ }
        try{ renderizarProximosEventos(); }catch(_){ }
        try{ renderizarHistorico(); }catch(_){ }
        try{ atualizarEstatisticas(dadosSincronizados); }catch(_){ }
        try{ atualizarEventosHoje(); }catch(_){ }
        try{ if (elementos.pendingSection){ elementos.pendingSection.style.display = 'none'; } if (elementos.pendingList){ elementos.pendingList.innerHTML = ''; } }catch(_){ }

        if (elementos.updateStatus){ elementos.updateStatus.textContent = 'Cache limpo com sucesso.'; elementos.updateStatus.style.color = 'var(--calendar-warning)'; elementos.updateStatus.dataset.status='info'; }
      }catch(e){ console.warn('Falha ao limpar cache', e); }
    });
  }

  if (elementos.calcWeekRoutesBtn) {
    elementos.calcWeekRoutesBtn.addEventListener('click', solicitarCalculoRotasSemana);
  }

  if (elementos.openMaps) {
    elementos.openMaps.addEventListener('click', abrirGoogleMaps);
  }

  // Colapsáveis (agenda)
  const estados = carregarEstadosColapso();
  if (elementos.upcomingSection && estados.upcomingCollapsed) elementos.upcomingSection.classList.add('is-collapsed');
  if (elementos.calendarBox && estados.calendarCollapsed) elementos.calendarBox.classList.add('collapsed');
  if (elementos.toggleUpcomingBtn) {
    elementos.toggleUpcomingBtn.addEventListener('click', () => {
      if (!elementos.upcomingSection) return;
      elementos.upcomingSection.classList.toggle('is-collapsed');
      const s = carregarEstadosColapso(); s.upcomingCollapsed = elementos.upcomingSection.classList.contains('is-collapsed'); salvarEstadosColapso(s);
    });
  }
  // Botão Exibir todos os eventos (Próximos)
  if (elementos.showAllUpcomingBtn){
    elementos.showAllUpcomingBtn.addEventListener('click', ()=>{
      try{ window.__SHOW_ALL_UPCOMING = !window.__SHOW_ALL_UPCOMING; }catch(_){ window.__SHOW_ALL_UPCOMING = true; }
      renderizarProximosEventos();
    });
  }
  if (elementos.toggleCalendarBtn) {
    elementos.toggleCalendarBtn.addEventListener('click', () => {
      if (!elementos.calendarBox) return;
      elementos.calendarBox.classList.toggle('collapsed');
      const s = carregarEstadosColapso(); s.calendarCollapsed = elementos.calendarBox.classList.contains('collapsed'); salvarEstadosColapso(s);
    });
  }

  // Botão de Debug na barra de controles
  const dbgBtn = document.getElementById('debug-toggle-btn');
  if (dbgBtn){
    const refreshLabel = ()=>{
      try{
        if (isDebugEnabled()) dbgBtn.innerHTML = '<i class="fas fa-bug"></i> Painel Debug';
        else dbgBtn.innerHTML = '<i class="fas fa-bug"></i> Ativar Debug';
      }catch(_){ }
    };
    refreshLabel();
    dbgBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      try{
        if (isDebugEnabled()){
          // Se já está ligado, alterna visibilidade do painel; se não existir, cria
          const panel = document.getElementById('debug-panel');
          if (panel){ panel.style.display = (panel.style.display==='none'?'block':'none'); }
          else { createDebugPanel(); }
        } else {
          toggleDebug();
        }
      }catch(_){ }
    });
    // Atualiza rótulo após montar painel
    document.addEventListener('DOMContentLoaded', refreshLabel);
  }
}

/* =========================
   CARREGAMENTO DE AGENDA
   ========================= */
function carregarSessaoUsuario(){
  try{
    const s = getUserSession();
    if(s){
      window.currentUser = s;
      if (elementos.astronomoNome){
        const name = s.username || s.usuario || s.USERNAME || s.user || 'Astrônomo';
        elementos.astronomoNome.textContent = String(name);
      }
    }
  }catch(_){}
}
document.addEventListener('DOMContentLoaded', ()=>{ try{carregarSessaoUsuario();}catch(_){} try{inicializarCacheLocal();}catch(_){} try{ createDebugPanel(); }catch(_){ } try{ createDebugActivator(); }catch(_){ } try{ applyDebugVisuals(); }catch(_){ } });

function inicializarCacheLocal(){
  const cache = carregarCacheEventos();
  if (!cache || !Array.isArray(cache.events) || cache.events.length===0) return;
  const expirado = (cache.savedAt && (Date.now() - cache.savedAt) > (CACHE_TTL_MS*2));
  // mesmo expirado, ainda podemos aproveitar a janela de eventos dos últimos 30 dias
  const base = (cache.events||[]).filter(dentroDaJanelaDeCache).filter(e => !isEventoExemplo(e));
  if (!base.length) return;
  eventosEnriquecidos = base;
  dadosSincronizados = { eventos: eventosEnriquecidos, total_eventos: eventosEnriquecidos.length };
  try{ atualizarEstatisticas(dadosSincronizados); }catch(_){ }
  try{ renderizarProximosEventos(); }catch(_){ }
  try{ atualizarDataAtual(); atualizarEventosHoje(); }catch(_){ }
  try{
    document.dispatchEvent(new CustomEvent('eventsUpdated', { detail: { events: eventosEnriquecidos.filter(ev => !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id)) } }));
  }catch(_){ }
  try{ salvarCacheEventos(); }catch(_){ }
}

async function carregarAgendaWebhook(force) {
  if (carregandoAgenda) return;

  carregandoAgenda = true;
  if (elementos.updateBtn) {
    elementos.updateBtn.classList.add('is-loading');
    elementos.updateBtn.setAttribute('disabled', 'disabled');
  }

  try {
    // Respeita a janela mínima de sincronização (1x por semana) somente para fluxos automáticos.
    // Se o usuário clicar no botão (force=true), atualiza imediatamente.
    const last = getLastSync();
    const now = Date.now();
    if (!force && last && (now - last) < SYNC_MIN_INTERVAL_MS) {
      const dias = Math.ceil((SYNC_MIN_INTERVAL_MS - (now - last)) / 86400000);
      if (elementos.updateStatus){
        elementos.updateStatus.textContent = `Atualização automática disponível 1x/dia. Clique novamente para forçar ou aguarde ~${dias} dia(s).`;
        elementos.updateStatus.style.color = 'var(--calendar-warning)';
        elementos.updateStatus.dataset.status = 'info';
      }
      return;
    }
    if (elementos.updateStatus){
      elementos.updateStatus.textContent = 'Sincronizando com o n8n...';
      elementos.updateStatus.style.color = 'var(--calendar-accent)';
      elementos.updateStatus.dataset.status = 'loading';
    }

    // Solicita geolocalização apenas se o usuário não recusou permanentemente
    // e se ainda não capturamos recentemente (evita duplicar no carregamento)
    try{
      const declined = localStorage.getItem(keyFor('location_declined'))==='1';
      const recent = !!(userLocation && userLocation.timestamp && (Date.now() - userLocation.timestamp) < 2*60*1000);
      if (!declined && !recent) await capturarLocalizacaoAtual(false);
    }catch(_){ }

    // Atualizar agenda — via POST (por design do webhook)
    const isLocalDev = (function(){ try{ return location.protocol==='file:' || /^(127\.0\.0\.1|localhost)(:|$)/i.test(location.host); }catch(_){ return false; }})();
    const isNgrok = (function(){ try{ return /ngrok/i.test(location.hostname||''); }catch(_){ return false; }})();
    let candidates = N8N_WEBHOOK_URLS.slice();
    if (isNgrok){
      // Em ngrok, chamar direto o webhook da Urânia
      candidates = N8N_WEBHOOK_URLS.filter(u => /^https?:\/\//i.test(u));
    } else if (isLocalDev){
      candidates = N8N_WEBHOOK_URLS.filter(u => !u.startsWith('/'));
    }
    let respostaOk = null; let payloadOk = null; let lastErr = null;
    for (const base of candidates){
      try{
        let url = withUserQuery(base);
        try{
          const u = new URL(url);
          u.searchParams.set('action','atualizar_agenda');
          u.searchParams.set('tipo','atualizar_agenda');
          // Garante que o id_astronomo e user_id sejam enviados
          if (!u.searchParams.get('id_astronomo')){
            const fid = fallbackAstronomoId(); if (fid) u.searchParams.set('id_astronomo', fid);
          }
          if (!u.searchParams.get('user_id')){
            const fid = fallbackAstronomoId(); if (fid) u.searchParams.set('user_id', fid);
          }
          url = u.toString();
        }catch(_){ }
        console.log('[n8n] Solicitando dados ao webhook em', url);
        // POST sem body (parâmetros na querystring)
        const r = await postWithTimeout(url, undefined, WEBHOOK_TIMEOUT_MS);
        if (r && r.ok){
          // Tenta interpretar como JSON; se falhar e não houver corpo, tenta próximo endpoint
          const ct = (r.headers.get('content-type')||'').toLowerCase();
          let data = null;
          try{
            if (ct.includes('application/json')){
              data = await r.json();
            } else {
              const txt = await r.text();
              const t = (txt||'').trim();
              if (t && /^[\[{]/.test(t)) { try{ data = JSON.parse(t); }catch(_){ data = null; } }
            }
          }catch(parseErr){ data = null; }

          const normalized = prepararDadosParaProcessamento(data);
          if (isDebugEnabled()) {
            try { window.__DEBUG_LAST_N8N_DATA = data; } catch(_){}
            try { window.__DEBUG_LAST_NORMALIZED = Array.isArray(normalized) ? normalized : (normalized && normalized.eventos ? normalized.eventos : []); } catch(_){}
          }
          if (normalized && (!Array.isArray(normalized) || normalized.length>0)){
            respostaOk = r; payloadOk = normalized; break;
          }
        }
        lastErr = new Error(`HTTP ${r ? r.status : '0'} em ${url}`);
      }catch(e){ lastErr = e; }
    }
    if (!respostaOk || !payloadOk) throw lastErr || new Error('Nenhum endpoint respondeu com JSON válido');

    processarDadosWebhook(payloadOk);
    if (isDebugEnabled()) { try{ window.__DEBUG_UPDATE && window.__DEBUG_UPDATE(); }catch(_){ } }
    salvarCacheEventos();

    const agora = new Date();
    if (elementos.updateStatus){
      elementos.updateStatus.textContent = `Atualizado em ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      elementos.updateStatus.style.color = 'var(--calendar-success)';
      elementos.updateStatus.dataset.status = 'success';
    }

    setLastSync();
    console.log('[n8n] Dados sincronizados com sucesso.');
  } catch (error) {
    console.error('Erro ao carregar dados do webhook:', error);
    if (elementos.updateStatus){
      elementos.updateStatus.textContent = 'Falha ao sincronizar com o n8n. Mantendo dados do cache.';
      elementos.updateStatus.style.color = 'var(--calendar-danger)';
      elementos.updateStatus.dataset.status = 'error';
    }
  } finally {
    carregandoAgenda = false;
    if (elementos.updateBtn) {
      elementos.updateBtn.classList.remove('is-loading');
      elementos.updateBtn.removeAttribute('disabled');
    }
  }
}

/* =========================
   NORMALIZAÇÃO E RENDER (Agenda)
   ========================= */
function gerarIdEvento(evento, index) {
  // Deixa de construir IDs longos (data+escola+cidade).
  // Preferimos sempre o id do backend (id_evento). Se não houver, gera um curto com índice.
  try {
    if (evento && evento.id != null && String(evento.id).trim() !== '') return String(evento.id);
    if (evento && evento.id_evento != null && String(evento.id_evento).trim() !== '') return String(evento.id_evento);
    const i = (typeof index === 'number' && isFinite(index)) ? (index + 1) : Math.floor(Math.random()*1e6);
    return `evt_${i}`;
  } catch(_) { return `evt_${Math.floor(Math.random()*1e6)}`; }
}

function schoolKeyName(name){
  try{
    let s = String(name||'').toLowerCase();
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    s = s.replace(/\s*\([^)]*\)\s*/g,' ');
    s = s.replace(/#.*$/,' ');
    s = s.replace(/\b(nº|no\.|n\.|num)\s*\d+[\w\-/\s]*/g,' ');
    s = s.replace(/[\d]+(?:[\-\/\s][\d]+)*$/,' ');
    s = s.replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
    return s;
  }catch(_){ return String(name||'').toLowerCase().trim(); }
}
function chaveEvento(ev){
  try{
    if (ev && (ev.id!=null || ev.id_evento!=null)) return String(ev.id || ev.id_evento);
    const d = parseDatePreserveUTC(ev && ev.data_agendamento);
    const data = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : 'data';
    const baseEscola = schoolKeyName((ev && ev.nome_da_escola) || 'escola');
    return `k_${data}_${baseEscola}`.replace(/[^a-z0-9_-]+/g,'-');
  }catch(_){ return String(ev && ev.id || Math.random()); }
}

function normalizarEvento(eventoOriginal, index) {
  const evento = { ...eventoOriginal };

  // Se só vier id_evento_unico, usa-o como id_evento
  try{ if ((evento.id_evento==null || evento.id_evento==='') && evento.id_evento_unico!=null) evento.id_evento = String(evento.id_evento_unico); }catch(_){ }
  // Preserva o id enviado pelo n8n (id_evento) como id principal
  if (evento.id == null || evento.id === '') {
    if (evento.id_evento != null) evento.id = String(evento.id_evento);
    else evento.id = gerarIdEvento(evento, index);
  }

  if (!evento.tarefa && evento.tipo_da_tarefa) evento.tarefa = String(evento.tipo_da_tarefa);
  if (!evento.contato_responsavel && (evento.telefone_responsavel_evento || evento.telefone)) {
    evento.contato_responsavel = String(evento.telefone_responsavel_evento || evento.telefone);
  }
  // Normaliza número de alunos
  if (evento.alunos == null && evento.numero_de_alunos != null) {
    const v = parseInt(evento.numero_de_alunos, 10);
    if (!Number.isNaN(v)) evento.alunos = v;
  }

  // Coordenadas destino
  if (!evento.coordenadas) {
    const num = (v)=>{ const n = parseNum(v); return Number.isFinite(n) ? n : null; };
    const candidates = [
      { lat: evento.destino_lat, lng: evento.destino_lon },
      { lat: evento.destino_lat, lng: evento.destino_long },
      { lat: evento.destino_latitude, lng: evento.destino_longitude },
      { lat: evento.destino_latitud, lng: evento.destino_longitud },
      { lat: evento.lat_destino, lng: evento.lon_destino },
      { lat: evento.lat_destino, lng: evento.lng_destino },
      { lat: evento.latitude_destino, lng: evento.longitude_destino },
      { lat: evento.latitude, lng: evento.longitude },
      { lat: evento.lat, lng: evento.lng },
      { lat: evento.lat, lng: evento.lon },
      { lat: evento.y, lng: evento.x },
    ];
    for (const c of candidates){
      const la = num(c?.lat), lo = num(c?.lng);
      if (la!=null && lo!=null){ evento.coordenadas = { lat: la, lng: lo }; break; }
    }
    if (!evento.coordenadas){
      const nested = [evento.destino, evento.local, evento.location, evento.endereco, evento.geo]?.filter(Boolean) || [];
      for (const n of nested){
        const la = num(n?.lat ?? n?.latitude ?? n?.y ?? n?.latitud);
        const lo = num(n?.lng ?? n?.lon ?? n?.longitude ?? n?.x ?? n?.longitud ?? n?.long);
        if (la!=null && lo!=null){ evento.coordenadas = { lat: la, lng: lo }; break; }
      }
    }
  }

  // Cidade padrão: usa cidade_destino quando cidade estiver ausente
  try{
    if (!evento.cidade && evento.cidade_destino){
      evento.cidade = sanitizeCityName(evento.cidade_destino);
    }
  }catch(_){ }

  // Pedágios -> número
  if (evento.pedagios == null) evento.pedagios = 0;
  if (typeof evento.pedagios === 'string') {
    const v = parseFloat(evento.pedagios);
    evento.pedagios = Number.isFinite(v) ? v : 0;
  }

  // Valor total -> número
  if (evento.valor_total != null && typeof evento.valor_total === 'string') {
    const v = parseFloat(evento.valor_total);
    if (Number.isFinite(v)) evento.valor_total = v;
  }

  // Duração: payload chama de "duracao_minutos" mas frequentemente já vem em horas decimais.
  // Normalizamos para horas (duracao_horas) com heurística: >24 => minutos, senão horas.
  try{
    if (evento.duracao_minutos != null){
      const v = parseNum(evento.duracao_minutos);
      if (Number.isFinite(v) && v>0){
        const horas = v>24 ? (v/60) : v;
        evento.duracao_horas = Math.round(horas*10)/10;
      }
    }
  }catch(_){ }

  // Datas com aspas duplas no payload
  if (evento.data_agendamento != null && typeof evento.data_agendamento === 'string') {
    const s = evento.data_agendamento.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      evento.data_agendamento = s.slice(1, -1);
    }
  }

  // Campos numéricos comuns
  const toNum = (val) => { const n = parseFloat(val); return Number.isFinite(n) ? n : val; };
  if (evento.distancia_km != null && typeof evento.distancia_km === 'string') evento.distancia_km = toNum(evento.distancia_km);

  if (evento.coordenadas) {
    const lat = parseFloat(evento.coordenadas.lat);
    const lng = parseFloat(evento.coordenadas.lng);
    evento.coordenadas = (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
  }

  if (!evento.status) evento.status = 'pendente';

  // Normaliza campos de médias para chaves padrão quando faltarem
  try{
    const coalesce = (a,b,c)=> (a!=null && a!=='') ? a : ((b!=null && b!=='') ? b : c);
    evento.diaria_hospedagem = parseNum(coalesce(evento.diaria_hospedagem, evento.diaria_hospedagem_media, evento.valor_diaria_hospedagem)) || evento.diaria_hospedagem;
    evento.alimentacao_diaria = parseNum(coalesce(evento.alimentacao_diaria, evento.alimentacao_diaria_media, evento.valor_diario_alimentacao)) || evento.alimentacao_diaria;
    evento.monitor = parseNum(coalesce(evento.monitor, evento.monitor_media)) || evento.monitor;
    if (evento.pedagios==null || evento.pedagios==='') evento.pedagios = coalesce(evento.pedagios, evento.pedagios_media, 0);
    if (evento.outros==null || evento.outros==='') evento.outros = coalesce(evento.outros, evento.outros_media, 0);
    // Valor do litro: usar real como fallback
    if (evento.valor_litro==null || evento.valor_litro==='') evento.valor_litro = coalesce(evento.valor_litro, evento.valor_litro_real, null);
  }catch(_){ }

  // Dias de execução (multi-diárias). Aceita várias chaves do backend e normaliza para inteiro >=1
  try{
    const nRaw = (
      evento.numero_de_diarias ?? evento.num_diarias ?? evento.qtd_diarias ?? evento.qtde_diarias ??
      evento.diarias ?? evento.dias ?? 1
    );
    let n = parseInt(String(nRaw).toString().replace(/[^0-9]/g,''), 10);
    if (!Number.isFinite(n) || n <= 0) n = 1;
    evento.dias_total = n;
  }catch(_){ evento.dias_total = 1; }

  // Datas de ocorrência para o calendário/"Hoje" (não duplica o evento nas listas/contagem)
  try{
    const base = parseDatePreserveUTC(evento.data_agendamento);
    if (base && !isNaN(base)){
      const dates = [];
      for (let i=0; i<(evento.dias_total||1); i++){
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate()+i);
        dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
      }
      evento.ocorrencias_dias = dates;
    }
  }catch(_){ }

  // Distância aproximada com geoloc, se faltar
  if (!evento.distancia_km && evento.coordenadas && userLocation) {
    const d = calcularDistanciaKm(userLocation, evento.coordenadas);
    if (isFinite(d)) evento.distancia_km = Number(d.toFixed(1));
  }

  return evento;
}

function prepararDadosParaProcessamento(payload) {
  if (!payload) return null;

  if (typeof payload === 'string') {
    try { return prepararDadosParaProcessamento(JSON.parse(payload)); }
    catch { return null; }
  }

  if (Array.isArray(payload)) {
    if (payload.length > 0 && payload[0] && typeof payload[0] === 'object' && 'json' in payload[0]) {
      return payload.map(item => item.json);
    }
    return payload;
  }

  if (typeof payload === 'object') {
    if (Array.isArray(payload.eventos)) return payload;
    if (Array.isArray(payload.events)) return { ...payload, eventos: payload.events };

    const prioridade = ['data','body','payload','result','items','eventos','events'];
    for (const k of prioridade) {
      if (payload[k] !== undefined) {
        const extraido = prepararDadosParaProcessamento(payload[k]);
        if (extraido) {
          if (Array.isArray(extraido)) return extraido;
          if (extraido && typeof extraido === 'object' && Array.isArray(extraido.eventos)) return extraido;
        }
      }
    }

    const pareceEvento = ('id_evento' in payload) || ('data_agendamento' in payload) || ('cidade' in payload) || ('nome_da_escola' in payload);
    if (pareceEvento) return { eventos: [payload] };
  }

  return payload;
}

// Varredura ampla por listas de feedbacks no payload (além dos eventos)
function coletarFeedbacksNoPayload(payload){
  const encontrados = [];
  const pushIfFeedback = (obj)=>{
    try{
      if (!obj || typeof obj!=='object') return;
      // Abrange também feedback_responsavel (comentário textual vindo do responsável)
      const hasText = !!(obj.avaliacao_astronomo || obj.avaliacao_comentario || obj.feedback || obj.comentario_feedback || obj.feedback_texto || obj.feedback_responsavel);
      const hasNota = Number.isFinite(parseNum(obj.avaliacao_nota || obj.nota || obj.rating || obj.satisfacao));
      if (hasText || hasNota) encontrados.push(obj);
    }catch(_){ }
  };
  const walk = (x)=>{
    if (!x) return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x==='string'){ try{ const j=JSON.parse(x); walk(j); }catch(_){ } return; }
    if (typeof x==='object'){
      // candidato direto
      pushIfFeedback(x);
      // procurar arrays comuns
      const keys = Object.keys(x);
      for (const k of keys){ walk(x[k]); }
    }
  };
  try{ walk(payload); }catch(_){ }
  return encontrados;
}

// Extrai e aplica as médias vindas no payload de agenda.
// Regra: se houver ao menos UM valor de média no JSON, passa a valer como média global
// para todos os eventos (substitui valores fixos como valor_litro/consumo_km_l nas estimativas).
function extrairMediasDeEventosParaGlobais(eventos){
  try{
    if (!Array.isArray(eventos) || !eventos.length) return;
    const acc = { combustivel:0, hospedagem:0, alimentacao:0, monitor:0, pedagios:0, valor_litro:0, consumo_km_l:0 };
    const setIfZero = (k, v) => {
      const n = parseNum(v);
      if (!(parseNum(acc[k]) > 0) && n > 0) acc[k] = n;
    };

    for (const ev of eventos){
      if (!ev || typeof ev !== 'object') continue;
      // Médias específicas do backend
      setIfZero('combustivel', ev.gasto_combustivel_media);
      setIfZero('hospedagem',  ev.diaria_hospedagem_media);
      setIfZero('alimentacao', ev.alimentacao_diaria_media);
      setIfZero('monitor',     ev.monitor_media);
      setIfZero('pedagios',    ev.pedagios_media);
      // Parâmetros de combustível (globais)
      // Preferir valor_litro_real quando existir
      setIfZero('valor_litro', ev.valor_litro_real != null ? ev.valor_litro_real : ev.valor_litro);
      // Consumo pode vir em vários nomes
      setIfZero('consumo_km_l', ev.consumo_km_l != null ? ev.consumo_km_l : (ev.km_por_litro != null ? ev.km_por_litro : ev.km_per_liter));
      // Caso venha em L/km
      if (!(parseNum(acc.consumo_km_l) > 0)){
        const lPorKm = parseNum(ev && (ev.litros_por_km || ev.consumo_litros_por_km || ev.l_por_km));
        if (lPorKm > 0) acc.consumo_km_l = 1 / lPorKm;
      }
    }

    const hasAny = Object.values(acc).some(v => parseNum(v) > 0);
    if (hasAny){
      try{
        // Mescla com o que existir para não zerar chaves ainda úteis
        const curr = loadMedias();
        const merged = Object.assign({}, curr, acc);
        saveMedias(merged);
      }catch(_){ }
    }
  }catch(_){ }
}

function processarDadosWebhook(dados) {
  console.log('[n8n] Dados recebidos do n8n:', dados);

  let estrutura = null;
  if (Array.isArray(dados)) {
    const sess = getUserSession();
    estrutura = { astronomo: (sess && sess.username) || 'Astrônomo', periodo: new Date().toISOString().slice(0,7), eventos: dados };
  } else if (dados && typeof dados === 'object') {
    estrutura = { ...dados };
  }
  if (!estrutura) { console.warn('[n8n] Formato de dados desconhecido.'); return; }

  const eventosBrutos = Array.isArray(estrutura.eventos)
    ? estrutura.eventos
    : Array.isArray(estrutura.data) ? estrutura.data : [];

  const eventosNormalizados = eventosBrutos.map((ev,i)=> normalizarEvento(ev,i));
  if (isDebugEnabled()) { try{ window.__DEBUG_LAST_NORMALIZED = eventosNormalizados.slice(); }catch(_){ } }

  // Atualiza médias globais a partir do payload da agenda, quando presentes
  try{ extrairMediasDeEventosParaGlobais(eventosNormalizados); }catch(_){ }

  // Diagnóstico: resumo do que chegou do n8n focando distância
  try{
    const resumo = (eventosNormalizados||[]).map(ev=>({
      id: ev.id || ev.id_evento || '-',
      data: ev.data_agendamento || '-',
      escola: (ev.nome_da_escola||'').toString().slice(0,60),
      cidade: ev.cidade || '-',
      distancia_km: ev.distancia_km,
      tipo_dist: typeof ev.distancia_km,
      coords: ev.coordenadas ? `${ev.coordenadas.lat},${ev.coordenadas.lng}` : '-'
    }));
    if (resumo.length) console.table(resumo);
  }catch(_){ }

  // Coleta feedbacks externos (se houver) e evita duplicidade com os eventos
  try{
    const extraFbs = coletarFeedbacksNoPayload(dados) || [];
    const idSet = new Set(eventosNormalizados.map(e=> String(e.id||e.id_evento||'')));
    const normFb = extraFbs.map(fb=>{
      const id = String(fb.id_evento || fb.id || fb.id_evento_unico || '');
      const nota = (function(){ const n=parseNum(fb.avaliacao_nota||fb.nota||fb.rating||fb.satisfacao); return Number.isFinite(n)&&n>0? n: null; })();
      const comentario = (fb.avaliacao_comentario || fb.feedback || fb.comentario_feedback || fb.feedback_texto || fb.avaliacao_astronomo || '').toString().trim() || null;
      const quem = (fb.feedback_responsavel_nome || fb.responsavel_pelo_evento || fb.responsavel || '').toString().trim() || null;
      const quando = (fb.feedback_data || fb.data_feedback || fb.data || '').toString().trim() || null;
      const escola = (fb.nome_da_escola || fb.escola || '').toString().trim() || null;
      const cidade = sanitizeCityName(fb.cidade || fb.cidade_destino || '');
      const data_agendamento = fb.data_agendamento || null;
      return { id_rel: id||null, nota, comentario, quem, quando, escola, cidade, data_agendamento };
    }).filter(x => x.comentario || x.nota!=null);
    // Externos somente para IDs não presentes ou sem evento correspondente
    feedbacksExternos = normFb.filter(x => !x.id_rel || !idSet.has(String(x.id_rel)));
  }catch(_){ feedbacksExternos = []; }

  // Mescla com cache local e persiste. A UI sempre lê do cache.
  const mesclados = mesclarComCache(eventosNormalizados);
  // Marca como finalizados os eventos que já vierem finalizados do backend (vão direto ao histórico)
  try{
    let changed = false;
    for (const ev of (mesclados||[])){
      const f = ev && (ev.finalizado !== undefined ? ev.finalizado : ev.finalizado_evento);
      const truthy = (typeof f === 'string') ? /^(true|1|sim|yes)$/i.test(f.trim()) : !!f;
      if (truthy){
        const id = String(ev.id);
        if (!eventosFinalizados.has(id)) { eventosFinalizados.add(id); changed = true; }
      }
    }
    if (changed) salvarEventosFinalizados();
  }catch(_){ }
  eventosEnriquecidos = mesclados;
  if (isDebugEnabled()) { try{ window.__DEBUG_LAST_MERGED = mesclados.slice(); }catch(_){ } }
  try{ salvarCacheEventos(); }catch(_){ }
  try{ carregarAgendaDeCacheOuExemplo(); }catch(_){ }
}

/* =========================
   FUNÇÕES AGENDA / RENDER
   ========================= */
function obterEventosPendentes(apenasFuturos=false){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return eventosEnriquecidos
    .filter(ev => !eventosFinalizados.has(ev.id) && !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id))
    .filter(ev => {
      if (!apenasFuturos) return true;
      const d = ev.data_agendamento ? parseDatePreserveUTC(ev.data_agendamento) : null;
      if (!d || Number.isNaN(d.getTime())) return true;
      d.setHours(0,0,0,0);
      return d >= hoje;
    })
    .sort((a,b)=> {
      const da = parseDatePreserveUTC(a.data_agendamento) || new Date(0);
      const db = parseDatePreserveUTC(b.data_agendamento) || new Date(0);
      return da - db;
    });
}

function atualizarEstatisticas(dados) {
  const hoje = new Date();
  const mesAtual = hoje.getMonth()+1;
  const anoAtual = hoje.getFullYear();

  const eventosMes = eventosEnriquecidos.filter(ev => {
    const d = parseDatePreserveUTC(ev.data_agendamento);
    return d && (d.getMonth()+1===mesAtual) && (d.getFullYear()===anoAtual);
  });

  const concluidosArr = eventosEnriquecidos.filter(ev=> eventosFinalizados.has(ev.id) && !eventosEliminados.has(ev.id));
  const cidadesFinalizadas = [...new Set(concluidosArr.map(ev=> ev.cidade).filter(Boolean))];

  // Faturamento apenas de finalizados (mantendo regra original)
  const faturamento = eventosEnriquecidos.reduce((acc,ev)=> {
    return eventosFinalizados.has(ev.id) ? acc + (parseNum(ev.valor_total)||0) : acc;
  },0);

  const proximo = obterEventosPendentes(true)[0] || null;

  if (elementos.eventosMes) elementos.eventosMes.textContent = String(eventosMes.length);
  if (elementos.eventosConcluidos) elementos.eventosConcluidos.textContent = String(concluidosArr.length);
  try{ if (elementos.pendentesGastos) elementos.pendentesGastos.textContent = String(contarPendentesDeFinalizar()); }catch(_){ }
  if (elementos.cidadesVisitadas) elementos.cidadesVisitadas.textContent = String(cidadesFinalizadas.length);
  if (elementos.faturamentoTotal) elementos.faturamentoTotal.textContent = BRL(faturamento);
  if (elementos.proximoEvento) {
    elementos.proximoEvento.textContent = proximo ? `${formatarData(proximo.data_agendamento)} • ID ${proximo.id}` : '-';
  }

  proximoEventoAtual = proximo;
  atualizarDistanciaProximoDestino();
  renderizarHistorico();
  try{ renderizarPendentesDeFinalizar(); }catch(_){ }
  try{ renderizarFeedbacks(); }catch(_){ }

  console.log('[Agenda] Estatisticas atualizadas:', {
    eventosMes: eventosMes.length,
    cidades: cidadesFinalizadas.length,
    faturamento, proximoEvento: elementos.proximoEvento ? elementos.proximoEvento.textContent : '-'
  });
}

function renderizarProximosEventos(){
  const __refreshDespesas = ()=>{ try{ despesasRefresh && despesasRefresh(currentPeriod && currentPeriod()); }catch(_){ } };
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  // Exibir apenas eventos futuros (a partir de hoje), exceto cancelados/finalizados/eliminados
  const pendentes = obterEventosPendentes(true);
  if (elementos.eventsCount) elementos.eventsCount.textContent = `${pendentes.length} eventos`;

  if (!pendentes.length) {
    elementos.upcomingEventsList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-calendar-check"></i>
        <p>Zero eventos pendentes. Hora de conquistar novos horizontes!</p>
      </div>`;
    __refreshDespesas();
    return;
  }

  const showAll = !!(window.__SHOW_ALL_UPCOMING);
  const visiveis = showAll ? pendentes : pendentes.slice(0, MAX_PROXIMOS_EVENTOS);
  const cards = visiveis.map(ev => {
    const d = ev.data_agendamento ? parseDatePreserveUTC(ev.data_agendamento) : null;
    const isValid = d && !Number.isNaN(d.getTime());
    const dia = isValid ? d.getDate() : '--';
    const baseDay = new Date(d || hoje); baseDay.setHours(0,0,0,0);
    const diasRest = isValid ? Math.max(0, Math.ceil((baseDay - hoje)/86400000)) : '--';
    const alunosEstimados = parseNum(ev.numero_de_alunos) || Math.max(1, Math.round((parseNum(ev.valor_total)||0)/100));
    const distancia = ev.distancia_km ? `${ev.distancia_km} km` : 'N/A';
    const currentLabel = (function(){ try{ return loadLocationLabel(); }catch(_){ return ''; } })();
    const isNextEvent = !!(proximoEventoAtual && String(proximoEventoAtual.id) === String(ev.id));
    const useCurrentAsOrigin = isNextEvent && !!currentLabel; // somente o evento mais próximo usa a localização atual
    const originCity = useCurrentAsOrigin
      ? String(currentLabel)
      : (sanitizeCityName(ev.cidade_origem || ev.origem || ev.origem_cidade || ev.cidade) || 'Origem');
    const destCity = sanitizeCityName(ev.cidade_destino || ev.cidade || ev.destino) || 'Destino';
    const hasGift = (() => {
      const v = (typeof ev.brinde !== 'undefined') ? ev.brinde : ev.gift;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') { const s = v.toLowerCase(); return s==='sim'||s==='true'; }
      return false;
    })();
    const brindeBadge = hasGift
      ? '<span class="chip chip-brinde yes" title="Brinde incluído"><i class="fas fa-gift"></i> Brinde</span>'
      : '<span class="chip chip-brinde no" title="Sem brinde"><i class="fas fa-gift"></i> Sem brinde</span>';

    // Título prioriza Conteúdo da Apresentação ou Texto da Tarefa
    const primaryTitle = (function(){
      try{
        const t = (ev.conteudo_da_apresentacao || ev.texto_tarefa || ev.nome_da_escola || ev.cidade || 'Evento');
        return safe(String(t));
      }catch(_){ return 'Evento'; }
    })();
    // Chip de diárias quando multi-dia
    const diariasChip = (function(){
      const n = Math.max(1, parseInt(ev.dias_total || ev.numero_de_diarias, 10) || 1);
      return n>1 ? `<span class=\"chip\" title=\"Evento de ${n} diárias\"><i class=\"fas fa-calendar-day\"></i> ${n} diárias</span>` : '';
    })();

    // Helpers para montar linhas e sanitizar
    const prettyLabel = (k)=>{
      const map = {
        id:'ID', id_evento:'ID do Evento',
        data_agendamento:'Data do agendamento',
        tarefa:'Tarefa',
        cidade:'Cidade', cidade_origem:'Cidade de origem', cidade_destino:'Cidade de destino',
        nome_da_escola:'Escola',
        valor_total:'Valor total',
        turno:'Turno',
        responsavel_pelo_evento:'Responsável',
        contato_responsavel:'Telefone',
        alunos:'Alunos',
        modelo_veiculo:'Modelo do veículo', placa:'Placa',
        observacoes:'Observações', obs:'Observações',
        brinde:'Brinde', gift:'Brinde',
        distancia_km:'Distância (km)',
        status:'Status'
      };
      return map[k] || k.replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase());
    };
    const safe = (v)=>{
      const s = (v==null?'-': String(v));
      const map = {"&":"&amp;","<":"&lt;",
                   ">":"&gt;","\"":"&quot;","'":"&#39;"};
      return s.replace(/[&<>"']/g, ch => map[ch] || ch);
    };
    const isEmptyVal = (v)=>{
      if (v==null) return true;
      if (typeof v === 'string'){
        const t = v.trim();
        if (!t) return true;
        if (/^(null|undefined|-|nan)$/i.test(t)) return true;
      }
      return false;
    };
    const skipFields = new Set([
      'dias_total','ocorrencias_dias','avaliacao_astronomo','local_instalacao',
      'diaria_hospedagem','alimentacao_diaria','monitor','pedagios','gasto_combustivel',
      'id_astronomo','astronomo','texto_tarefa'
    ]);
    const shouldSkip = (key, val)=>{
      const s = String(key).toLowerCase();
      if (/^(coordenadas|waypoints|rota|historico|_.*)$/.test(s)) return true; // objetos grandes
      if (/(origem|destino).*?(lat|lon|lng)/.test(s)) return true; // pedido do usuário
      if (/^(lat|lng|lon)$/.test(s)) return true;
      if (skipFields.has(s)) return true;
      // status pendente não agrega informação útil
      if (s==='status' && typeof val==='string' && val.toLowerCase().trim()==='pendente') return true;
      // valores vazios
      if (isEmptyVal(val)) return true;
      return false;
    };
    const line = (label, value)=> `<div><strong>${safe(label)}:</strong> ${safe(value)}</div>`;
    // Agrupamentos: Evento, Logística e Contato (quatro boxes no card)
    const eventoGroup = [];
    const logisticaGroup = [];
    const contatoGroup = [];
    const used = new Set();
    // Evento
    if (ev.data_agendamento) { eventoGroup.push(line('Data', formatarData(ev.data_agendamento))); used.add('data_agendamento'); }
    if (ev.tarefa && !isEmptyVal(ev.tarefa)) { eventoGroup.push(line('Tarefa', ev.tarefa)); used.add('tarefa'); used.add('tipo_da_tarefa'); }
    if (ev.texto_tarefa && !isEmptyVal(ev.texto_tarefa)) { eventoGroup.push(line('Texto da Tarefa', ev.texto_tarefa)); used.add('texto_tarefa'); }
    if (ev.status && String(ev.status).toLowerCase().trim()!=='pendente') { eventoGroup.push(line('Status', String(ev.status))); used.add('status'); }
    if (ev.alunos != null && !isEmptyVal(ev.alunos)) { eventoGroup.push(line('Alunos', String(ev.alunos))); used.add('alunos'); used.add('numero_de_alunos'); }
    if (ev.produtos && !isEmptyVal(ev.produtos)) { eventoGroup.push(line('Produto', ev.produtos)); used.add('produtos'); }
    if (ev.conteudo_da_apresentacao && !isEmptyVal(ev.conteudo_da_apresentacao)) { eventoGroup.push(line('Conteúdo', ev.conteudo_da_apresentacao)); used.add('conteudo_da_apresentacao'); }
    if (ev.turno && !isEmptyVal(ev.turno)) { eventoGroup.push(line('Turno', ev.turno)); used.add('turno'); }
    if (ev.id!=null && !isEmptyVal(ev.id)) { eventoGroup.push(line('ID do Evento', String(ev.id))); used.add('id'); used.add('id_evento'); }
    if (typeof ev.brinde !== 'undefined' || typeof ev.gift !== 'undefined'){
      const gv = (typeof ev.brinde !== 'undefined') ? ev.brinde : ev.gift;
      const yn = (gv===true || (typeof gv==='string' && /^(sim|true|1)$/i.test(gv))) ? 'Sim' : 'Não';
      eventoGroup.push(line('Brinde', yn)); used.add('brinde'); used.add('gift');
    }
    if ((ev.observacoes && !isEmptyVal(ev.observacoes)) || (ev.obs && !isEmptyVal(ev.obs))) { eventoGroup.push(line('Observações', ev.observacoes || ev.obs)); used.add('observacoes'); used.add('obs'); }
    if (ev.dia_da_semana && !isEmptyVal(ev.dia_da_semana)) { eventoGroup.push(line('Dia da semana', ev.dia_da_semana)); used.add('dia_da_semana'); }
    // Logística
    if (ev.cidade && !isEmptyVal(ev.cidade)) { logisticaGroup.push(line('Cidade', sanitizeCityName(ev.cidade))); used.add('cidade'); }
    // Origem deve refletir a cidade atual (manual/permissão) quando disponível
    const origemLabel = useCurrentAsOrigin
      ? String(currentLabel)
      : sanitizeCityName(ev.cidade_origem || ev.origem || ev.origem_cidade || ev.cidade);
    if (origemLabel && !isEmptyVal(origemLabel)) { logisticaGroup.push(line('Origem', origemLabel)); used.add('cidade_origem'); used.add('origem'); used.add('origem_cidade'); }
    // Destino será mostrado em Contato para balancear as colunas
    if (ev.modelo_veiculo && !isEmptyVal(ev.modelo_veiculo)) { logisticaGroup.push(line('Veículo', ev.modelo_veiculo)); used.add('modelo_veiculo'); }
    if (ev.placa && !isEmptyVal(ev.placa)) { logisticaGroup.push(line('Placa', ev.placa)); used.add('placa'); }
    if (ev.valor_litro != null && !isEmptyVal(ev.valor_litro)) { logisticaGroup.push(line('Valor Litro', String(ev.valor_litro))); used.add('valor_litro'); }
    // Duração em horas (converte de minutos se necessário)
    try{
      const mins = parseNum(ev.duracao_minutos);
      if (mins>0){
        const horas = Math.round((mins/60)*10)/10; // 1 casa decimal
        logisticaGroup.push(line('Duração (h)', String(horas)));
        used.add('duracao_minutos');
      } else if (ev.duracao_horas && !isEmptyVal(ev.duracao_horas)){
        logisticaGroup.push(line('Duração (h)', String(ev.duracao_horas)));
        used.add('duracao_horas');
      }
    }catch(_){ }

    // Lucro Base (26%) e Lucro Líquido estimado por evento
    const valorEvento = parseNum(ev.valor_total) || 0;
    const lucroBaseEvento = valorEvento * 0.26;
    const estEv = estimativasDeEvento(ev);
    const lucroLiquidoEstimado = lucroBaseEvento - (estEv.total || 0);
    used.add('valor_total'); used.add('id');

    const alunosChip = (()=>{
      const raw = (ev.numero_de_alunos!=null) ? String(ev.numero_de_alunos).trim() : null;
      let label = null;
      if (raw){
        if (/\d+\s*(a|à|\-|até)\s*\d+/i.test(raw) || /[a-zA-Z]/.test(raw)) label = raw;
        else if (parseNum(raw)>0) label = String(parseNum(raw));
      }
      if (!label){
        const n = (ev.alunos!=null && parseNum(ev.alunos)>0) ? parseNum(ev.alunos) : alunosEstimados;
        label = `~${n}`;
      }
      return `<span class=\"chip chip-alunos\"><i class=\"fas fa-users\"></i> ${label} alunos</span>`;
    })();
    // Contato (inicia com os principais e completa com demais chaves de contato)
    if (ev.nome_da_escola && !isEmptyVal(ev.nome_da_escola)) { contatoGroup.push(`${line('Escola', ev.nome_da_escola)}`); used.add('nome_da_escola'); }
    if (ev.responsavel_pelo_evento && !isEmptyVal(ev.responsavel_pelo_evento)) { contatoGroup.push(`${line('Responsável', ev.responsavel_pelo_evento)}`); used.add('responsavel_pelo_evento'); }
    if (ev.contato_responsavel && !isEmptyVal(ev.contato_responsavel)) { contatoGroup.push(`${line('Telefone', ev.contato_responsavel)}`); used.add('contato_responsavel'); used.add('telefone_responsavel_evento'); }
    if (ev.endereco && !isEmptyVal(ev.endereco)) { contatoGroup.push(`${line('Endereço', ev.endereco)}`); used.add('endereco'); }
    if (ev.cidade_destino && !isEmptyVal(ev.cidade_destino)) { contatoGroup.push(line('Cidade (Destino)', sanitizeCityName(ev.cidade_destino))); used.add('cidade_destino'); }
    if (ev.email && !isEmptyVal(ev.email)) { contatoGroup.push(line('Email', ev.email)); used.add('email'); }
    if ((ev.whatsapp && !isEmptyVal(ev.whatsapp)) || (ev.whats && !isEmptyVal(ev.whats))) { contatoGroup.push(line('WhatsApp', ev.whatsapp || ev.whats)); used.add('whatsapp'); used.add('whats'); }

    // Completar com quaisquer chaves restantes, jogando para o grupo mais apropriado
    try{
      for (const [k,v] of Object.entries(ev||{})){
        if (used.has(k)) continue;
        if (shouldSkip(k, v)) continue;
        const low = String(k).toLowerCase();
        const val = (v==null) ? '-' : (typeof v==='object' ? JSON.stringify(v) : String(v));
        if (isEmptyVal(val)) { used.add(k); continue; }
        if (/(responsavel|telefone|contato|email|whats)/.test(low)) { contatoGroup.push(line(prettyLabel(k), val)); used.add(k); continue; }
        if (/(cidade|endereco|bairro|uf|estado|origem|destino|distancia|km|minuto|duracao)/.test(low)) { logisticaGroup.push(line(prettyLabel(k), val)); used.add(k); continue; }
        if (/(valor|id|produto|conteudo|turno|brinde|aluno|observa|nota|avaliacao)/.test(low)) { eventoGroup.push(line(prettyLabel(k), val)); used.add(k); continue; }
        // Padrão: adiciona ao Evento
        eventoGroup.push(line(prettyLabel(k), val)); used.add(k);
      }
    }catch(_){ }

    // Resumo: inserir Texto da Tarefa quando existir
    const resumoExtras = [];
    if (ev.texto_tarefa && !isEmptyVal(ev.texto_tarefa)) {
      resumoExtras.push(`<div><strong>Texto Tarefa:</strong> ${safe(ev.texto_tarefa)}</div>`);
      used.add('texto_tarefa');
    }

    return `
    <details class="custos-card" id="event-card-${ev.id}">
      <summary class="custos-summary">
        <div class="custos-summary-left">
          <i class="fas fa-school"></i>
          <div>
            <div class="title">${primaryTitle} <span class="chip small" title="ID do Evento"><i class="fas fa-hashtag"></i> ${ev.id}</span></div>
            <div class="sub">${originCity} → ${destCity} • ${d && !Number.isNaN(d.getTime()) ? formatarData(ev.data_agendamento) : '-'}</div>
          </div>
        </div>
        <div class="custos-summary-right">
          <span class="chip"><i class="fas fa-location-dot"></i> ${originCity} → ${destCity}</span>
          <span class="chip"><i class="fas fa-clock"></i> ${ev.turno || 'Não informado'}</span>
          ${alunosChip}
          ${brindeBadge}
          ${diariasChip}
          <span class="chip chip-valor"><i class="fas fa-wallet"></i> ${BRL(parseNum(ev.valor_total))}</span>
          <i class="fas fa-chevron-down arrow"></i>
        </div>
      </summary>
      <div class="custos-details painel-evento">
        <div>
          <h4><i class="fas fa-circle-info"></i> Resumo</h4>
          ${line('Origem → Destino', `${originCity} → ${destCity}`)}
          ${line('Distância', `${distancia}`)}
          ${line('Valor', `${BRL(parseNum(ev.valor_total))}`)}
          ${line('Lucro Base (26%)', `${BRL(lucroBaseEvento)}`)}
          ${line('Lucro Líquido (est.)', `${BRL(lucroLiquidoEstimado)}`)}
          ${resumoExtras.join('')}
          
        </div>
      <div>
          <h4><i class="fas fa-location-dot"></i> Contato</h4>
          ${contatoGroup.join('') || '<div><strong>—</strong> Sem dados</div>'}
      </div>
        <div>
          <h4><i class="fas fa-clipboard-list"></i> Evento</h4>
          ${eventoGroup.join('') || '<div><strong>—</strong> Sem dados</div>'}
        </div>
        <div>
          <h4><i class="fas fa-truck"></i> Logística</h4>
          ${logisticaGroup.join('') || '<div><strong>—</strong> Sem dados</div>'}
        </div>
      </div>
      <div class="event-actions-footer">
        <button class="btn btn-whatsapp" type="button" onclick="abrirWhatsApp('${ev.contato_responsavel||''}', '${ev.nome_da_escola||''}')"><i class="fab fa-whatsapp"></i> WhatsApp</button>
        <button class="btn btn-maps" type="button" onclick="abrirRotaMaps('${(ev.cidade||'').toString().replace(/'/g, '&#39;')}', ${ev.coordenadas?.lat ?? 'null'}, ${ev.coordenadas?.lng ?? 'null'}, '${originCity.toString().replace(/'/g, '&#39;')}', '${String(ev.id).replace(/'/g, '&#39;')}')"><i class="fas fa-route"></i> Ver rota</button>
        <button class="btn btn-secondary" type="button" onclick="abrirHoteisProximos(${ev.coordenadas?.lat ?? 'null'}, ${ev.coordenadas?.lng ?? 'null'}, '${(ev.cidade||'').toString().replace(/'/g, '&#39;')}')"><i class="fas fa-hotel"></i> Hotéis</button>
        <button class="btn btn-secondary" type="button" onclick="abrirRestaurantesProximos(${ev.coordenadas?.lat ?? 'null'}, ${ev.coordenadas?.lng ?? 'null'}, '${(ev.cidade||'').toString().replace(/'/g, '&#39;')}')"><i class="fas fa-utensils"></i> Comer</button>
        ${(()=>{ const td=Math.max(1, parseInt(ev.dias_total,10)||1); const cd=getMultiProgressFor(ev.id); const isLast=(cd+1)>=td; const txt = td>1 ? (isLast? 'Finalizar (último dia)':'Concluir dia '+(cd+1)+'/'+td) : 'Finalizar'; return `<button class=\"btn btn-secondary\" type=\"button\" onclick=\"finalizarEvento('${ev.id}')\"><i class=\"fas fa-check\"></i> ${txt}</button>`; })()}
        <button class="btn btn-secondary" type="button" onclick="cancelarEvento('${ev.id}')"><i class="fas fa-ban"></i> Cancelar</button>
        <button class="btn btn-secondary" type="button" onclick="excluirEvento('${ev.id}')"><i class="fas fa-trash"></i> Excluir</button>
      </div>
    </details>`;
  }).join('');

  // Atualiza rótulo do botão "Exibir todos"
  try{
    if (elementos.showAllUpcomingBtn){
      if (pendentes.length <= MAX_PROXIMOS_EVENTOS){ elementos.showAllUpcomingBtn.style.display='none'; }
      else {
        elementos.showAllUpcomingBtn.style.display='inline-flex';
        elementos.showAllUpcomingBtn.innerHTML = showAll ? '<i class="fas fa-compress"></i> Exibir menos' : '<i class="fas fa-list"></i> Exibir todos';
      }
    }
  }catch(_){ }

  const filaExtra = (!showAll && pendentes.length > MAX_PROXIMOS_EVENTOS)
    ? `<div class="queue-hint">+${pendentes.length - MAX_PROXIMOS_EVENTOS} eventos aguardando</div>`
    : '';

  elementos.upcomingEventsList.innerHTML = cards + filaExtra;
  console.log('[Agenda] Próximos eventos renderizados');

  try{ renderizarPendentesDeFinalizar(); }catch(_){ }
}

// Marca como finalizados todos os eventos que já possuem despesas reais lançadas
function syncFinalizadosComDespesas(){
  try{
    const reaisMap = loadDespesasReais();
    let changed = false;
    for (const ev of (eventosEnriquecidos||[])){
      const id = String(ev.id);
      if (reaisMap && Object.prototype.hasOwnProperty.call(reaisMap, id)){
        if (!eventosFinalizados.has(id)){ eventosFinalizados.add(id); changed = true; }
      }
    }
    if (changed) salvarEventosFinalizados();
  }catch(_){ }
}

// Renderiza seção de pendentes de lançar (eventos anteriores a hoje, não cancelados/eliminados e sem despesas reais)
function renderizarPendentesDeFinalizar(){
  const host = elementos.pendingList; if (!host) return;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const reaisMap = loadDespesasReais();
  const pendentes = (eventosEnriquecidos||[]).filter(ev=>{
    const d = parseDatePreserveUTC(ev.data_agendamento); if (!d) return false; d.setHours(0,0,0,0);
    if (d >= hoje) return false;
    const id = String(ev.id);
    const temReal = !!(reaisMap && Object.prototype.hasOwnProperty.call(reaisMap, id));
    return !temReal && !eventosFinalizados.has(id) && !eventosCancelados.has(id) && !eventosEliminados.has(id);
  });

  if (elementos.pendingCount) elementos.pendingCount.textContent = `${pendentes.length} eventos`;
  if (elementos.pendingSection) elementos.pendingSection.style.display = pendentes.length ? '' : 'none';
  if (!pendentes.length){ host.innerHTML = '<div class="empty-state"><i class="fas fa-check"></i><p>Sem pendências de finalização.</p></div>'; return; }

  host.innerHTML = pendentes.map(ev=>{
    const id = String(ev.id);
    const d = parseDatePreserveUTC(ev.data_agendamento);
    const cidade = sanitizeCityName(ev.cidade||'');
    const est = estimativasDeEvento(ev);
    const estTotal = est.total;
    const faturamento = parseNum(ev.valor_total);
    const lucroBaseEvento = (faturamento||0) * 0.26;
    const lucroLiquidoEst = lucroBaseEvento - (estTotal||0);
    return `
      <details class="custos-card" data-pending-id="${id}">
        <summary class="custos-summary">
          <div class="custos-summary-left">
            <i class="fas fa-hourglass-half"></i>
            <div>
              <div class="title">${ev.nome_da_escola || cidade || 'Evento'} <span class="chip small"><i class="fas fa-hashtag"></i> ${id}</span></div>
              <div class="sub">${cidade} • ${isNaN(d)?'-':d.toLocaleDateString('pt-BR')}</div>
            </div>
          </div>
          <div class="custos-summary-right">
            ${faturamento ? `<span class=\"chip chip-valor\"><i class=\"fas fa-coins\"></i> Faturamento: ${BRL(faturamento)}</span>` : ''}
            <span class=\"chip chip-valor\"><i class=\"fas fa-wallet\"></i> Est.: ${BRL(estTotal)}</span>
            <span class=\"chip chip-lucro ${lucroLiquidoEst>=0?'positive':'negative'}\"><i class=\"fas fa-hand-holding-dollar\"></i> ${BRL(lucroLiquidoEst)}</span>
            <button type="button" class="btn btn-secondary toggle-event">Detalhes</button>
            ${(()=>{ const td=Math.max(1, parseInt(ev.dias_total,10)||1); const cd=getMultiProgressFor(ev.id); const isLast=(cd+1)>=td; const txt = td>1 ? (isLast? 'Finalizar (último dia)':'Concluir dia '+(cd+1)+'/'+td) : 'Finalizar'; return `<button type=\"button\" class=\"btn btn-secondary finalize-event\"><i class=\"fas fa-check\"></i> ${txt}</button>`; })()}
            <button type="button" class="btn btn-route launch-expense">Lançar Despesas</button>
            <i class="fas fa-chevron-down arrow"></i>
          </div>
        </summary>
        <div class="custos-details painel-evento">
          <div class="cost-box estimated">
            <h4><i class="fas fa-sack-dollar"></i> Estimados</h4>
          <div class="cost-line"><span>Combustível (est.)</span><span>${BRL(est.combustivel)}</span></div>
          ${(()=>{ try{ const m=estEv && estEv.metaComb; if(!m) return ''; const d=isFinite(m.distanciaKm)? m.distanciaKm: null; const c=isFinite(m.consumoKmL)? m.consumoKmL: null; const vl=isFinite(m.valorLitro)? m.valorLitro: null; if(!(d>0 && c>0 && vl>0)) return ''; const det = `${d} km / ${c} km/L × ${BRL(vl)}`; return `<div class=\"cost-line\"><span>Cálculo combustível</span><span>${det}</span></div>`; }catch(_){ return ''; } })()}
            <div class="cost-line"><span>Hospedagem</span><span>${BRL(est.hospedagem)}</span></div>
            <div class="cost-line"><span>Alimentação</span><span>${BRL(est.alimentacao)}</span></div>
            <div class="cost-line"><span>Monitor</span><span>${BRL(est.monitor)}</span></div>
          <div class="cost-line"><span>Pedágios</span><span>${BRL(est.pedagios)}</span></div>
          ${(()=>{ try{ const m=estEv && estEv.metaComb; const vl = m && isFinite(m.valorLitro)? m.valorLitro: parseNum(ev.valor_litro); return `<div class=\"cost-line\"><span>Valor do litro (R$)</span><span>${BRL(vl)}</span></div>`; }catch(_){ return ''; } })()}
            <div class="cost-total"><span>Total</span><span>${BRL(estTotal)}</span></div>
          </div>
          <form class="launch-form expense-form cost-box" data-form-event-id="${id}">
            <h4><i class="fas fa-pencil"></i> Lançar despesas</h4>
            <div class="form-grid">
              <div class="form-row"><label>Combustível</label><input type="number" step="0.01" name="combustivel_real" /></div>
              <div class="form-row"><label>Hospedagem</label><input type="number" step="0.01" name="hospedagem_real" /></div>
              <div class="form-row"><label>Alimentação</label><input type="number" step="0.01" name="alimentacao_real" /></div>
              <div class="form-row"><label>Monitor</label><input type="number" step="0.01" name="monitor_real" /></div>
              <div class="form-row"><label>Pedágios</label><input type="number" step="0.01" name="pedagios_real" /></div>
              <div class="form-row"><label>Valor do litro (R$)</label><input type="number" step="0.01" name="valor_litro" /></div>
              <div class="form-row"><label>Outros</label><input type="number" step="0.01" name="outros" /></div>
              <div class="form-row"><label>Observações</label><textarea name="observacoes" rows="2" placeholder="Observações (opcional)"></textarea></div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-primary form-submit">Lançar</button>
            </div>
          </form>
        </div>
      </details>`;
  }).join('');

  // bind submits
  try{
    host.querySelectorAll('.custos-card').forEach(card=>{
      const id = card.getAttribute('data-pending-id');
      const btnToggle = card.querySelector('.toggle-event');
      const btnLaunch = card.querySelector('.launch-expense');
      const btnFinalize = card.querySelector('.finalize-event');
      const form = card.querySelector('form.expense-form');
      if (btnToggle) btnToggle.addEventListener('click', ()=>{ card.open = !card.open; });
      if (btnLaunch) btnLaunch.addEventListener('click', ()=>{ if (!form) return; card.open = true; form.style.display = 'block'; });
      if (btnFinalize) btnFinalize.addEventListener('click', ()=>{ finalizarEvento(id); });
      if (form){
        const submit = form.querySelector('.form-submit');
        if (submit){
        submit.addEventListener('click', async ()=>{
          const fd = new FormData(form);
          const payload = {
            combustivel_real: parseNum(fd.get('combustivel_real')),
            hospedagem_real:  parseNum(fd.get('hospedagem_real')),
            alimentacao_real: parseNum(fd.get('alimentacao_real')),
            monitor_real:     parseNum(fd.get('monitor_real')),
            pedagios_real:    parseNum(fd.get('pedagios_real')),
            valor_litro:      parseNum(fd.get('valor_litro')),
            outros:           parseNum(fd.get('outros')),
            observacoes:      String(fd.get('observacoes')||'').trim()
          };
          const res = await enviarDespesaReal(id, payload);
          if (res && res.ok){
            toast('Despesas lançadas. Evento movido para Concluídos.');
            try{ renderizarPendentesDeFinalizar(); }catch(_){ }
          } else {
            // erro já toasteado dentro de enviarDespesaReal
          }
        });
        }
      }
    });
  }catch(_){ }
}

function toggleEventDetails(eventId){
  const card = document.getElementById(`event-card-${eventId}`);
  if (!card) return;
  const arrow = card.querySelector('.toggle-arrow');
  document.querySelectorAll('.upcoming-event-card.open').forEach(c => {
    if (c !== card) {
      c.classList.remove('open');
      const a = c.querySelector('.toggle-arrow'); if (a) a.className = 'fas fa-chevron-down toggle-arrow';
    }
  });
  card.classList.toggle('open');
  if (arrow) arrow.className = card.classList.contains('open') ? 'fas fa-chevron-up toggle-arrow' : 'fas fa-chevron-down toggle-arrow';
}

function atualizarEventosHoje(){
  const base = getSelectedDate(); base.setHours(0,0,0,0);
  const keyHoje = `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
  const eventosHoje = eventosEnriquecidos.filter(ev => {
    try{
      if (Array.isArray(ev.ocorrencias_dias) && ev.ocorrencias_dias.length){
        return ev.ocorrencias_dias.includes(keyHoje);
      }
    }catch(_){ }
    const d = parseDatePreserveUTC(ev.data_agendamento);
    if (!d) return false;
    d.setHours(0,0,0,0);
    return d.getTime()===base.getTime();
  });

  if (!eventosHoje.length){
    // Se o CalendarManager existir, usa as frases sazonais dele
    try{
      if (window.calendarManager && typeof window.calendarManager.setSelectedDate === 'function'){
        window.calendarManager.setSelectedDate(base, []);
        return;
      }
    }catch(_){ }
    // Fallback: estado vazio simples
    elementos.todayEventsList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-calendar-check"></i>
        <p>Nenhum evento para hoje</p>
      </div>`;
    return;
  }

  // Se o CalendarManager existir, delega a renderização para manter o CSS unificado
  try{
    if (window.calendarManager && typeof window.calendarManager.setSelectedDate === 'function'){
      window.calendarManager.setSelectedDate(base, eventosHoje);
      return; // evita renderização duplicada
    }
  }catch(_){ }

  elementos.todayEventsList.innerHTML = eventosHoje.map(ev=>{
    const totalDias = Math.max(1, parseInt(ev.dias_total,10) || 1);
    const concl = getMultiProgressFor(ev.id);
    const labelDias = totalDias>1 ? ` • Dia ${Math.min(concl+1,totalDias)}/${totalDias}` : '';
    const isCanceled = eventosCancelados.has(ev.id);
    const isDeleted = eventosEliminados.has(ev.id);
    const originCity = sanitizeCityName(ev.cidade_origem || ev.origem || ev.origem_cidade || ev.cidade || '');
    const destCity = sanitizeCityName(ev.cidade_destino || ev.cidade || ev.destino || '');
    const hasGift = (() => {
      const v = (typeof ev.brinde !== 'undefined') ? ev.brinde : ev.gift;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') { const s = v.toLowerCase(); return s==='sim'||s==='true'; }
      return false;
    })();
    const brindeChip = hasGift
      ? '<span class="chip chip-brinde yes" title="Brinde incluído"><i class="fas fa-gift"></i> Brinde</span>'
      : '<span class="chip chip-brinde no" title="Sem brinde"><i class="fas fa-gift"></i> Sem brinde</span>';
    const alunosChip = (()=>{
      const raw = (ev.numero_de_alunos!=null) ? String(ev.numero_de_alunos).trim() : null;
      let label = null;
      if (raw){
        if (/\d+\s*(a|à|\-|até)\s*\d+/i.test(raw) || /[a-zA-Z]/.test(raw)) label = raw;
        else if (parseNum(raw)>0) label = String(parseNum(raw));
      }
      if (!label){
        const estim = parseNum(ev.numero_de_alunos) || Math.max(1, Math.round((parseNum(ev.valor_total)||0)/100));
        label = `~${estim}`;
      }
      return `<span class=\"chip chip-alunos\"><i class=\"fas fa-users\"></i> ${label} alunos</span>`;
    })();
    const badgeLabel = isDeleted ? 'Eliminado' : (isCanceled ? 'Cancelado' : '');
    const statusClass = (isCanceled || isDeleted) ? 'cancelado' : (ev.status || 'pendente');
    const statusText = isDeleted ? 'eliminado' : (isCanceled ? 'cancelado' : (ev.status || 'pendente'));
    const waBtn = (isCanceled || isDeleted) ? '' : `
      <button class="btn btn-sm btn-whatsapp" onclick="abrirWhatsApp('${String(ev.contato_responsavel||'').replace(/\D/g,'')}', '${String(ev.nome_da_escola||'').replace(/'/g,'&#39;')}')">
        <i class="fab fa-whatsapp"></i>
      </button>`;
    const dFull = parseDateWithTime(ev.data_agendamento);
    const sel = getSelectedDate();
    const isSameDay = (dFull && dFull.getFullYear()===sel.getFullYear() && dFull.getMonth()===sel.getMonth() && dFull.getDate()===sel.getDate());
    const isToday = (function(){ const t=new Date(); return sel.getFullYear()===t.getFullYear() && sel.getMonth()===t.getMonth() && sel.getDate()===t.getDate(); })();
    const isPastNow = !!(isToday && dFull && dFull.getTime() < Date.now());
    const pastClass = isPastNow ? ' past-now' : '';
    return `
    <div class="today-event-item${(isCanceled||isDeleted) ? ' is-canceled' : ''}${pastClass}">
      <div class="today-event-time"><i class="fas fa-clock"></i><span>${ev.turno || 'Horário não definido'}</span></div>
      <div class="today-event-info">
        <h4>${ev.nome_da_escola||''} ${badgeLabel ? `<span class="tag-canceled">${badgeLabel}</span>` : ''}</h4>
        <p>${originCity}${destCity?` → ${destCity}`:''} - ${ev.tarefa||''}</p>
        <div class="today-event-meta">
          <span class="status-badge status-${statusClass}">${statusText}</span>
          <span class="event-value">${BRL(parseNum(ev.valor_total))}</span>
          <span class="event-id"><i class="fas fa-hashtag"></i> ID ${ev.id}${labelDias}</span>
        </div>
        <div class="today-event-meta">
          <span class="chip"><i class="fas fa-location-dot"></i> Destino: ${destCity || '-'}</span>
          ${alunosChip}
          ${brindeChip}
        </div>
      </div>
      ${waBtn}
    </div>`;
  }).join('');
}

/* =========================
   ROTAS
   ========================= */
function calcularRotaOtimizada(eventos) {
  const comCoord = eventos.filter(ev => ev.coordenadas && !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id));
  const dist = comCoord.reduce((acc,ev)=> acc + (parseNum(ev.distancia_km)||0), 0);
  const horas = Math.round(comCoord.reduce((acc,ev)=> acc + (parseNum(ev.distancia_km)||0)/60, 0));
  const waypoints = comCoord.map(ev => ({ cidade: ev.cidade, coordenadas: ev.coordenadas ? `${ev.coordenadas.lat},${ev.coordenadas.lng}` : '' }));
  const rota = { distancia_total: Math.round(dist), tempo_total_horas: horas, waypoints };
  console.log('Rota calculada:', rota);
  return rota;
}
function atualizarRotas(rota){
  if (!rota) return;
  if (elementos.totalDistance) elementos.totalDistance.textContent = `${rota.distancia_total} km`;
  if (elementos.totalTime) elementos.totalTime.textContent = `${rota.tempo_total_horas} horas`;
  if (elementos.routeSteps){
    elementos.routeSteps.innerHTML = (rota.waypoints||[]).map((p,i)=>{
      const coords = String(p.coordenadas||'').trim();
      const id = `route-step-${i}`;
      return `
        <div class="route-step" id="${id}">
          <div class="step-number">${i+1}</div>
          <div class="step-location">${p.cidade||'-'}</div>
          <button class="step-action" onclick="toggleRouteStep('${id}')" title="Expandir/Minimizar"><i class="fas fa-chevron-down"></i></button>
          <div class="route-step-details" style="display:none; grid-column:1 / -1;">
            <div class="map-embed" aria-label="Mapa da rota">
              ${coords ? `<iframe src="https://www.google.com/maps?q=loc:${coords}&output=embed" loading="lazy"></iframe>` : `<div class='map-embed-placeholder'><i class='fas fa-map'></i><div><div class='title'>Sem coordenadas</div><div class='hint'>Este ponto não possui coordenadas.</div></div></div>`}
            </div>
          </div>
        </div>`;
    }).join('');
  }
  console.log('🗺️ Rotas atualizadas:', rota);
}

// Converte o payload retornado pelo n8n (rota do dia) em um objeto compatível com atualizarRotas
function parseRotaDoDiaPayload(obj){
  try{
    if (!obj || !obj.rota) return null;
    const dist = Number(parseNum(obj.rota.distancia_km));
    const horas = Number(parseNum(obj.rota.duracao_horas));
    const origem = obj.origem || {};
    const destino = obj.destino || {};
    const oLat = Number(origem.lat ?? origem.latitude ?? origem.y ?? origem.latitud);
    const oLng = Number(origem.lng ?? origem.lon ?? origem.longitude ?? origem.x ?? origem.longitud);
    const dLat = Number(destino.lat ?? destino.latitude ?? destino.y ?? destino.latitud);
    const dLng = Number(destino.lng ?? destino.lon ?? destino.longitude ?? destino.x ?? destino.longitud);
    const oNome = sanitizeCityName(origem.cidade || origem.nome || origem.label || origem.endereco || 'Origem');
    const dNome = sanitizeCityName(destino.cidade || destino.nome || destino.label || destino.endereco || 'Destino');
    const waypoints = [];
    if (Number.isFinite(oLat) && Number.isFinite(oLng)) waypoints.push({ cidade:oNome, coordenadas:`${oLat},${oLng}` });
    if (Number.isFinite(dLat) && Number.isFinite(dLng)) waypoints.push({ cidade:dNome, coordenadas:`${dLat},${dLng}` });
    return {
      distancia_total: Number.isFinite(dist) ? Math.round(dist) : (Number.isFinite(dLat) && Number.isFinite(dLng) ? 0 : 0),
      tempo_total_horas: Number.isFinite(horas) ? Math.round(horas * 10)/10 : 0,
      waypoints
    };
  }catch(_){ return null; }
}

function applyRotaDoDiaFromPayload(obj){
  try{
    const rota = parseRotaDoDiaPayload(obj);
    if (rota){
      rotaDoDia = rota;
      try{ rotaDoDiaMapsLink = obj?.links?.google_maps || null; }catch(_){ rotaDoDiaMapsLink = null; }
      atualizarRotas(rotaDoDia);
    }
  }catch(_){ }
}
function abrirGoogleMaps(){
  if (rotaDoDiaMapsLink){
    window.open(rotaDoDiaMapsLink, '_blank');
    return;
  }
  if (eventosEnriquecidos.length && eventosEnriquecidos[0].coordenadas){
    const d = eventosEnriquecidos[0].coordenadas;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=driving`, '_blank');
  } else {
    alert('Nenhuma rota disponível no momento');
  }
}
function abrirRotaMaps(cidadeDestino, lat, lng, origemNome, idEvento){
  try{
    const locLabel = loadLocationLabel();
    const hasCurrent = !!(userLocation && typeof userLocation.lat==='number' && typeof userLocation.lng==='number');
    let originParam = '';
    const isNext = !!(proximoEventoAtual && String(proximoEventoAtual.id) === String(idEvento||''));
    if (isNext && hasCurrent){
      originParam = `&origin=${encodeURIComponent(`${userLocation.lat},${userLocation.lng}`)}`;
    } else if (origemNome && String(origemNome).trim()){
      // usa cidade base/origem informada
      originParam = `&origin=${encodeURIComponent(String(origemNome))}`;
    } else if (locLabel){
      // fallback: rótulo salvo (cidade base)
      originParam = `&origin=${encodeURIComponent(String(locLabel))}`;
    }

    if (Number(lat) && Number(lng)){
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${originParam}&travelmode=driving`, '_blank');
    } else {
      const dest = cidadeDestino ? String(cidadeDestino) : '';
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}${originParam}&travelmode=driving`, '_blank');
    }
  }catch(_){
    // Fallback: busca simples
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cidadeDestino||'destino')}`,'_blank');
  }
}

/* =========================
   GEOLOCALIZAÇÃO
   ========================= */
function atualizarNumeroDistancia(t){ if (elementos.distanceNextEvent) elementos.distanceNextEvent.textContent = t; }
function atualizarStatusLocalizacao(m){ if (elementos.distanceStatus) elementos.distanceStatus.textContent = m; }

async function capturarLocalizacaoAtual(force){
  try{
    if (!force){
      const declined = localStorage.getItem(keyFor('location_declined')) === '1';
      if (declined) return Promise.resolve(null);
    }
  }catch(_){ }
  if (!elementos.distanceNextEvent) return Promise.resolve(null);
  if (!('geolocation' in navigator)){
    atualizarNumeroDistancia('--'); atualizarStatusLocalizacao('Geolocalização não suportada'); return Promise.resolve(null);
  }
  // Exigir contexto seguro (HTTPS ou localhost)
  try{
    const secure = (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)(:|$)/i.test(location.host));
    if (!secure){
      atualizarNumeroDistancia('--');
      atualizarStatusLocalizacao('Ative HTTPS para usar geolocalização');
      return null;
    }
  }catch(_){ }

  // Verifica permissão (se disponível)
  try{
    if (!force && navigator.permissions && navigator.permissions.query){
      const p = await navigator.permissions.query({ name: 'geolocation' });
      if (p && p.state === 'denied'){
        atualizarNumeroDistancia('--'); atualizarStatusLocalizacao('Permissão negada'); return null;
      }
    }
  }catch(_){ }

  atualizarStatusLocalizacao('Solicitando localização…');

  // Helper para tentar obter posição
  const tryGet = (opts) => new Promise((resolve)=>{
    let done=false;
    navigator.geolocation.getCurrentPosition(pos=>{ if(done) return; done=true; resolve({ ok:true, pos }); }, err=>{ if(done) return; done=true; resolve({ ok:false, err }); }, opts);
    setTimeout(()=>{ if(done) return; done=true; resolve({ ok:false, err:{ code:3, message:'timeout' } }); }, Math.max(1000, Number(opts && opts.timeout) || 15000));
  });

  // 1ª tentativa: alta precisão, timeout curto
    let r = await tryGet({ enableHighAccuracy:true, timeout:12000, maximumAge:0 });
    if (!r.ok){
      // 2ª tentativa: precisão padrão, timeout maior
      r = await tryGet({ enableHighAccuracy:false, timeout:25000, maximumAge:0 });
    }
  if (!r.ok){
    // 3ª tentativa: watch por alguns segundos (passivo)
    try{
      const res = await new Promise((resolve)=>{
        let id=null; const timer=setTimeout(()=>{ if(id!=null) navigator.geolocation.clearWatch(id); resolve(null); }, 12000);
        id = navigator.geolocation.watchPosition(pos=>{ try{ if(id!=null) navigator.geolocation.clearWatch(id); }catch(_){ } clearTimeout(timer); resolve(pos); }, ()=>{}, { enableHighAccuracy:false, maximumAge:0 });
      });
      if (res){ r = { ok:true, pos: res }; }
    }catch(_){ }
  }

  if (r.ok){
    const pos = r.pos;
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy || null, timestamp: pos.timestamp };
    atualizarStatusLocalizacao(userLocation.accuracy ? `Precisão ~${Math.round(userLocation.accuracy)}m` : 'Localização atualizada');
    atualizarDistanciaProximoDestino();
    try{ enviarLocalizacaoN8N({ source:'geolocation' }); }catch(_){ }
    return userLocation;
  }

  // Falha geral: não abrir popup automaticamente aqui
  userLocation = null;
  const err = r.err || {}; const msg = err.code===1 ? 'Permissão negada' : err.code===2 ? 'Sinal indisponível' : 'Tempo excedido';
  atualizarNumeroDistancia('--'); atualizarStatusLocalizacao(msg);
  return null;
}

function calcularDistanciaKm(origem, destino){
  if (!origem || !destino) return NaN;
  const {lat:lat1, lng:lon1} = origem;
  const {lat:lat2, lng:lon2} = destino;
  if ([lat1,lon1,lat2,lon2].some(v => typeof v!=='number' || Number.isNaN(v))) return NaN;
  const toRad = v => v*Math.PI/180, R=6371;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

// Decide qual evento usar como referência para localização:
// - Até 19:00 → evento de hoje
// - Após 19:00 → evento de amanhã
// Fallback: próximo evento no futuro
function selecionarEventoReferenciaParaLocalizacao(){
  try{
    const now = new Date();
    const target = new Date(now);
    if (now.getHours() >= 19) target.setDate(target.getDate()+1);
    target.setHours(0,0,0,0);
    const candidatos = (eventosEnriquecidos||[])
      .filter(ev => !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id));

    const isSameDay = (ev, day)=>{
      const d = parseDatePreserveUTC(ev && ev.data_agendamento); if(!d) return false;
      d.setHours(0,0,0,0); return d.getTime() === day.getTime();
    };
    const evDia = candidatos.find(ev => isSameDay(ev, target));
    if (evDia) return evDia;

    // Próximo evento após a data alvo
    let melhor = null; let melhorT = Infinity;
    for (const ev of candidatos){
      const d = parseDatePreserveUTC(ev && ev.data_agendamento); if(!d) continue;
      d.setHours(0,0,0,0);
      const t = d.getTime();
      if (t >= target.getTime() && t < melhorT){ melhor = ev; melhorT = t; }
    }
    return melhor || null;
  }catch(_){ return null; }
}
function atualizarDistanciaProximoDestino(){
  if (!elementos.distanceNextEvent) return;
  const __refreshDespesas = ()=>{ try{ despesasRefresh && despesasRefresh(currentPeriod && currentPeriod()); }catch(_){ } };
  try{
    if (rotaDoDia && Number.isFinite(rotaDoDia.distancia_total)){
      atualizarNumeroDistancia(`${Math.round(rotaDoDia.distancia_total)} km`);
      atualizarStatusLocalizacao('Rota do dia (n8n)');
      __refreshDespesas();
      return;
    }
  }catch(_){ }
  if (!proximoEventoAtual){ atualizarNumeroDistancia('--'); atualizarStatusLocalizacao('Sem destino definido'); __refreshDespesas(); return; }
  // Preferir a distância já calculada do próprio evento, se disponível
  const distEvento = parseNum(proximoEventoAtual.distancia_km);
  if (Number.isFinite(distEvento) && distEvento > 0){
    atualizarNumeroDistancia(`${distEvento} km`);
    atualizarStatusLocalizacao('Distância do evento');
    __refreshDespesas();
    return;
  }
  // Senão, tentar calcular via geolocalização atual
  if (!proximoEventoAtual.coordenadas){ atualizarNumeroDistancia('--'); atualizarStatusLocalizacao('Destino sem coordenadas'); __refreshDespesas(); return; }
  if (!userLocation){ atualizarNumeroDistancia('--'); atualizarStatusLocalizacao('Aguardando localização…'); __refreshDespesas(); return; }
  const d = calcularDistanciaKm(userLocation, proximoEventoAtual.coordenadas);
  if (!isFinite(d)){ atualizarNumeroDistancia('--'); atualizarStatusLocalizacao('Não foi possível calcular'); __refreshDespesas(); return; }
  atualizarNumeroDistancia(`${d.toFixed(1)} km`);
  atualizarStatusLocalizacao(userLocation.accuracy ? `Precisão ~${Math.round(userLocation.accuracy)}m` : 'Localização atualizada');
  __refreshDespesas();
}

// Envia localização ao n8n e tenta atualizar a posição do usuário com a resposta
async function enviarLocalizacaoN8N(opts){
  try{
    // Helper robusto para extrair coordenadas de um evento em diferentes formatos
    const getEventCoords = (ev) => {
      try{
        if (!ev || typeof ev !== 'object') return null;
        const num = (v)=>{ const n = parseNum(v); return Number.isFinite(n) ? n : null; };
        // 1) Prioriza campo normalizado
        if (ev.coordenadas && num(ev.coordenadas.lat)!=null && num(ev.coordenadas.lng)!=null){
          return { lat: num(ev.coordenadas.lat), lng: num(ev.coordenadas.lng) };
        }
        // 2) Campos comuns no payload (variantes)
        const candidates = [
          { lat: ev.destino_lat, lng: ev.destino_lon },
          { lat: ev.destino_lat, lng: ev.destino_long },
          { lat: ev.destino_latitude, lng: ev.destino_longitude },
          { lat: ev.destino_latitud, lng: ev.destino_longitud },
          { lat: ev.lat_destino, lng: ev.lon_destino },
          { lat: ev.lat_destino, lng: ev.lng_destino },
          { lat: ev.latitude_destino, lng: ev.longitude_destino },
          { lat: ev.latitude, lng: ev.longitude },
          { lat: ev.lat, lng: ev.lng },
          { lat: ev.lat, lng: ev.lon },
          { lat: ev.y, lng: ev.x },
        ];
        for (const c of candidates){
          const la = num(c?.lat), lo = num(c?.lng);
          if (la!=null && lo!=null) return { lat: la, lng: lo };
        }
        // 3) Objetos aninhados (destino/origem) com variantes
        const nested = [ev.destino, ev.local, ev.location, ev.endereco, ev.geo]?.filter(Boolean) || [];
        for (const n of nested){
          const la = num(n?.lat ?? n?.latitude ?? n?.y ?? n?.latitud);
          const lo = num(n?.lng ?? n?.lon ?? n?.longitude ?? n?.x ?? n?.longitud ?? n?.long);
          if (la!=null && lo!=null) return { lat: la, lng: lo };
        }
      }catch(_){ }
      return null;
    };
    const s = getUserSession();
    // Enviar explicitamente para o endpoint remoto solicitado
    const base = withUserQuery(N8N_LANCAR_DESPESAS_URL || 'https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/agenda-astronomos');
    const u = new URL(base, window.location.origin);
    u.searchParams.set('action','obter_localizacao');
    u.searchParams.set('tipo','obter_localizacao');
    const isManual = !!(opts && (opts.source === 'manual' || opts.manualCity || opts.manualState));
    // posição atual (se houver) — não enviar se for manual
    if (!isManual && userLocation && typeof userLocation.lat==='number' && typeof userLocation.lng==='number'){
      u.searchParams.set('current_lat', String(userLocation.lat));
      u.searchParams.set('current_lng', String(userLocation.lng));
      if (userLocation.accuracy!=null) u.searchParams.set('accuracy', String(Math.round(userLocation.accuracy)));
    }
    // evento de referência (hoje até 19h; depois disso, amanhã; fallback próximo)
    const evRef = selecionarEventoReferenciaParaLocalizacao();
    if (evRef){
      u.searchParams.set('event_id', String(evRef.id));
      const coordsRef = getEventCoords(evRef);
      if (coordsRef && Number.isFinite(coordsRef.lat) && Number.isFinite(coordsRef.lng)){
        u.searchParams.set('event_lat', String(coordsRef.lat));
        u.searchParams.set('event_lng', String(coordsRef.lng));
      }
      if (evRef.cidade) u.searchParams.set('event_city', String(evRef.cidade));
      // Cidade de destino (nome), quando disponível
      try{
        const destName = sanitizeCityName(evRef.cidade_destino || evRef.destino || evRef.cidade || '');
        if (destName){
          u.searchParams.set('event_dest_city', String(destName));
          u.searchParams.set('cidade_destino', String(destName));
        }
      }catch(_){ }
      if (evRef.data_agendamento) u.searchParams.set('event_date', String(evRef.data_agendamento));
    }

    // Também enviar as coordenadas do PRÓXIMO evento pendente
    try {
      const nextEv = (typeof obterEventosPendentes === 'function')
        ? (obterEventosPendentes(true)[0] || null)
        : (typeof proximoEventoAtual !== 'undefined' ? proximoEventoAtual : null);
      if (nextEv) {
        const coordsNext = getEventCoords(nextEv);
        if (coordsNext && Number.isFinite(coordsNext.lat) && Number.isFinite(coordsNext.lng)){
          u.searchParams.set('next_event_lat', String(coordsNext.lat));
          u.searchParams.set('next_event_lng', String(coordsNext.lng));
        }
        if (nextEv.id != null) u.searchParams.set('next_event_id', String(nextEv.id));
        try {
          const ncity = sanitizeCityName(nextEv.cidade_destino || nextEv.destino || nextEv.cidade || '');
          if (ncity) u.searchParams.set('next_event_city', String(ncity));
        } catch(_){ }
      }
    } catch(_){ }
    // manual city
    if (opts && opts.manualCity){ u.searchParams.set('manual_city', String(opts.manualCity)); }
    if (opts && opts.manualState){
      u.searchParams.set('manual_state', String(opts.manualState));
      u.searchParams.set('uf', String(opts.manualState));
      u.searchParams.set('estado', String(opts.manualState));
    }
    u.searchParams.set('ts', String(Date.now()));
    // Exibir estado enquanto aguarda retorno
    try{ updateLocationLabelUI('Atualizando...'); }catch(_){ }
    const resp = await getWithTimeout(u.toString(), 20000);
    if (resp && resp.ok){
      const text = await resp.text().catch(()=> '');
      if (text && text.trim()){
        let data = null; try{ data = JSON.parse(text); } catch(_){ data = null; }
        const lat = (data && (Number(data.user_lat)||Number(data.lat)||Number(data?.current?.lat)));
        const lng = (data && (Number(data.user_lng)||Number(data.lng)||Number(data?.current?.lng)));
        if (Number.isFinite(lat) && Number.isFinite(lng)){
          userLocation = { lat, lng, accuracy: null, timestamp: Date.now() };
        }
        // Define o label a partir do payload (ou do manualCity/UF)
        try{
          const label = extractCityLabelFromResponse(data) || (opts && opts.manualCity ? `${opts.manualCity}${opts.manualState? ' - '+opts.manualState:''}` : '');
          if (label) updateLocationLabelUI(label);
        }catch(_){ }
        // Detecta rota do dia: array com item contendo .rota, ou objeto direto
        try{
          const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : null);
          const first = Array.isArray(arr) && arr.length ? arr[0] : (data && data.rota ? data : null);
          if (first && first.rota) applyRotaDoDiaFromPayload(first);
        }catch(_){ }
        atualizarDistanciaProximoDestino();
        try{ await initWeather(); }catch(_){ }
        try{ renderizarProximosEventos(); }catch(_){ }
      }
    }
  }catch(e){ console.warn('Falha ao enviar localização ao n8n', e); }
}

function abrirPromptLocalizacaoManual(force){
  try{
    if (!elementos.locationModal) return;
    // Se o usuário recusou recentemente e não foi uma abertura forçada (ex.: clique no botão), não reabrir
    try{
      const declined = localStorage.getItem(keyFor('location_declined')) === '1';
      if (declined && !force) return;
    }catch(_){ }
    elementos.locationModal.classList.add('open');
    const close = ()=>{ try{ elementos.locationModal.classList.remove('open'); }catch(_){ } };
    elementos.locationClose?.addEventListener('click', close, { once:true });
    elementos.locationCancel?.addEventListener('click', close, { once:true });
    elementos.locationUseCurrent?.addEventListener('click', async ()=>{
      try{
        // Captura posição atual e envia ao n8n aguardando resposta (que definirá label)
        await capturarLocalizacaoAtual(true);
      }catch(_){ }
      close();
    }, { once:true });
    elementos.locationDecline?.addEventListener('click', ()=>{ try{ localStorage.setItem(keyFor('location_declined'),'1'); }catch(_){ } close(); }, { once:true });
    elementos.locationSend?.addEventListener('click', async ()=>{
      const city = (elementos.manualCityInput?.value||'').trim();
      const uf = (elementos.manualStateInput?.value||'').trim();
      if (!city) { alert('Informe a cidade.'); return; }
      if (!uf) { alert('Selecione o estado (UF).'); return; }
      try{ localStorage.removeItem(keyFor('location_declined')); }catch(_){ }
      await enviarLocalizacaoN8N({ source:'manual', manualCity: city, manualState: uf });
      close();
    }, { once:true });
  }catch(_){ }
}

// Abre a aba Despesas e expande o formulário do evento específico
function openExpenseForm(eventId){
  try {
    const tabBtn = document.querySelector('.tab-btn[data-tab="despesas"]');
    if (tabBtn) tabBtn.click();
  } catch(_){}
  const id = String(eventId);
  // dá tempo da lista renderizar
  setTimeout(() => {
    const ensureCard = () => document.querySelector(`#despesas-events-list .custos-card[data-event-id="${CSS.escape(id)}"]`);
    let card = ensureCard();
    if (!card) {
      try { despesasRefresh(currentPeriod()); } catch(_){}
      setTimeout(() => {
        card = ensureCard();
        if (card) {
          card.open = true;
          const form = card.querySelector('form.expense-form');
          if (form) {
            form.style.display = 'block';
            try { (form.querySelector('input, textarea, select')||{}).focus?.(); } catch(_){ }
          }
          try { card.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(_){ }
        }
      }, 300);
      return;
    }
    // já existe
    card.open = true;
    const form = card.querySelector('form.expense-form');
    if (form) {
      form.style.display = 'block';
      try { (form.querySelector('input, textarea, select')||{}).focus?.(); } catch(_){ }
    }
    try { card.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(_){ }
  }, 120);
}

// Modal de confirmação após finalizar
function openFinalizePrompt(eventId){
  try{
    if (!elementos.finalizeModal) {
      // Fallback simples
      if (confirm('Quer lançar os gastos agora?')) openExpenseForm(eventId);
      return;
    }
    elementos.finalizeModal.classList.add('open');
    const close = ()=>{ try{ elementos.finalizeModal.classList.remove('open'); }catch(_){ } };
    elementos.finalizeClose?.addEventListener('click', close, { once:true });
    elementos.finalizeLater?.addEventListener('click', close, { once:true });
    elementos.finalizeLaunch?.addEventListener('click', ()=>{ close(); openExpenseForm(eventId); }, { once:true });
  }catch(_){ }
}

// Navega para o cartão do evento correspondente (Agenda/Historico/Pendentes)
function verEvento(eventId){
  try{
    const id = String(eventId);
    const gotoAndOpen = (el)=>{
      try{ el.scrollIntoView({ behavior:'smooth', block:'center' }); }catch(_){ }
      // abre <details> se existir
      try{ if (el.tagName === 'DETAILS') el.open = true; }catch(_){ }
    };

    // 1) Se existir nos Próximos Eventos (Agenda)
    let card = document.getElementById(`event-card-${CSS.escape(id)}`);
    if (card){
      // ativa aba Agenda
      const btn = document.querySelector('.tab-btn[data-tab="agenda"]');
      if (btn) btn.click();
      setTimeout(()=> gotoAndOpen(card), 100);
      return;
    }
    // 2) Pendentes de finalizar (Agenda)
    card = document.querySelector(`#pending-expenses-list .custos-card[data-pending-id="${CSS.escape(id)}"]`);
    if (card){
      const btn = document.querySelector('.tab-btn[data-tab="agenda"]');
      if (btn) btn.click();
      setTimeout(()=> gotoAndOpen(card), 120);
      return;
    }
    // 3) Histórico (Concluídos/Cancelados/Eliminados)
    const targets = [
      `#completed-card-${CSS.escape(id)}`,
      `#canceled-card-${CSS.escape(id)}`,
      `#deleted-card-${CSS.escape(id)}`
    ];
    for (const sel of targets){
      const el = document.querySelector(sel);
      if (el){
        const btn = document.querySelector('.tab-btn[data-tab="historico"]');
        if (btn) btn.click();
        setTimeout(()=> gotoAndOpen(el), 120);
        return;
      }
    }
    toast('Evento não encontrado nas listas atuais.');
  }catch(_){ toast('Não foi possível abrir o evento.'); }
}

/* =========================
   HISTÓRICO (Finalizados/Cancelados)
   ========================= */
async function finalizarEvento(eventId){
  try{
    const id = String(eventId);
    const ev = obterEventoPorId(id);
    if (!ev){ toast('Evento não encontrado no cache.'); return; }

    // Regras de multi-diárias: somente finaliza no último dia. Antes disso, registra progresso localmente.
    const totalDias = Math.max(1, parseInt(ev.dias_total,10)||1);
    if (totalDias > 1){
      const cur = getMultiProgressFor(id);
      if ((cur + 1) < totalDias){
        setMultiProgressFor(id, cur + 1);
        toast(`Dia ${cur+1}/${totalDias} concluído. Finalize no último dia.`);
        // Atualiza UIs que exibem rótulos
        try{ renderizarProximosEventos(); }catch(_){ }
        try{ renderizarPendentesDeFinalizar(); }catch(_){ }
        try{ atualizarEventosHoje(); }catch(_){ }
        return;
      }
      // No último dia: segue com a finalização normal
    }

    // Se já está finalizado, mantém comportamento de desfazer localmente
    if (eventosFinalizados.has(id)){
      eventosFinalizados.delete(id);
      salvarEventosFinalizados();
      atualizarEstatisticas(dadosSincronizados || {});
      renderizarProximosEventos();
      atualizarEventosHoje();
      return;
    }

    // Envia solicitação de finalização ao n8n e aguarda confirmação
    toast('Finalizando evento…');

    const s = getUserSession();
    const astronomo = (function(){
      const base = {};
      try{ if (s){ base.username=s.username; base.assistant_id=s.assistant_id; base.id_astronomo=s.id_astronomo; base.session_id=s.session_id; base.row_number=s.row_number; } }catch(_){ }
      try{ if (ev){ if (ev.astronomo) base.nome = ev.astronomo; if (ev.id_astronomo!=null) base.id_astronomo_evento = ev.id_astronomo; if (ev.responsavel_pelo_evento) base.responsavel_evento = ev.responsavel_pelo_evento; } }catch(_){ }
      return base;
    })();
    const eventoResumo = (function(){ const out={}; try{ for (const [k,v] of Object.entries(ev||{})){ out[k]=v; } }catch(_){ } return out; })();
    const dataIso = (function(){ try{ const d=parseDatePreserveUTC(ev.data_agendamento||ev.data_evento); if (!d||isNaN(d)) return undefined; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }catch(_){ return undefined; } })();

    const payload = {
      action: 'finalizar_eventos',
      tipo: 'finalizar_eventos',
      action_slug: 'finalizar_eventos',
      id_evento: id,
      // sinalizador de conclusão
      finalizado: 1,
      data_evento: dataIso,
      astronomo,
      evento: eventoResumo,
    };

    // GET com querystring (conforme arquitetura do webhook)
    let data = null;
    try{
      let url = withUserQuery(N8N_LANCAR_DESPESAS_URL);
      url = appendQueryParams(url, payload);
      if (isDebugEnabled()) console.log('[finalizar][GET] =>', url);
      const resp = await getWithTimeout(url, 20000);
      if (!resp || !resp.ok){ throw new Error('HTTP '+(resp && resp.status)); }
      const txt = await resp.text().catch(()=> '');
      if (txt && /^[\[{]/.test(txt.trim())){ try{ data = JSON.parse(txt); }catch(_){ data=null; } }
    }catch(err){
      console.warn('[finalizar] Erro HTTP ao enviar ao n8n (GET):', err);
      toast('Falha ao finalizar evento no n8n.');
      return;
    }

    const ok = (function(d){
      try{
        if (!d) return false;
        if (d.ok === true || d.success === true) return true;
        const status = String(d.status||'').toLowerCase();
        if (status==='ok' || status==='success' || status==='sucesso') return true;
        if (Array.isArray(d)){
          const arr = d.filter(x => x && x!=='null');
          if (!arr.length) return false;
          const idStr = String(id);
          const match = arr.find(it=>{
            try{
              const a = (it && (it.id_evento!=null ? String(it.id_evento) : (it.id!=null ? String(it.id) : '')));
              const b = (it && it.id_evento_unico!=null) ? String(it.id_evento_unico) : '';
              return a===idStr || b===idStr || !idStr;
            }catch(_){ return false; }
          });
          return !!(match || arr.length>0);
        }
        if ('error' in d || 'erro' in d) return false;
        return true;
      }catch(_){ return false; }
    })(data);

    if (!ok){
      const msg = (data && (data.message || data.error || data.erro)) || 'Resposta não esperada do n8n.';
      eventosErroAoFinalizar.add(id);
      toast(`Falha ao finalizar: ${msg}`);
      try{ renderizarProximosEventos(); }catch(_){ }
      return;
    }

    // Somente agora marcar como concluído localmente
    eventosFinalizados.add(id);
    try{ if (eventosErroAoFinalizar.has(id)) eventosErroAoFinalizar.delete(id); }catch(_){ }
    try{ if (totalDias>1){ setMultiProgressFor(id, totalDias); } }catch(_){ }
    salvarEventosFinalizados();
    atualizarEstatisticas(dadosSincronizados || {});
    renderizarProximosEventos();
    atualizarEventosHoje();
    toast('Evento finalizado com sucesso.');
    // Oferece atalho para lançar despesas agora
    openFinalizePrompt(id);
  }catch(e){ console.warn('finalizarEvento falhou', e); toast('Falha ao finalizar evento.'); }
}
function cancelarEvento(eventId){
  if(!eventId) return;
  eventosCancelados.add(eventId);
  salvarEventosCancelados();
  renderizarProximosEventos();
  renderizarHistorico();
  atualizarEstatisticas(dadosSincronizados || {});
}
function retomarEvento(eventId){
  if(!eventId) return;
  if(eventosFinalizados.has(eventId)){ eventosFinalizados.delete(eventId); salvarEventosFinalizados(); }
  if(eventosCancelados.has(eventId)){ eventosCancelados.delete(eventId); salvarEventosCancelados(); }
  if(eventosEliminados.has(eventId)){ eventosEliminados.delete(eventId); salvarEventosEliminados(); }
  renderizarProximosEventos(); renderizarHistorico(); atualizarEstatisticas(dadosSincronizados || {});
}
async function excluirEvento(eventId){
  try{
    if (!eventId) return;
    const ev = obterEventoPorId(String(eventId));
    if (!ev){ toast('Evento não encontrado no cache.'); return; }
    if (!confirm('Confirma excluir este evento? Esta ação remove no servidor e mantém registro no histórico como Eliminado.')) return;

    const s = getUserSession();
    const astronomo = (function(){
      const base = {};
      try{ if (s){ base.username=s.username; base.assistant_id=s.assistant_id; base.id_astronomo=s.id_astronomo; base.session_id=s.session_id; base.row_number=s.row_number; } }catch(_){ }
      try{ if (ev){ if (ev.astronomo) base.nome = ev.astronomo; if (ev.id_astronomo!=null) base.id_astronomo_evento = ev.id_astronomo; if (ev.responsavel_pelo_evento) base.responsavel_evento = ev.responsavel_pelo_evento; } }catch(_){ }
      return base;
    })();
    const eventoResumo = (function(){ const out={}; try{ for (const [k,v] of Object.entries(ev||{})){ out[k]=v; } }catch(_){ } return out; })();
    const dataIso = (function(){ try{ const d=parseDatePreserveUTC(ev.data_agendamento||ev.data_evento); if (!d||isNaN(d)) return undefined; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }catch(_){ return undefined; } })();

    const payload = {
      action:'delete_evento', tipo:'delete_evento',
      id_evento: String(ev.id_evento || ev.id || eventId),
      id: String(ev.id || ev.id_evento || eventId),
      nome_da_escola: ev.nome_da_escola || ev.escola || undefined,
      cidade: ev.cidade || undefined,
      data_evento: dataIso || ev.data_agendamento || undefined,
      evento: eventoResumo,
      astronomo,
      ...(s||{})
    };

    // Envia GET para os possíveis endpoints do webhook de agenda
    let ok=false, lastErr=null;
    const isLocalDev = (function(){ try{ return location.protocol==='file:' || /^(127\.0\.0\.1|localhost)(:|$)/i.test(location.host); }catch(_){ return false; }})();
    const isNgrok = (function(){ try{ return /ngrok/i.test(location.hostname||''); }catch(_){ return false; }})();
    let candidates = N8N_WEBHOOK_URLS.slice();
    if (isNgrok){ candidates = N8N_WEBHOOK_URLS.filter(u => /^https?:\/\//i.test(u)); }
    else if (isLocalDev){ candidates = N8N_WEBHOOK_URLS.filter(u => !u.startsWith('/')); }
    for (const base of candidates){
      try{
        const u = new URL(withUserQuery(base), window.location.origin);
        u.searchParams.set('action','delete_evento');
        u.searchParams.set('tipo',  'delete_evento');
        u.searchParams.set('id_evento', String(ev.id_evento || ev.id || eventId));
        u.searchParams.set('id', String(ev.id || ev.id_evento || eventId));
        if (ev.nome_da_escola) u.searchParams.set('nome_da_escola', ev.nome_da_escola);
        if (ev.cidade) u.searchParams.set('cidade', ev.cidade);
        const de = (function(){ try{ const d=parseDatePreserveUTC(ev.data_agendamento||ev.data_evento); if(!d||isNaN(d))return null; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}catch(_){return null;} })();
        if (de) u.searchParams.set('data_evento', de);
        try{ u.searchParams.set('evento', encodeURIComponent(JSON.stringify(eventoResumo))); }catch(_){ }
        u.searchParams.set('ts', String(Date.now()));
        await getFireAndForget(u.toString(), 10000);
        ok=true; break;
      }catch(e){ lastErr = e; }
    }
    if (!ok) console.warn('Falha ao notificar exclusão ao n8n (GET):', lastErr);

    // Marca localmente como eliminado e atualiza visões
    eventosEliminados.add(String(eventId));
    salvarEventosEliminados();
    renderizarProximosEventos();
    renderizarHistorico();
    atualizarEstatisticas(dadosSincronizados || {});
    atualizarEventosHoje();
    toast(ok? 'Evento eliminado e enviado ao n8n.': 'Evento eliminado localmente. (Falha ao notificar n8n)');
  }catch(e){ console.warn('excluirEvento falhou', e); toast('Falha ao excluir evento.'); }
}
function renderizarHistorico(){
  try{
    if (elementos.completedList){
      const reaisMap = loadDespesasReais();
      const itens = eventosEnriquecidos.filter(ev=>eventosFinalizados.has(ev.id)).map(ev=>{
        const d = parseDatePreserveUTC(ev.data_agendamento);
        const fb = extrairFeedback(ev);
        const r = reaisMap[String(ev.id)] || null;
        const temReais = !!(r && (
          parseNum(r.combustivel_real) || parseNum(r.hospedagem_real) || parseNum(r.alimentacao_real) ||
          parseNum(r.monitor_real) || parseNum(r.pedagios_real) || parseNum(r.outros)
        ));
        const statusBadge = temReais
          ? '<span class="chip status-lancado"><i class="fas fa-check"></i> Lançado</span>'
          : '<span class="chip status-pendente"><i class="fas fa-hourglass-half"></i> Pendente de lançar</span>';
        return `
          <div class="upcoming-event-card" id="completed-card-${ev.id}" data-event-id="${ev.id}">
            <div class="upcoming-event-header">
              <div class="event-main-info">
                <div class="event-icon"><i class="fas fa-check"></i></div>
                <div class="event-basic-info">
                  <h3>${ev.nome_da_escola || sanitizeCityName(ev.cidade) || 'Evento'} <small class="chip small"><i class="fas fa-hashtag"></i> ${ev.id}</small> ${statusBadge}</h3>
                  <p>${isNaN(d)?'-':d.toLocaleDateString('pt-BR')} • ${sanitizeCityName(ev.cidade || '')}</p>
                </div>
              </div>
              <div class="event-date-block">
                <button class="btn btn-secondary" onclick="retomarEvento('${ev.id}')"><i class="fas fa-undo"></i> Retomar</button>
              </div>
            </div>
            <div class="event-extra" style="padding:10px 12px; border-top:1px dashed var(--glass-border);">
              <div class="cost-line"><span>Valor</span><span>${BRL(parseNum(ev.valor_total))}</span></div>
              <div class="cost-line"><span>Turno</span><span>${ev.turno || '-'}</span></div>
              <div class="cost-line cost-line--wrap"><span>Responsável</span><span>${ev.responsavel_pelo_evento || '-'}</span></div>
            </div>
            ${fb ? `
            <div class="event-feedback" style="padding:10px 12px; border-top:1px dashed var(--glass-border);">
              <h4 style="margin:0 0 6px 0; display:flex; align-items:center; gap:6px;"><i class="fas fa-comment-dots"></i> Feedback do Evento</h4>
              <div class="cost-line"><span>Nota</span><span>${fb.nota!=null? String(fb.nota): '-'}</span></div>
              <div class="cost-line cost-line--wrap"><span>Comentário</span><span>${fb.comentario || '-'}</span></div>
              <div class="cost-line"><span>Responsável</span><span>${fb.quem || (ev.responsavel_pelo_evento||'-')}</span></div>
              ${fb.quando? `<div class=\"cost-line\"><span>Data</span><span>${fb.quando}</span></div>`:''}
            </div>`: ''}
          </div>`;
      });
      elementos.completedList.innerHTML = itens.join('') || '<div class="empty-state"><i class="fas fa-box-open"></i><p>Nenhum evento concluído.</p></div>';
    }
    if (elementos.canceledList){
      const itens = eventosEnriquecidos.filter(ev=>eventosCancelados.has(ev.id)).map(ev=>{
        const d = parseDatePreserveUTC(ev.data_agendamento);
        return `
          <div class="upcoming-event-card" id="canceled-card-${ev.id}" data-event-id="${ev.id}">
            <div class="upcoming-event-header">
              <div class="event-main-info">
                <div class="event-icon"><i class="fas fa-ban"></i></div>
                <div class="event-basic-info">
                  <h3>${ev.nome_da_escola || sanitizeCityName(ev.cidade) || 'Evento'} <small class="chip small"><i class="fas fa-hashtag"></i> ${ev.id}</small></h3>
                  <p>${isNaN(d)?'-':d.toLocaleDateString('pt-BR')} • ${sanitizeCityName(ev.cidade || '')}</p>
                </div>
              </div>
              <div class="event-date-block">
                <button class="btn btn-secondary" onclick="retomarEvento('${ev.id}')"><i class="fas fa-undo"></i> Retomar</button>
              </div>
            </div>
          </div>`;
      });
      elementos.canceledList.innerHTML = itens.join('') || '<div class="empty-state"><i class="fas fa-box-open"></i><p>Nenhum evento cancelado.</p></div>';
    }
    if (elementos.deletedList){
      const itens = eventosEnriquecidos.filter(ev=>eventosEliminados.has(ev.id)).map(ev=>{
        const d = parseDatePreserveUTC(ev.data_agendamento);
        return `
          <div class=\"upcoming-event-card\" id=\"deleted-card-${ev.id}\" data-event-id=\"${ev.id}\">
            <div class=\"upcoming-event-header\">
              <div class=\"event-main-info\">
                <div class=\"event-icon\"><i class=\"fas fa-trash\"></i></div>
                <div class=\"event-basic-info\">
                  <h3>${ev.nome_da_escola || sanitizeCityName(ev.cidade) || 'Evento'} <small class=\"chip small\"><i class=\"fas fa-hashtag\"></i> ${ev.id}</small></h3>
                  <p>${isNaN(d)?'-':d.toLocaleDateString('pt-BR')} • ${sanitizeCityName(ev.cidade || '')}</p>
                </div>
              </div>
              <div class=\"event-date-block\">
                <button class=\"btn btn-secondary\" onclick=\"retomarEvento('${ev.id}')\"><i class=\"fas fa-undo\"></i> Restaurar</button>
              </div>
            </div>
          </div>`;
      });
      elementos.deletedList.innerHTML = itens.join('') || '<div class="empty-state"><i class="fas fa-box-open"></i><p>Nenhum evento eliminado.</p></div>';
    }
  }catch(e){ console.warn('Falha ao renderizar histórico', e); }
}

function renderizarFeedbacks(){
  const host = elementos.feedbacksList; if (!host) return;
  const base = Array.isArray(feedbackResults) ? feedbackResults : [];
  const itemsEventos = base.map(ev=>{
    try{
    const d = parseDatePreserveUTC(ev.data_agendamento);
    const fb = extrairFeedback(ev) || { comentario: String(ev.avaliacao_astronomo||'').trim() };
    const cidade = sanitizeCityName(ev.cidade||'');
    const status = (function(){
      const id = String(ev.id);
      if (eventosEliminados && eventosEliminados.has(id)) return 'Eliminado';
      if (eventosCancelados && eventosCancelados.has(id)) return 'Cancelado';
      if (eventosFinalizados && eventosFinalizados.has(id)) return 'Concluído';
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      const dd = d ? new Date(d.getTime()) : null; if (dd) dd.setHours(0,0,0,0);
      if (dd && dd >= hoje) return 'Pendente';
      return 'Evento';
    })();

    const notaChip = (fb && fb.nota!=null)
      ? `<span class=\"chip\"><i class=\"fas fa-star\"></i> Nota ${String(fb.nota)}</span>`
      : '';

    return `
      <div class="upcoming-event-card" data-feedback-id="${ev.id}">
        <div class="upcoming-event-header">
          <div class="event-main-info">
            <div class="event-icon"><i class="fas fa-comments"></i></div>
            <div class="event-basic-info">
              <h3>${ev.nome_da_escola || cidade || 'Evento'} <small class="chip small"><i class="fas fa-hashtag"></i> ${ev.id}</small> <span class=\"chip\">${status}</span> ${notaChip}</h3>
              <p>${isNaN(d)?'-':d.toLocaleDateString('pt-BR')} • ${cidade}</p>
            </div>
          </div>
          <div class="event-date-block">
            <button class="btn btn-secondary" onclick="verEvento('${ev.id}')"><i class="fas fa-eye"></i> Ver evento</button>
          </div>
        </div>
        <div class="event-feedback" style="padding:10px 12px; border-top:1px dashed var(--glass-border); display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
          <div class="cost-box" style="margin:0;">
            <h4><i class="fas fa-comment-dots"></i> Feedback</h4>
            <div class="cost-line"><span>Nota</span><span>${fb && fb.nota!=null ? String(fb.nota) : '-'}</span></div>
            <div class="cost-line cost-line--wrap"><span>Comentário</span><span>${(fb && fb.comentario) || '-'}</span></div>
            <div class="cost-line"><span>Responsável</span><span>${(fb && fb.quem) || (ev.responsavel_pelo_evento||'-')}</span></div>
            ${fb && fb.quando ? `<div class=\"cost-line\"><span>Data</span><span>${fb.quando}</span></div>` : ''}
          </div>
          <div class="cost-box" style="margin:0;">
            <h4><i class="fas fa-clipboard-list"></i> Evento</h4>
            <div class="cost-line"><span>Data</span><span>${isNaN(d)?'-':d.toLocaleDateString('pt-BR')}</span></div>
            <div class="cost-line cost-line--wrap"><span>Escola</span><span>${ev.nome_da_escola || '-'}</span></div>
            <div class="cost-line"><span>Turno</span><span>${ev.turno || '-'}</span></div>
            <div class="cost-line"><span>Valor</span><span>${BRL(parseNum(ev.valor_total))}</span></div>
          </div>
        </div>
      </div>`;
    }catch(_){
      return `<div class=\"upcoming-event-card\"><div class=\"event-basic-info\"><h3>Feedback</h3><p>Não foi possível renderizar este item.</p></div></div>`;
    }
  });
  const all = itemsEventos;
  host.innerHTML = all.join('') || '<div class="empty-state"><i class="fas fa-inbox"></i><p>Nenhum feedback recebido.</p></div>';
}

// Executa o webhook com action=feedback (POST) e atualiza a lista de feedbacks
async function carregarFeedbacksWebhook(){
  if (carregandoFeedbacks) return;
  carregandoFeedbacks = true;
  try {
    try {
      const host = elementos.feedbacksList;
      if (host){ host.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando feedbacks…</p></div>'; }
    } catch(_){ }

    const candidates = [N8N_FEEDBACK_URL].filter(Boolean);
    let dataOk = null; let lastErr = null;
    for (const base of candidates){
      try{
        let url = withUserQuery(base);
        try{
          const u = new URL(url);
          u.searchParams.set('action','feedback');
          u.searchParams.set('tipo','feedback');
          if (!u.searchParams.get('id_astronomo')){
            const fid = fallbackAstronomoId(); if (fid) u.searchParams.set('id_astronomo', fid);
          }
          if (!u.searchParams.get('user_id')){
            const fid = fallbackAstronomoId(); if (fid) u.searchParams.set('user_id', fid);
          }
          url = u.toString();
        }catch(_){ }
        const resp = await postExpectJson(url, undefined, 20000);
        if (resp!=null){ dataOk = resp; break; }
        lastErr = new Error('Resposta vazia');
      }catch(e){ lastErr = e; }
    }
    if (!dataOk){
      try{
        const host = elementos.feedbacksList;
        if (host){ host.innerHTML = '<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Não foi possível carregar os feedbacks agora.</p></div>'; }
      }catch(_){ }
      return false;
    }

    // Normaliza estrutura recebida: array direto ou objeto contendo eventos/lista
    const normalized = prepararDadosParaProcessamento(dataOk);
    const lista = (function(x){
      try{
        if (Array.isArray(x)) return x;
        if (x && Array.isArray(x.eventos)) return x.eventos;
        const keys = ['items','data','records','rows','list','result','payload','response'];
        for (const k of keys){ if (Array.isArray(x && x[k])) return x[k]; }
      }catch(_){ }
      return [];
    })(normalized);

    // Normaliza para nosso modelo de evento (para usar extrairFeedback/formatadores existentes)
    feedbackResults = (lista||[]).map((ev,i)=> normalizarEvento(ev,i));
    try{ if (isDebugEnabled()) window.__DEBUG_LAST_FEEDBACKS = feedbackResults.slice(); }catch(_){ }
    renderizarFeedbacks();
    return true;
  } catch(e) {
    try{
      const host = elementos.feedbacksList;
      if (host){ host.innerHTML = '<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Erro ao carregar feedbacks.</p></div>'; }
    }catch(_){ }
    return false;
  } finally {
    carregandoFeedbacks = false;
  }
}

function contarPendentesDeFinalizar(){
  try{
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const reaisMap = loadDespesasReais();
    const pendentes = (eventosEnriquecidos||[]).filter(ev=>{
      const d = parseDatePreserveUTC(ev.data_agendamento); if (!d) return false; d.setHours(0,0,0,0);
      if (d >= hoje) return false;
      const id = String(ev.id);
      const temReal = !!(reaisMap && Object.prototype.hasOwnProperty.call(reaisMap, id));
      return !temReal && !eventosFinalizados.has(id) && !eventosCancelados.has(id) && !eventosEliminados.has(id);
    });
    return pendentes.length;
  }catch(_){ return 0; }
}

function extrairFeedback(ev){
  try{
    const nota = (function(){
      try{
        const n = parseNum(ev.avaliacao_nota || ev.nota || ev.rating || ev.satisfacao);
        return Number.isFinite(n) && n>0 ? n : null;
      }catch(_){ return null; }
    })();
    // Comentário pode vir em várias chaves; incluir avaliacao_astronomo
    let comentario = (ev.avaliacao_comentario || ev.avaliacao_astronomo || ev.feedback || ev.feedback_responsavel || ev.comentario_feedback || ev.feedback_texto || '').toString().trim() || null;
    if (comentario){
      const s = comentario.toLowerCase();
      if (s==='null' || s==='não avaliou' || s==='nao avaliou' || s==='sem avaliacao' || s==='sem avaliação' || s==='-') comentario = null;
    }
    const quem = (ev.feedback_responsavel_nome || ev.responsavel_pelo_evento || '').toString().trim() || null;
    const quando = (ev.feedback_data || ev.data_feedback || '').toString().trim() || null;
    if (nota!=null || comentario) return { nota, comentario, quem, quando };
    return null;
  }catch(_){ return null; }
}
function obterEventoPorId(id){ return eventosEnriquecidos.find(e=>e.id===id); }
// Formata data preservando o dia (evita adiantar/atrasar por fuso)
function formatarData(s){
  const d = parseDatePreserveUTC(s);
  if (!d || Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}
function abrirWhatsApp(telefone, escola){
  if (!telefone || telefone==='Não informado'){ alert('Número de telefone não disponível'); return; }
  const url = `https://wa.me/${String(telefone).replace(/\D/g,'')}?text=${encodeURIComponent(`Olá! Gostaria de conversar sobre o evento na ${escola}.`)}`;
  window.open(url, '_blank');
}
try{ window.verEvento = verEvento; }catch(_){ }
function verDetalhesCompletos(eventId){
  const ev = obterEventoPorId(eventId); if (!ev) { alert('Não foi possível localizar este evento.'); return; }
  const det = [
    `ID: ${ev.id}`,
    `Evento: ${ev.tarefa||'Não informado'}`,
    `Local: ${ev.nome_da_escola||'Não informado'}`,
    `Cidade: ${ev.cidade||'Não informado'}`,
    `Data: ${ev.data_agendamento? formatarData(ev.data_agendamento):'Não informado'}`,
    `Valor: ${BRL(parseNum(ev.valor_total))}`,
    `Responsável: ${ev.responsavel_pelo_evento||'Não informado'}`,
    `Telefone: ${ev.contato_responsavel||'Não informado'}`,
  ].join('\n');
  alert(det);
}

/* =========================
   PREVISÃO DO TEMPO (Open-Meteo)
   ========================= */
const DEFAULT_WEATHER_COORDS = { lat: -25.417713, lng: -49.154683 };
let lastWeatherKeyPair = null; // cache para pares curr|dest
let rotaDoDia = null; // resumo de rota (n8n)
let rotaDoDiaMapsLink = null; // link Google Maps preferencial

function saveLocationLabel(label){ try{ localStorage.setItem(keyFor('location_label'), String(label||'')); }catch(_){ } }
function loadLocationLabel(){ try{ return localStorage.getItem(keyFor('location_label')) || ''; }catch(_){ return ''; } }
function updateLocationLabelUI(label){
  try{
    const btn = elementos.sendLocationBtn;
    const span = elementos.currentLocationLabel;
    const text = String(label||'').trim();
    if (span) span.textContent = text ? `: ${text}` : '';
    else if (btn){ btn.innerHTML = `<i class="fas fa-location-dot"></i> Estou em${text?': '+text:''}`; }
    saveLocationLabel(text);
  }catch(_){ }
}

function getTodayIsoDate(){ const d=new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function pickWeatherPairs(){
  const curr = userLocation ? { lat:userLocation.lat, lng:userLocation.lng } : null;
  const dest = (proximoEventoAtual && proximoEventoAtual.coordenadas)
    ? { lat: proximoEventoAtual.coordenadas.lat, lng: proximoEventoAtual.coordenadas.lng }
    : null;
  return { curr: curr || { ...DEFAULT_WEATHER_COORDS }, dest };
}
// Extrai rótulo de cidade/UF de respostas variadas do n8n
function ufNomeParaSigla(estado){
  try{
    if (!estado) return '';
    const e = String(estado).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const map = {
      'acre':'AC','alagoas':'AL','amapa':'AP','amazonas':'AM','bahia':'BA','ceara':'CE','distrito federal':'DF','espirito santo':'ES','goias':'GO','maranhao':'MA','mato grosso':'MT','mato grosso do sul':'MS','minas gerais':'MG','para':'PA','paraiba':'PB','parana':'PR','pernambuco':'PE','piaui':'PI','rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS','rondonia':'RO','roraima':'RR','santa catarina':'SC','sao paulo':'SP','sergipe':'SE','tocantins':'TO'
    };
    return map[e] || (e.length===2 ? estado.toUpperCase() : '');
  }catch(_){ return ''; }
}

function extractCityLabelFromResponse(data){
  try{
    // Nova estrutura esperada (array com { origem:{cidade,estado}, destino:{cidade,estado} })
    if (Array.isArray(data) && data.length){
      const item = data[0] || {};
      if (item.origem && (item.origem.cidade || item.origem.estado)){
        const cidade = sanitizeCityName(item.origem.cidade || '');
        const uf = ufNomeParaSigla(item.origem.estado || '') || (item.origem.estado || '').toString();
        if (cidade && uf) return `${cidade} - ${uf}`;
        if (cidade) return cidade;
      }
      if (item.destino && (item.destino.cidade || item.destino.estado)){
        const cidade = sanitizeCityName(item.destino.cidade || '');
        const uf = ufNomeParaSigla(item.destino.estado || '') || (item.destino.estado || '').toString();
        if (cidade && uf) return `${cidade} - ${uf}`;
        if (cidade) return cidade;
      }
    }

    const pick = (o,k)=>{ try{ return o && o[k]!=null ? String(o[k]).trim() : ''; }catch(_){ return ''; } };
    const source = Array.isArray(data) ? (data[0]||{}) : (Array.isArray(data?.data) ? (data.data[0]||{}) : (data||{}));
    const reverse = source.reverse || source.current || source.location || source.meta || {};
    const addr = reverse.address || {};
    const directCity = [
      pick(source,'current_city'), pick(source,'cidade'), pick(source,'city'), pick(source,'cidade_atual'), pick(source,'local_atual'), pick(source,'place_name'), pick(source,'local'), pick(source,'nome'), pick(source,'name')
    ].find(Boolean) || '';
    const reverseCity = [ pick(reverse,'cidade'), pick(reverse,'city'), pick(reverse,'current_city') ].find(Boolean) || '';
    const addrCity = [ pick(addr,'city'), pick(addr,'town'), pick(addr,'village'), pick(addr,'municipality'), pick(addr,'city_district') ].find(Boolean) || '';
    const city = (directCity || reverseCity || addrCity || '').trim();
    const uf = [ pick(source,'uf'), pick(source,'estado'), pick(source,'state_code'), pick(reverse,'uf'), pick(addr,'state_code'), pick(addr,'state'), pick(addr,'region_code') ].find(Boolean) || '';
    if (city && uf) return `${sanitizeCityName(city)} - ${uf}`;
    if (city) return sanitizeCityName(city);
    // Busca recursiva por qualquer chave que sugira cidade/UF
    const cityLike = /(city|cidade|municipio|localidade|place|nome|name|town|village)$/i;
    const ufLike   = /^(uf|estado|state|state_code|sigla_uf)$/i;
    let foundCity='', foundUf='';
    (function walk(obj){
      if (!obj || typeof obj!=='object') return;
      for (const [k,v] of Object.entries(obj)){
        if (typeof v==='string'){
          if (!foundCity && cityLike.test(k)) foundCity = v.trim();
          if (!foundUf && ufLike.test(k)) foundUf = v.trim();
        } else if (v && typeof v==='object') walk(v);
        if (foundCity && foundUf) break;
      }
    })(source);
    if (foundCity && foundUf) return `${sanitizeCityName(foundCity)} - ${foundUf}`;
    if (foundCity) return sanitizeCityName(foundCity);
    return '';
  }catch(_){ return ''; }
}
async function fetchWeatherForecast(lat,lng){
  const params = new URLSearchParams({ latitude:String(lat), longitude:String(lng), daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_mean', timezone:'auto' });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const resp = await fetch(url, { method:'GET' });
  if (!resp.ok) throw new Error(`Open-Meteo falhou: ${resp.status}`);
  return resp.json();
}
function iconForPrecip(prob){ if(prob==null) return {icon:'fa-question-circle',label:'Indisponível'}; if(prob>=50) return {icon:'fa-cloud-showers-heavy',label:'Chuva'}; if(prob>=20) return {icon:'fa-cloud-sun',label:'Parcial'}; return {icon:'fa-sun',label:'Sol'}; }
function renderWeather(data){
  if (!data || !data.daily || !Array.isArray(data.daily.time)){
    if (elementos.weatherToday) elementos.weatherToday.innerHTML = '<div class="meta">Clima indisponível</div>';
    if (elementos.weatherNext) elementos.weatherNext.innerHTML = '';
    return;
  }
  const daily=data.daily, time=daily.time||[], tmax=daily.temperature_2m_max||[], tmin=daily.temperature_2m_min||[], pprob=daily.precipitation_probability_mean||[];
  const todayStr = getTodayIsoDate(); const idx = time.indexOf(todayStr); const i0 = idx>=0? idx:0;
  if (elementos.weatherToday){
    const prob = pprob[i0]!=null? Number(pprob[i0]):null;
    const max  = tmax[i0]!=null? Math.round(tmax[i0]):null;
    const min  = tmin[i0]!=null? Math.round(tmin[i0]):null;
    const meta = []; if (max!=null&&min!=null) meta.push(`${min}° / ${max}°`); if (prob!=null) meta.push(`${prob}% precip.`);
    const {icon,label} = iconForPrecip(prob);
    elementos.weatherToday.innerHTML = `<div class="icon"><i class="fas ${icon}"></i></div><div><div class="label">${label} hoje</div><div class="meta">${meta.join(' · ')||'Sem dados'}</div></div>`;
  }
  if (elementos.weatherNext){
    const chips = [];
    for (let k=i0+1; k<Math.min(time.length, i0+4); k++){
      const d=new Date(time[k]); const weekday=d.toLocaleDateString('pt-BR',{weekday:'short'});
      const prob = pprob[k]!=null? Number(pprob[k]):null; const {icon}=iconForPrecip(prob);
      chips.push(`<div class="weather-chip"><i class="fas ${icon} w-icon"></i><span>${weekday}</span><span>${prob!=null? prob+'%':'-'}</span></div>`);
    }
    elementos.weatherNext.innerHTML = chips.join('');
  }
}
function renderWeatherToEl(el, data, titulo){
  try{
    if (!el) return;
    if (!data || !data.daily || !Array.isArray(data.daily.time)){
      el.innerHTML = '<div class="meta">Clima indisponível</div>';
      return;
    }
    const daily=data.daily, time=daily.time||[], tmax=daily.temperature_2m_max||[], tmin=daily.temperature_2m_min||[], pprob=daily.precipitation_probability_mean||[];
    const todayStr = getTodayIsoDate(); const idx = time.indexOf(todayStr); const i0 = idx>=0? idx:0;
    const prob = pprob[i0]!=null? Number(pprob[i0]):null;
    const max  = tmax[i0]!=null? Math.round(tmax[i0]):null;
    const min  = tmin[i0]!=null? Math.round(tmin[i0]):null;
    const meta = []; if (max!=null&&min!=null) meta.push(`${min}° / ${max}°`); if (prob!=null) meta.push(`${prob}% precip.`);
    const {icon,label} = iconForPrecip(prob);
    el.innerHTML = `<div class="icon"><i class="fas ${icon}"></i></div><div><div class="label">${titulo||label}</div><div class="meta">${meta.join(' · ')||'Sem dados'}</div></div>`;
  }catch(_){}
}
async function initWeather(){
  try{
    const { curr, dest } = pickWeatherPairs();
    const key = `${Number(curr.lat).toFixed(3)},${Number(curr.lng).toFixed(3)}|${dest?Number(dest.lat).toFixed(3):'x'},${dest?Number(dest.lng).toFixed(3):'x'}`;
    if (key===lastWeatherKeyPair) return; lastWeatherKeyPair = key;
    const p1 = fetchWeatherForecast(curr.lat, curr.lng);
    const p2 = dest ? fetchWeatherForecast(dest.lat, dest.lng) : Promise.resolve(null);
    const [wCurr, wDest] = await Promise.all([p1, p2]);
    // títulos baseados no próximo evento (origem/destino)
    const origemNome = (function(){
      try{
        const label = loadLocationLabel();
        if (label) return String(label);
        const ev = proximoEventoAtual || null;
        const s = sanitizeCityName(ev?.cidade_origem || ev?.origem || ev?.origem_cidade || ev?.cidade || 'Atual');
        return s || 'Atual';
      }catch(_){ return 'Atual'; }
    })();
    const destinoNome = (function(){
      try{
        const ev = proximoEventoAtual || null;
        const s = sanitizeCityName(ev?.cidade_destino || ev?.cidade || ev?.destino || 'Destino');
        return s || 'Destino';
      }catch(_){ return 'Destino'; }
    })();
    renderWeatherToEl(elementos.weatherToday, wCurr, origemNome);
    if (elementos.weatherDestination){
      if (wDest) renderWeatherToEl(elementos.weatherDestination, wDest, destinoNome);
      else elementos.weatherDestination.innerHTML = '<div class="meta">Destino sem coordenadas</div>';
    }
    // chips próximos dias (usa destino se disponível, senão atual)
    if (elementos.weatherNext){
      const base = wDest || wCurr;
      if (!base || !base.daily){ elementos.weatherNext.innerHTML = ''; }
      else {
        const daily=base.daily, time=daily.time||[], pprob=daily.precipitation_probability_mean||[];
        const chips=[]; const todayStr=getTodayIsoDate(); const idx=time.indexOf(todayStr); const i0=idx>=0?idx:0;
        for (let k=i0+1; k<Math.min(time.length, i0+4); k++){
          const d=new Date(time[k]); const weekday=d.toLocaleDateString('pt-BR',{weekday:'short'});
          const prob = pprob[k]!=null? Number(pprob[k]):null; const {icon}=iconForPrecip(prob);
          chips.push(`<div class=\"weather-chip\"><i class=\"fas ${icon} w-icon\"></i><span>${weekday}</span><span>${prob!=null? prob+'%':'-'}</span></div>`);
        }
        elementos.weatherNext.innerHTML = chips.join('');
      }
    }
  } catch(e){
    console.warn('Clima indisponível:', e);
    if (elementos.weatherToday) elementos.weatherToday.innerHTML = '<div class="meta">Clima indisponível</div>';
    if (elementos.weatherDestination) elementos.weatherDestination.innerHTML = '<div class="meta">-</div>';
    if (elementos.weatherNext) elementos.weatherNext.innerHTML = '';
  }
}

/* =========================
   CACHE LOCAL NA INICIALIZAÇÃO
   ========================= */
function carregarAgendaDeCacheOuExemplo(){
  try{
    const cached = carregarCacheEventos();
    const arr = cached && Array.isArray(cached.events) ? cached.events : (Array.isArray(cached) ? cached : []);
    if (arr.length){
      eventosEnriquecidos = arr.map((e,i)=> normalizarEvento(e,i)).filter(dentroDaJanelaDeCache).filter(e => !isEventoExemplo(e));
      dadosSincronizados = {
        astronomo: (window.currentUser && window.currentUser.username) || 'Astrônomo',
        eventos: eventosEnriquecidos,
        total_eventos: eventosEnriquecidos.length,
        faturamento_total: eventosEnriquecidos.reduce((t,ev)=> t+(parseNum(ev.valor_total)||0), 0),
        rota_otimizada: calcularRotaOtimizada(eventosEnriquecidos)
      };
      atualizarEstatisticas(dadosSincronizados);
      try{ atualizarRotas(rotaDoDia || dadosSincronizados.rota_otimizada); }catch(_){ }
      renderizarProximosEventos();

      document.dispatchEvent(new CustomEvent('eventsUpdated', { detail: { events: eventosEnriquecidos.filter(ev => !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id)) } }));
      try{ despesasRefresh(currentPeriod()); }catch(_){ }
      try{ salvarCacheEventos(); }catch(_){ }
      return;
    }
  } catch(e){ console.warn('Falha ao carregar cache de eventos.', e); }
  // Sem cache: mantém vazio até sincronizar com o n8n
}

/* =========================
   DESPESAS (Estimadas + Reais) — INTEGRADO
   ========================= */
// LocalStorage keys (despesas)
const LS_KEY_REAIS  = 'despesas_reais_v1';   // namespace por usuário via keyFor()
const LS_KEY_MEDIAS = 'despesas_medias_v1';  // namespace por usuário via keyFor()

// Migração simples: se existirem chaves antigas sem namespace, copia para a chave namespaced
function migrateDespesasStorage(){
  try{
    const nsReais = keyFor(LS_KEY_REAIS); const nsMedias = keyFor(LS_KEY_MEDIAS);
    if (!localStorage.getItem(nsReais) && localStorage.getItem(LS_KEY_REAIS)){
      localStorage.setItem(nsReais, localStorage.getItem(LS_KEY_REAIS));
    }
    if (!localStorage.getItem(nsMedias) && localStorage.getItem(LS_KEY_MEDIAS)){
      localStorage.setItem(nsMedias, localStorage.getItem(LS_KEY_MEDIAS));
    }
  }catch(_){ }
}

function loadDespesasReais(){ try{ return JSON.parse(localStorage.getItem(keyFor(LS_KEY_REAIS))||'{}')||{}; }catch(_){ return {}; } }
function saveDespesasReais(map){ try{ localStorage.setItem(keyFor(LS_KEY_REAIS), JSON.stringify(map||{})); }catch(_){ } }
function loadMedias(){
  try{
    const def = { combustivel:0, hospedagem:0, alimentacao:0, monitor:0, pedagios:0, valor_litro:0, consumo_km_l:0 };
    const m = JSON.parse(localStorage.getItem(keyFor(LS_KEY_MEDIAS))||'null');
    return m && typeof m==='object' ? Object.assign(def, m) : def;
  } catch(_){ return { combustivel:0, hospedagem:0, alimentacao:0, monitor:0, pedagios:0 }; }
}
function saveMedias(m){ try{ localStorage.setItem(keyFor(LS_KEY_MEDIAS), JSON.stringify(m||{})); }catch(_){ } }

// Metadados e cálculo do combustível: (dist/consumo)*valor_litro
function calcCombustivelMeta(ev){
  try{
    // Distância preferida: APENAS para o próximo evento usa a localização atual como origem; demais usam base/evento
    let dist = NaN;
    try{
      const isNext = !!(proximoEventoAtual && String(proximoEventoAtual.id) === String(ev && ev.id));
      if (isNext && userLocation && ev && ev.coordenadas && typeof ev.coordenadas.lat==='number' && typeof ev.coordenadas.lng==='number'){
        const d = calcularDistanciaKm(userLocation, ev.coordenadas);
        if (Number.isFinite(d)) dist = Number(d.toFixed(1));
      }
    }catch(_){ }
    if (!Number.isFinite(dist) || !(dist>0)){
      dist = parseNum(ev && (ev.distancia_km || ev.km || ev.km_total || ev.distancia_prevista || ev.rota_distancia_km));
    }

    if (dist > 0){
      const sess = getUserSession();
      const medias = loadMedias();
      // Consumo: preferir média global; aceitar tanto km/L quanto L/km do evento se não houver média
      let consumoKmPorLitro = parseNum(medias && medias.consumo_km_l);
      if (!(consumoKmPorLitro>0)){
        consumoKmPorLitro = parseNum(ev && (ev.km_por_litro || ev.consumo_km_por_litro || ev.consumo_km_l || ev.km_per_liter));
        const litrosPorKm = parseNum(ev && (ev.litros_por_km || ev.consumo_litros_por_km || ev.l_por_km));
        if (!(consumoKmPorLitro>0) && litrosPorKm>0){ consumoKmPorLitro = 1 / litrosPorKm; }
      }
      if (!(consumoKmPorLitro>0)) consumoKmPorLitro = parseNum(sess && sess.profile && (sess.profile.consumo_km_l || sess.profile.km_por_litro));

      // Preço do litro: preferir média global; senão evento; senão perfil
      let precoLitro = parseNum(medias && (medias.valor_litro || medias.valor_litro_real));
      if (!(precoLitro>0)) precoLitro = parseNum(ev && (ev.valor_litro_real || ev.valor_litro || ev.valor_litro_combustivel || ev.preco_litro));
      if (!(precoLitro>0)) precoLitro = parseNum(sess && sess.profile && (sess.profile.valor_litro || sess.profile.preco_litro));

      const ok = (dist>0 && consumoKmPorLitro>0 && precoLitro>0);
      const custo = ok ? (dist / consumoKmPorLitro) * precoLitro : 0;
      return { ok, distanciaKm: dist, consumoKmL: consumoKmPorLitro || null, valorLitro: precoLitro || null, custo };
    }
  }catch(_){ }
  return { ok:false, distanciaKm:null, consumoKmL:null, valorLitro:null, custo:0 };
}

// Estimar custo de combustível a partir da distância (preferido) com fallbacks
function estimarCustoCombustivel(ev){
  const meta = calcCombustivelMeta(ev);
  if (meta && meta.ok) return meta.custo;
  // fallback: gasto_combustivel explícito, senão média (apenas se não houver distância)
  const g = parseNum(ev && ev.gasto_combustivel);
  if (g > 0) return g;
  const gm = parseNum(ev && ev.gasto_combustivel_media);
  return gm > 0 ? gm : 0;
}

// Estimativas de um evento, seguindo regra: combustível por km; demais via médias do payload
function estimativasDeEvento(ev){
  console.log('--- estimativasDeEvento Debug ---');
  console.log('Event:', ev);
  const mediasLocais = loadMedias();
  console.log('Medias Locais:', mediasLocais);
  const sess = getUserSession(); const prof = (sess && sess.profile) || {};
  console.log('User Session Profile:', prof);

  const metaComb = calcCombustivelMeta(ev);
  let combustivel = metaComb.ok ? metaComb.custo : (parseNum(ev && (ev.gasto_combustivel ?? ev.gasto_combustivel_media)) || parseNum(mediasLocais.combustivel));
  if (!(combustivel>0)) combustivel = 0;

  const pick = (mediaVal, evFields, profField) => {
    const m = parseNum(mediaVal); if (m>0) return m;
    const e = (Array.isArray(evFields)? evFields: [evFields]).reduce((acc, k)=> acc>0? acc: parseNum(ev && ev[k]), 0);
    if (e>0) return e;
    const p = parseNum(prof && prof[profField]); return p>0 ? p : 0;
  };

  const hospedagem  = pick(mediasLocais.hospedagem,  ['diaria_hospedagem','diaria_hospedagem_media','valor_diaria_hospedagem'],   'diaria_hospedagem');
  const alimentacao = pick(mediasLocais.alimentacao, ['alimentacao_diaria','alimentacao_diaria_media','valor_diario_alimentacao'],  'alimentacao_diaria');
  const monitor     = pick(mediasLocais.monitor,     ['monitor','monitor_media'],             'monitor');
  const pedagios    = pick(mediasLocais.pedagios,    ['pedagios','pedagios_media'],            'pedagios');
  const outros      = parseNum(ev && (ev.outros_media || ev.outros));
  const total = combustivel + hospedagem + alimentacao + monitor + pedagios + outros;

  console.log('Calculated Expenses:', { combustivel, hospedagem, alimentacao, monitor, pedagios, outros, total });
  console.log('--- End estimativasDeEvento Debug ---');
  return { combustivel, hospedagem, alimentacao, monitor, pedagios, outros, total, metaComb };
}

// Período: "day" (hoje), "week" (7 dias), "faturamento" (30 dias)
function isWithinPeriod(dateStr, period){
  try{
    const base = new Date(); base.setHours(0,0,0,0);
    const d0 = parseDatePreserveUTC(dateStr); if (!d0 || Number.isNaN(d0.getTime())) return false;
    const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
    if (period==='day') return d.getTime()===base.getTime();
    if (period==='week') return d >= base && d <= new Date(base.getTime()+7*86400000);
    if (period==='faturamento') return d >= base && d <= new Date(base.getTime()+30*86400000);
    return true;
  }catch(_){ return false; }
}
function filterEventosPorPeriodo(period){
  return (eventosEnriquecidos||[])
    .filter(ev => isWithinPeriod(ev.data_agendamento, period)
      && !eventosCancelados.has(ev.id)
      && !eventosEliminados.has(ev.id));
}

// MESMA FONTE PARA AMBOS: eventos filtrados por período
function getEventosParaCalculo(period) {
  return filterEventosPorPeriodo(period);
}

// Totais estimados (usa valores do evento; se faltarem, usa médias) - MESMA FONTE QUE REAIS
function calcularTotaisEstimados(eventos){
  let combustivel=0, hospedagem=0, alimentacao=0, monitor=0, pedagios=0, total=0;
  for (const ev of (eventos||[])){
    const est = estimativasDeEvento(ev);
    combustivel += est.combustivel;
    hospedagem  += est.hospedagem;
    alimentacao += est.alimentacao;
    monitor     += est.monitor;
    pedagios    += est.pedagios + est.outros;
    total       += est.total;
  }
  return { combustivel, hospedagem, alimentacao, monitor, pedagios, total };
}

// Totais reais (somados do LS por evento dentro do período) - MESMA FONTE QUE ESTIMADOS
function calcularTotaisReais(period){
  const reais = loadDespesasReais();
  const eventos = getEventosParaCalculo(period); // MESMA FONTE
  const idSet = new Set(eventos.map(e=> String(e.id)));
  let combustivel=0, hospedagem=0, alimentacao=0, monitor=0, pedagios=0, total=0;
  for (const [id, r] of Object.entries(reais)){
    if (!idSet.has(String(id))) continue;
    const c = parseNum(r.combustivel_real);
    const h = parseNum(r.hospedagem_real);
    const a = parseNum(r.alimentacao_real);
    const m = parseNum(r.monitor_real);
    const p = parseNum(r.pedagios_real||0) + parseNum(r.outros||0);
    combustivel += c; hospedagem += h; alimentacao += a; monitor += m; pedagios += p;
    total += c+h+a+m+p;
  }
  return { combustivel, hospedagem, alimentacao, monitor, pedagios, total };
}

// Faturamento - MESMA FONTE PARA AMBOS
function calcularFaturamento(eventos){
  return (eventos||[]).reduce((acc,ev)=> acc + (parseNum(ev.valor_total)||0), 0);
}

// Cálculo unificado de lucro - MESMA FONTE PARA AMBOS
function calcularLucro(eventos, totEst, totReal){
  const faturamentoTotal = calcularFaturamento(eventos);
  const lucroBase = faturamentoTotal * 0.26;
  
  // Usa despesas reais se disponíveis, senão usa estimadas
  const despesasConsideradas = totReal.total > 0 ? totReal.total : totEst.total;
  const lucroLiquido = lucroBase - despesasConsideradas;
  
  return { faturamentoTotal, lucroBase, lucroLiquido };
}

function atualizarResumoDespesas(period){
  // MESMA FONTE PARA AMBOS
  const eventos = getEventosParaCalculo(period);
  const totEst = calcularTotaisEstimados(eventos);
  const totReal = calcularTotaisReais(period);
  const lucro = calcularLucro(eventos, totEst, totReal);

  // Render UI estimados
  if (elementos.estFuel)    elementos.estFuel.textContent    = BRL(totEst.combustivel);
  if (elementos.estHotel)   elementos.estHotel.textContent   = BRL(totEst.hospedagem);
  if (elementos.estFood)    elementos.estFood.textContent    = BRL(totEst.alimentacao);
  if (elementos.estMonitor) elementos.estMonitor.textContent = BRL(totEst.monitor);
  if (elementos.estTotal)   elementos.estTotal.textContent   = BRL(totEst.total);
  if (elementos.estFatTotal) elementos.estFatTotal.textContent = BRL(lucro.faturamentoTotal);
  if (elementos.estFatBase)  elementos.estFatBase.textContent  = BRL(lucro.lucroBase);
  if (elementos.estLucro)    elementos.estLucro.textContent    = BRL(lucro.lucroLiquido);

  // Render UI reais
  if (elementos.realFuel)    elementos.realFuel.textContent    = BRL(totReal.combustivel);
  if (elementos.realHotel)   elementos.realHotel.textContent   = BRL(totReal.hospedagem);
  if (elementos.realFood)    elementos.realFood.textContent    = BRL(totReal.alimentacao);
  if (elementos.realMonitor) elementos.realMonitor.textContent = BRL(totReal.monitor);
  if (elementos.realTotal)   elementos.realTotal.textContent   = BRL(totReal.total);
  if (elementos.realFatTotal) elementos.realFatTotal.textContent = BRL(lucro.faturamentoTotal);
  if (elementos.realFatBase)  elementos.realFatBase.textContent  = BRL(lucro.lucroBase);
  if (elementos.realLucro)    elementos.realLucro.textContent    = BRL(lucro.lucroLiquido);

  // Faturamento e lucro - MESMA FONTE
  // Mantemos o card "Faturamento Total" do topo atualizado separadamente via atualizarEstatisticas
  if (elementos.motivMessage){
    if (lucro.lucroLiquido >= 0){ 
      elementos.motivMessage.textContent = 'Missão rentável 🚀'; 
      elementos.motivMessage.classList.add('positive'); 
      elementos.motivMessage.classList.remove('negative'); 
    } else { 
      elementos.motivMessage.textContent = 'Despesas acima do lucro previsto ⚠️'; 
      elementos.motivMessage.classList.add('negative'); 
      elementos.motivMessage.classList.remove('positive'); 
    }
  }
}

// Render cards de eventos + formulários embutidos
function renderEventosDespesas(eventos){
  const host = elementos.despesasEventsList; if (!host) return;
  host.innerHTML = '';
  const reaisMap = loadDespesasReais();
  const medias = loadMedias();

  const cards = (eventos||[]).map(ev=>{
    const id = String(ev.id);
    const r = reaisMap[id] || {};
    const est = estimativasDeEvento(ev);
    const estTotal = est.total;
    const realC = parseNum(r.combustivel_real);
    const realH = parseNum(r.hospedagem_real);
    const realA = parseNum(r.alimentacao_real);
    const realM = parseNum(r.monitor_real);
    const realP = parseNum(r.pedagios_real||0)+parseNum(r.outros||0);
    const realTotal = realC+realH+realA+realM+realP;
    const faturamento = parseNum(ev.valor_total);
    const lucroBaseEvento = (faturamento||0) * 0.26;
    const lucroLiquidoEst = lucroBaseEvento - (estTotal||0);
    const lucroLiquidoReal = lucroBaseEvento - (realTotal||0);
    const lucroEscolhido = (realTotal>0) ? { valor: lucroLiquidoReal, est:false } : { valor: lucroLiquidoEst, est:true };
    const cidadeUF = (function(){
      try{
        const parts = [];
        if (ev.cidade) parts.push(String(ev.cidade));
        const uf = ev.uf || ev.estado || ev.estado_destino || ev.uf_destino;
        if (uf) parts.push(String(uf));
        return parts.join(' - ');
      }catch(_){ return ev.cidade || ''; }
    })();

    return `
      <details class="custos-card" data-event-id="${id}">
        <summary class="custos-summary">
          <div class="custos-summary-left">
            <i class="fas fa-school"></i>
            <div>
            <div class="title">${ev.nome_da_escola || '-'} <span class="chip small" title="ID do Evento"><i class="fas fa-hashtag"></i> ${id}</span></div>
            <div class="sub">${(cidadeUF || '-').replace(/\s+/g,' ').trim()} - ${formatarData(ev.data_agendamento)}</div>
            </div>
          </div>
          <div class="custos-summary-right">
            ${faturamento ? `<span class=\"chip chip-valor\" style=\"opacity:.9\"><i class=\"fas fa-coins\"></i> Faturamento: ${BRL(faturamento)}</span>` : ''}
            <span class=\"chip chip-valor\" style=\"opacity:.9\"><i class=\"fas fa-wallet\"></i> Est.: ${BRL(estTotal)}</span>
            <span class=\"chip chip-lucro ${lucroEscolhido.valor>=0?'positive':'negative'}\" title=\"${lucroEscolhido.est?'Estimado até lançar despesas reais':'Baseado em despesas reais'}\" style=\"opacity:.95\"><i class=\"fas fa-hand-holding-dollar\"></i> ${BRL(lucroEscolhido.valor)}</span>
            ${ realTotal ? `<span class=\"chip status-lancado\"><i class=\"fas fa-check\"></i> Real: ${BRL(realTotal)}</span>` : '' }
            ${ (eventosErroAoFinalizar && eventosErroAoFinalizar.has(String(id))) ? `<span class=\"chip\" style=\"background: rgba(229,62,62,.18); border:1px solid rgba(229,62,62,.35); color:#ffc9c9\"><i class=\"fas fa-exclamation-triangle\"></i> Erro ao finalizar</span>` : '' }
            <button type=\"button\" class=\"btn btn-route launch-expense\">Lançar Despesas</button>
            <button type=\"button\" class=\"btn btn-secondary\" onclick=\"excluirEvento('${id}')\"><i class=\"fas fa-trash\"></i> Excluir</button>
            <i class=\"fas fa-chevron-down arrow\"></i>
          </div>
        </summary>
        <div class="custos-details painel-evento">
          <div class="cost-box estimated">
            <h4><i class="fas fa-sack-dollar"></i> Estimados</h4>
            <div class="cost-line"><span>ID do Evento</span><span>${id}</span></div>
            <div class="cost-line"><span>Combustível</span><span>${BRL(est.combustivel)}</span></div>
            <div class="cost-line"><span>Hospedagem</span><span>${BRL(est.hospedagem)}</span></div>
            <div class="cost-line"><span>Alimentação</span><span>${BRL(est.alimentacao)}</span></div>
            <div class="cost-line"><span>Monitor</span><span>${BRL(est.monitor)}</span></div>
            <div class="cost-line"><span>Pedágios</span><span>${BRL(est.pedagios)}</span></div>
            <div class="cost-line"><span>Valor do litro (R$)</span><span>${BRL(parseNum((est.metaComb && est.metaComb.valorLitro) || (medias && medias.valor_litro) || ev.valor_litro))}</span></div>
          <div class="cost-total"><span>Total</span><span>${BRL(estTotal)}</span></div>
          <div class="cost-line"><span>Lucro Base (26%)</span><span>${BRL(lucroBaseEvento)}</span></div>
          <div class="cost-line"><span>Lucro Líquido (est.)</span><span>${BRL(lucroLiquidoEst)}</span></div>
          </div>
          <div class="cost-box real">
            <h4><i class="fas fa-receipt"></i> Reais</h4>
            <div class="cost-line"><span>ID do Evento</span><span>${id}</span></div>
            <div class="cost-line"><span>Combustível</span><span>${BRL(realC)}</span></div>
            <div class="cost-line"><span>Hospedagem</span><span>${BRL(realH)}</span></div>
            <div class="cost-line"><span>Alimentação</span><span>${BRL(realA)}</span></div>
            <div class="cost-line"><span>Monitor</span><span>${BRL(realM)}</span></div>
          <div class="cost-line"><span>Pedágios/Outros</span><span>${BRL(realP)}</span></div>
          <div class="cost-line"><span>Valor do litro (R$)</span><span>${BRL(parseNum(r.valor_litro || (est.metaComb && est.metaComb.valorLitro) || (medias && medias.valor_litro) || ev.valor_litro))}</span></div>
            <div class="cost-total"><span>Total</span><span>${BRL(realTotal)}</span></div>
            <div class="cost-line"><span>Lucro Base (26%)</span><span>${BRL(lucroBaseEvento)}</span></div>
            <div class="cost-line"><span>Lucro Líquido (real)</span><span>${BRL(lucroLiquidoReal)}</span></div>
          </div>
          <form class="launch-form expense-form cost-box" data-form-event-id="${id}">
            <h4><i class="fas fa-pencil"></i> Lançar despesas</h4>
            <div class="form-grid">
              <div class="form-row"><label>Combustível</label><input type="number" step="0.01" name="combustivel_real" value="${realC||''}" /></div>
              <div class="form-row"><label>Hospedagem</label><input type="number" step="0.01" name="hospedagem_real" value="${realH||''}" /></div>
              <div class="form-row"><label>Alimentação</label><input type="number" step="0.01" name="alimentacao_real" value="${realA||''}" /></div>
              <div class="form-row"><label>Monitor</label><input type="number" step="0.01" name="monitor_real" value="${realM||''}" /></div>
              <div class="form-row"><label>Pedágios</label><input type="number" step="0.01" name="pedagios_real" value="${parseNum(r.pedagios_real)||''}" /></div>
              <div class="form-row"><label>Valor do litro (R$)</label><input type="number" step="0.01" name="valor_litro" value="" /></div>
              <div class="form-row"><label>Outros</label><input type="number" step="0.01" name="outros" value="${parseNum(r.outros)||''}" /></div>
              <div class="form-row"><label>Observações</label><textarea name="observacoes" rows="2" placeholder="Observações (opcional)"></textarea></div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-primary form-submit">Lançar</button>
            </div>
          </form>
        </div>
      </details>`;
  });

  host.innerHTML = cards.join('') || '<div class="empty-state"><i class="fas fa-inbox"></i> Sem eventos no período.</div>';
  // Recalcula despesas estimadas com base no próximo evento e médias atuais
  __refreshDespesas();

  // Binds
  host.querySelectorAll('.custos-card').forEach(card=>{
    const id = card.getAttribute('data-event-id');
    const btnToggle = card.querySelector('.toggle-event');
    const btnLaunch = card.querySelector('.launch-expense');
    const form = card.querySelector('form.expense-form');

    if (btnToggle) btnToggle.addEventListener('click', ()=>{ card.open = !card.open; });
    if (btnLaunch) btnLaunch.addEventListener('click', ()=>{
      if (!form) return;
      if (!card.open) card.open = true;
      form.style.display = 'block';
      try { (form.querySelector('input, textarea, select')||{}).focus?.(); } catch(_){ }
    });
    if (form){
      const submit = form.querySelector('.form-submit');
      if (submit){
        submit.addEventListener('click', async ()=>{
          const data = Object.fromEntries(new FormData(form).entries());
          ['combustivel_real','hospedagem_real','alimentacao_real','monitor_real','pedagios_real','outros'].forEach(k=> data[k]=parseNum(data[k]));
          const res = await enviarDespesaReal(id, data);
          if (res && res.ok){
            form.style.display = 'none';
            toast('Despesas registradas ✅');
            try{ const b=card.querySelector('.launch-expense'); if (b){ b.textContent='Despesas registradas ✅'; b.disabled=true; } }catch(_){}
            await despesasRefresh(currentPeriod());
          } else {
            // Mantém o formulário aberto; erro já foi exibido
          }
        });
      }
    }
  });
}

async function enviarDespesaReal(idEvento, dados){
  const s = getUserSession();
  const ev = obterEventoPorId(String(idEvento));

  // Monta objeto de astronomo combinando sessão + dados do evento
  const astronomo = (function(){
    const base = {};
    try{
      if (s){ base.username=s.username; base.assistant_id=s.assistant_id; base.id_astronomo=s.id_astronomo; base.session_id=s.session_id; base.row_number=s.row_number; }
    }catch(_){}
    try{
      if (ev){
        if (ev.astronomo) base.nome = ev.astronomo;
        if (ev.id_astronomo!=null) base.id_astronomo_evento = ev.id_astronomo;
        if (ev.responsavel_pelo_evento) base.responsavel_evento = ev.responsavel_pelo_evento;
      }
    }catch(_){}
    return base;
  })();

  // Copia segura do evento para enviar (sem objetos grandes e sem coords)
  const eventoResumo = (function(){
    if (!ev) return null;
    const omit = (k)=> /^(coordenadas|waypoints|rota|historico|_.*)$/i.test(k) || /(origem|destino).*?(lat|lon|lng)/i.test(k) || /^(lat|lng|lon)$/i.test(k);
    const out = {};
    for (const [k,v] of Object.entries(ev)){
      if (omit(k)) continue;
      out[k] = v;
    }
    return out;
  })();

  // Campos-chave para identificar o evento no backend (match)
  const eventoEscola = (ev && (ev.nome_da_escola || ev.escola || ev.school || ev.local)) ? String(ev.nome_da_escola || ev.escola || ev.school || ev.local) : undefined;
  const eventoDataRaw = (ev && (ev.data_agendamento || ev.data || ev.data_evento)) ? String(ev.data_agendamento || ev.data || ev.data_evento) : undefined;
  const eventoDataISO = (function(){
    try{
      if (!eventoDataRaw) return undefined;
      const d = parseDatePreserveUTC(eventoDataRaw);
      if (!d || isNaN(d)) return undefined;
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    }catch(_){ return undefined; }
  })();

  const payload = {
    action: 'lancar_despesas',
    tipo: 'lancar_despesas', // alias para compatibilidade
    action_slug: 'lancar_despesas',
    id_evento: String(idEvento),
    // marcar evento como concluído junto ao lançamento
    finalizado: 1,
    // user_id padronizado: sempre o id_astronomo do login
    user_id: (function(){ try{ return (s && s.id_astronomo!=null) ? Number(s.id_astronomo) : undefined; }catch(_){ return undefined; } })(),
    // garante id do astrônomo no payload raiz
    id_astronomo: (function(){
      try {
        if (s && s.id_astronomo != null) return Number(s.id_astronomo);
        if (ev && ev.id_astronomo != null) return Number(ev.id_astronomo);
        if (ev && ev.id_astronomo_evento != null) return Number(ev.id_astronomo_evento);
      } catch(_) {}
      return undefined;
    })(),
    // chaves para match no backend
    nome_da_escola: eventoEscola,
    escola: eventoEscola,
    data_agendamento: eventoDataRaw || eventoDataISO,
    data_evento: eventoDataISO || eventoDataRaw,
    // Cidade de destino (nome) — solicitado para o webhook
    ...(function(){
      try{
        const destName = sanitizeCityName(ev?.cidade_destino || ev?.destino || ev?.cidade || '');
        return destName ? { cidade_destino: destName, event_dest_city: destName } : {};
      }catch(_){ return {}; }
    })(),
    // totais consolidados
    custo_total_real: (function(){
      try{
        const cn = k=> parseNum(dados && dados[k]);
        return cn('combustivel_real') + cn('hospedagem_real') + cn('alimentacao_real') + cn('monitor_real') + cn('pedagios_real') + cn('outros');
      }catch(_){ return 0; }
    })(),
    custo_total_estimado: (function(){
      try{
        const cn = v => parseNum(v);
        return cn(ev && (ev.gasto_combustivel)) + cn(ev && (ev.diaria_hospedagem)) + cn(ev && (ev.alimentacao_diaria)) + cn(ev && (ev.monitor)) + cn(ev && (ev.pedagios));
      }catch(_){ return undefined; }
    })(),
    valor_total_evento: (function(){
      try{
        const v = ev && (ev.valor_total_evento != null ? ev.valor_total_evento : ev.valor_total);
        return parseNum(v);
      }catch(_){ return undefined; }
    })(),
    ...(dados||{}),
    ...(s||{}),
    astronomo,
    ...(eventoResumo ? { evento: eventoResumo } : {})
  };

  try {
    // Envia GET (parâmetros na querystring) e tenta ler a resposta do n8n
    let data = null;
    try{
      let url = withUserQuery(N8N_LANCAR_DESPESAS_URL);
      url = appendQueryParams(url, payload);
      if (isDebugEnabled()) console.log('[lancar_despesas][GET] =>', url);
      const resp = await getWithTimeout(url, 20000);
      if (!resp || !resp.ok) throw new Error('HTTP '+(resp && resp.status));
      const txt = await resp.text().catch(()=> '');
      if (txt && txt.trim() && /^[\[{]/.test(txt.trim())){ try{ data = JSON.parse(txt); }catch(_){ data = null; } }
    }catch(err){
      console.warn('[despesas] Erro HTTP ao enviar ao n8n (GET):', err);
      throw new Error('Falha ao enviar as despesas.');
    }
    // Verifica sucesso na resposta (compatível com retorno em array de registros)
    const ok = (function(d){
      try{
        if (!d) return false;
        if (d.ok === true || d.success === true) return true;
        const status = String(d.status||'').toLowerCase();
        if (status==='ok' || status==='success' || status==='sucess' || status==='sucesso') return true;
        if (Array.isArray(d)){
          const arr = d.filter(x => x && x!=='null');
          if (!arr.length) return false;
          const idStr = String(idEvento);
          const match = arr.find(it => {
            try{
              const a = (it && (it.id_evento!=null ? String(it.id_evento) : (it.id!=null ? String(it.id) : '')));
              const b = (it && it.id_evento_unico!=null) ? String(it.id_evento_unico) : '';
              return a===idStr || b===idStr || !idStr; // aceita lista sem id quando houver pelo menos 1 item
            }catch(_){ return false; }
          });
          return !!(match || arr.length>0);
        }
        if (typeof d==='object' && (('error' in d) || ('erro' in d))) return false;
        return true; // 200 + payload plausível
      }catch(_){ return false; }
    })(data);
    if (!ok) {
      throw new Error((data && (data.message || data.error || data.erro)) || 'Resposta não esperada do n8n.');
    }

    // Sucesso: salva localmente o lançamento e atualiza médias apenas localmente (sem enviar media_gasto)
    const map = loadDespesasReais(); map[payload.id_evento] = payload; saveDespesasReais(map);
    try { updateMediasHistoricasFromMap(map); } catch(_) {}
    // Dispara atualização de médias no n8n e recarrega
    try { await gerarMedias({ id_evento: idEvento }); } catch(_){}
    // Marca o evento como finalizado localmente e atualiza visões
    try {
      const idStr = String(idEvento);
      if (!eventosFinalizados.has(idStr)) {
        eventosFinalizados.add(idStr);
        salvarEventosFinalizados();
      }
    } catch(_){}
    // Atualiza listas/contadores relacionados à agenda/rotas
    try {
      renderizarProximosEventos();
      renderizarHistorico();
      atualizarEstatisticas(dadosSincronizados || {});
      atualizarEventosHoje();
    } catch(_){}
    return { ok:true, data };
  } catch (e) {
    console.warn('[despesas] Falha ao enviar ao n8n:', e);
    toast(`Erro ao enviar despesas ao n8n: ${e && e.message ? e.message : 'tente novamente'}`);
    return { ok:false, error: e && e.message ? e.message : String(e) };
  }
}

function updateMediasHistoricasFromMap(reaisMap){
  const C=[],H=[],A=[],M=[],P=[];
  for (const r of Object.values(reaisMap||{})){
    C.push(parseNum(r.combustivel_real));
    H.push(parseNum(r.hospedagem_real));
    A.push(parseNum(r.alimentacao_real));
    M.push(parseNum(r.monitor_real));
    P.push(parseNum(r.pedagios_real||0) + parseNum(r.outros||0));
  }
  const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
  const medias = { combustivel:avg(C), hospedagem:avg(H), alimentacao:avg(A), monitor:avg(M), pedagios:avg(P) };
  saveMedias(medias);
  return medias;
}

// Carregamento de médias: não chama nenhuma action automaticamente
async function solicitarMediasNoCarregamento(){
  try{
    // Mantemos apenas leitura local; sem requisições automáticas ao n8n
    const m = loadMedias && loadMedias();
    if (!m) return;
  }catch(_){ }
}

// Envia ao n8n o pedido para gerar/atualizar médias e, em seguida, busca-as
async function gerarMedias(opts){
  try{
    const s = getUserSession();
    const base = withUserQuery(N8N_LANCAR_DESPESAS_URL);
    const u = new URL(base, window.location.origin);
    u.searchParams.set('action','gerar_media_de_gastos');
    u.searchParams.set('tipo','gerar_media_de_gastos');
    if (opts && opts.id_evento){ u.searchParams.set('id_evento', String(opts.id_evento)); }
    if (s && s.id_astronomo!=null){
      u.searchParams.set('user_id', String(s.id_astronomo));
      if (!u.searchParams.get('id_astronomo')) u.searchParams.set('id_astronomo', String(s.id_astronomo));
    }
    // Aguarda resposta e, se vier com médias, atualiza o cache local imediatamente
    const resp = await getWithTimeout(u.toString(), 15000);
    if (resp && resp.ok){
      try{
        const raw = await resp.text();
        if (raw && raw.trim()){
          let data = null; try{ data = JSON.parse(raw); }catch(_){ data = null; }
          const m = (data && (data.medias || data)) || null;
          if (m && (m.combustivel!=null || m.hospedagem!=null || m.alimentacao!=null || m.monitor!=null || m.pedagios!=null)){
            const norm = {
              combustivel: parseNum(m.combustivel),
              hospedagem:  parseNum(m.hospedagem),
              alimentacao: parseNum(m.alimentacao),
              monitor:     parseNum(m.monitor),
              pedagios:    parseNum(m.pedagios),
              // valores auxiliares, se vierem
              valor_litro: parseNum(m.valor_litro),
              consumo_km_l: parseNum(m.consumo_km_l)
            };
            saveMedias(norm);
          }
        }
      }catch(_){ /* ignora parse falho */ }
    }
  }catch(e){ console.warn('Falha ao pedir geração de médias', e); }
  try{ await despesasRefresh(currentPeriod()); }catch(_){ }
}

function currentPeriod(){
  const active = document.querySelector('#despesas-content [data-period].active');
  return active ? active.getAttribute('data-period') : 'week';
}

async function despesasRefresh(period){
  const eventos = getEventosParaCalculo(period); // MESMA FONTE
  atualizarResumoDespesas(period);
  renderEventosDespesas(eventos);
  if (elementos.despesasEventsCount) elementos.despesasEventsCount.textContent = `${eventos.length} eventos`;

  // Mostrar dica para lançar a primeira despesa (para calcular médias)
  try{
    const reaisMap = loadDespesasReais();
    const hasAnyReal = reaisMap && Object.keys(reaisMap).length > 0;
    const m = loadMedias();
    const mediasAllZero = !(parseNum(m.combustivel)>0 || parseNum(m.hospedagem)>0 || parseNum(m.alimentacao)>0 || parseNum(m.monitor)>0 || parseNum(m.pedagios)>0);
    const showHint = (!hasAnyReal && mediasAllZero);
    if (elementos.despesasHint) elementos.despesasHint.style.display = showHint ? 'flex' : 'none';
    if (elementos.estMediasHint) elementos.estMediasHint.style.display = 'flex';
  }catch(_){
    if (elementos.despesasHint) elementos.despesasHint.style.display = 'flex';
    if (elementos.estMediasHint) elementos.estMediasHint.style.display = 'flex';
  }
}

function bindDespesasUI(){
  if (!elementos.despesasContent) return;

  // Botões de período
  const btns = elementos.despesasContent.querySelectorAll('[data-period]');
  btns.forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      btns.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      await despesasRefresh(btn.getAttribute('data-period'));
    });
  });

  // Definir padrão "week"
  const weekBtn = elementos.despesasContent.querySelector('[data-period="week"]');
  if (weekBtn && !weekBtn.classList.contains('active')) weekBtn.classList.add('active');

  // Botão Atualizar (só recalcula com dados atuais)
  if (elementos.despesasReload){
    elementos.despesasReload.addEventListener('click', async ()=>{ await despesasRefresh(currentPeriod()); });
  }
  // Botão atualizar médias (recalcula no n8n e recarrega)
  if (elementos.gerarMediasBtn){
    elementos.gerarMediasBtn.addEventListener('click', async ()=>{
      try{
        const btn = elementos.gerarMediasBtn; btn.disabled=true; btn.classList.add('is-loading');
        toast('Gerando média de gastos...');
        await gerarMedias();
        toast('Médias geradas/atualizadas.');
      }catch(e){ toast('Falha ao gerar médias'); }
      finally{ const btn = elementos.gerarMediasBtn; btn.disabled=false; btn.classList.remove('is-loading'); }
    });
  }
  // (removido) botão Atualizar médias

  // (removido) botão Relançar Médias

  // Botão Reset local (limpa despesas reais e médias)
  if (elementos.despesasReset){
    elementos.despesasReset.addEventListener('click', ()=>{
      try { localStorage.removeItem(keyFor(LS_KEY_REAIS)); localStorage.removeItem(keyFor(LS_KEY_MEDIAS)); } catch(_){}
      toast('Dados locais de despesas apagados.');
      setTimeout(()=>{ try{ despesasRefresh(currentPeriod()); }catch(_){ } }, 200);
    });
  }

  // Formulário fixo (se você quiser manter além do inline por evento)
  if (elementos.despesasForm){
    elementos.despesasForm.addEventListener('submit', async (evt)=>{
      evt.preventDefault();
      const form = elementos.despesasForm;
      const id_evento = String(form.id_evento.value||'').trim();
      if (!id_evento){ toast('Selecione um evento.'); return; }
      const payload = {
        combustivel_real: parseNum(form.combustivel_real.value),
        hospedagem_real:  parseNum(form.hospedagem_real.value),
        alimentacao_real: parseNum(form.alimentacao_real.value),
        monitor_real:     parseNum(form.monitor_real.value),
        pedagios_real:    parseNum(form.pedagios_real.value),
        valor_litro:      parseNum(form.valor_litro.value),
        outros:           parseNum(form.outros.value),
        observacoes:      String(form.observacoes.value||'').trim()
      };
      const res = await enviarDespesaReal(id_evento, payload);
      if (res && res.ok){
        toast('Despesas reais lançadas com sucesso.');
        try{ form.reset(); }catch(_){}
        await despesasRefresh(currentPeriod());
      } else {
        // erro já toasteado; não reseta nem atualiza
      }
    });

    // Popular select de eventos (exclui cancelados/eliminados)
    try{
      const sel = elementos.despesasForm.querySelector('select[name="id_evento"]');
      if (sel){
        sel.innerHTML = '<option value="">Selecione...</option>' + (eventosEnriquecidos||[])
          .filter(ev => !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id))
          .map(ev=>{
          const label = `${ev.id} — ${ev.nome_da_escola||'-'} (${(ev.cidade||'').split('-')[0].trim()})`;
          return `<option value="${ev.id}">${label}</option>`;
        }).join('');
      }
    }catch(_){}
  }
}

// Atualiza o select do formulário fixo com os eventos atuais
function popularSelectDespesasForm(){
  try{
    if (!elementos.despesasForm) return;
    const sel = elementos.despesasForm.querySelector('select[name="id_evento"]');
    if (!sel) return;
    const options = (eventosEnriquecidos||[])
      .filter(ev => !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id))
      .map(ev=>{
      const cidade = ((ev.cidade||'').split('-')[0]||'').trim();
      const label = `${ev.id} — ${ev.nome_da_escola||'-'} (${cidade||'-'})`;
      return `<option value="${ev.id}">${label}</option>`;
    }).join('');
    sel.innerHTML = '<option value="">Selecione...</option>' + options;
  }catch(_){ }
}

/* =========================
   INICIALIZAÇÃO
   ========================= */
function atualizarDataAtual(){
  const d = getSelectedDate();
  if (elementos.currentDate)
    elementos.currentDate.textContent = d.toLocaleDateString('pt-BR',{ weekday:'long', year:'numeric', month:'long', day:'numeric' });
  console.log('📅 Data atual atualizada:', elementos.currentDate ? elementos.currentDate.textContent : '-');
}

// ===== Mini Calendário (render e navegação) =====
let __CAL_MONTH = (function(){ const d=new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
let __CAL_SELECTED = null; // data selecionada pelo usuário (Date com H=0)

function getSelectedDate(){
  try{ if (__CAL_SELECTED instanceof Date && !isNaN(__CAL_SELECTED)) return __CAL_SELECTED; }catch(_){ }
  const d = new Date(); d.setHours(0,0,0,0); return d;
}
function getSelectedIso(){ const d=getSelectedDate(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function setSelectedDate(date){
  try{
    const d = (date instanceof Date) ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : new Date(date);
    d.setHours(0,0,0,0); __CAL_SELECTED = d;
  }catch(_){ const t=new Date(); t.setHours(0,0,0,0); __CAL_SELECTED=t; }
  try{ atualizarDataAtual(); }catch(_){ }
  try{ atualizarEventosHoje(); }catch(_){ }
  try{ renderMiniCalendar(); }catch(_){ }
}

function fmtMonthLabel(d){ try{ return d.toLocaleDateString('pt-BR', { month:'long', year:'numeric' }); }catch(_){ return `${d.getMonth()+1}/${d.getFullYear()}`; } }

function getEventosPorDiaMap(){
  const map = new Map();
  const evs = (eventosEnriquecidos||[]).filter(ev => !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id));
  for (const ev of evs){
    const dias = Array.isArray(ev.ocorrencias_dias) && ev.ocorrencias_dias.length
      ? ev.ocorrencias_dias
      : (function(){
          const d = parseDatePreserveUTC(ev.data_agendamento); if(!d) return [];
          const n = Math.max(1, parseInt(ev.dias_total,10)||1);
          const arr=[]; for(let i=0;i<n;i++){ const x=new Date(d.getFullYear(), d.getMonth(), d.getDate()+i); arr.push(`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`); }
          return arr;
        })();
    for (const day of dias){
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(ev);
    }
  }
  return map;
}

function renderMiniCalendar(){
  const grid = elementos.miniCalendarGrid; if (!grid) return;
  const d = __CAL_MONTH instanceof Date ? new Date(__CAL_MONTH) : new Date();
  d.setDate(1);
  const year = d.getFullYear();
  const month = d.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0..6 (Dom..Sáb)
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);
  const map = getEventosPorDiaMap();

  // Atualiza labels
  try{ if (elementos.miniMonthLabel) elementos.miniMonthLabel.textContent = fmtMonthLabel(d); }catch(_){ }
  try{ if (elementos.calCurrentMonth) elementos.calCurrentMonth.textContent = fmtMonthLabel(d); }catch(_){ }

  const frags = [];
  const totalCells = firstWeekday + daysInMonth;
  for (let i=0;i<firstWeekday;i++){ frags.push('<div class="mini-calendar-day empty"></div>'); }

  const iso = (Y,M,DD)=> `${Y}-${String(M+1).padStart(2,'0')}-${String(DD).padStart(2,'0')}`;

  // Helper para verificar se um dia pertence a um range multi-diário de algum evento
  function colorForEventId(id){
    // Gera uma paleta HSL estável a partir do id do evento
    try{
      const s = String(id||'');
      let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0;
      const hue = h % 360;
      const a = `hsla(${hue}, 85%, 64%, .36)`;   // glow interno
      const b = `hsla(${(hue+40)%360}, 90%, 58%, .20)`; // mistura
      const c = `hsla(${(hue+10)%360}, 85%, 62%, .24)`; // gradiente 2
      const border = `hsla(${hue}, 90%, 70%, .45)`;
      const outer = `hsla(${(hue+30)%360}, 85%, 60%, .22)`;
      return { a,b,c,border,outer };
    }catch(_){ return { a:'rgba(123,92,255,.35)', b:'rgba(52,209,243,.18)', c:'rgba(123,92,255,.22)', border:'rgba(123,92,255,.45)', outer:'rgba(52,209,243,.22)' }; }
  }

  function rangeInfo(dateIso){
    const list = map.get(dateIso) || [];
    let best=null; let bestLen=0;
    for (const ev of list){
      const dias = Array.isArray(ev.ocorrencias_dias) ? ev.ocorrencias_dias : [];
      if (dias.length >= 2){
        const cur = (function(){ const [Y,M,D]=dateIso.split('-').map(n=>parseInt(n,10)); return new Date(Y, M-1, D); })();
        const prev = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()-1);
        const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()+1);
        const p = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}-${String(prev.getDate()).padStart(2,'0')}`;
        const n = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
        const hasPrev = dias.includes(p);
        const hasNext = dias.includes(n);
        if (hasPrev || hasNext){
          const pos = (hasPrev && hasNext) ? 'range-middle' : (hasPrev ? 'range-end' : 'range-start');
          const len = dias.length; // prioridade ao maior span
          const color = colorForEventId(ev.id || ev.id_evento || 'evt');
          if (!best || len>bestLen){ best = { pos, two: len===2, color, eventId: String(ev.id || ev.id_evento) }; bestLen=len; }
        }
      }
    }
    return best || { pos:'', two:false };
  }

  const selectedIso = getSelectedIso();
  for (let day=1; day<=daysInMonth; day++){
    const cellDate = new Date(year, month, day);
    const dateIso = `${cellDate.getFullYear()}-${String(cellDate.getMonth()+1).padStart(2,'0')}-${String(cellDate.getDate()).padStart(2,'0')}`;
    const isToday = cellDate.getTime() === today.getTime();
    const isPast = cellDate < today;
    const isFuture = cellDate > today;
    const hasEv = map.has(dateIso);
    const r = rangeInfo(dateIso);
    const classes = ['mini-calendar-day'];
    if (isToday) classes.push('current-day');
    if (isPast) classes.push('past-day');
    if (isFuture) classes.push('future-day');
    if (hasEv) classes.push('has-event');
    if (dateIso === selectedIso) classes.push('selected');
    let style = '';
    if (r.pos) {
      classes.push('multi-range'); classes.push(r.pos); if (r.two) classes.push('two-range');
      if (r.color){
        style = ` style="--nebulaA:${r.color.a}; --nebulaB:${r.color.b}; --nebulaC:${r.color.c}; --nebulaBorder:${r.color.border}; --nebulaGlow:${r.color.outer};"`;
      }
    }

    frags.push(`<div class="${classes.join(' ')}" data-date="${dateIso}"${style}>${day}</div>`);
  }
  grid.innerHTML = frags.join('');
  try{
    grid.querySelectorAll('.mini-calendar-day[data-date]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const iso = el.getAttribute('data-date');
        const [y,m,dd] = iso.split('-').map(n=>parseInt(n,10));
        setSelectedDate(new Date(y, m-1, dd));
      });
    });
  }catch(_){ }
}

function bindCalendarNav(){
  const prev = elementos.calPrevBtn; const next = elementos.calNextBtn;
  if (prev){ prev.onclick = ()=>{ __CAL_MONTH = new Date(__CAL_MONTH.getFullYear(), __CAL_MONTH.getMonth()-1, 1); renderMiniCalendar(); }; }
  if (next){ next.onclick = ()=>{ __CAL_MONTH = new Date(__CAL_MONTH.getFullYear(), __CAL_MONTH.getMonth()+1, 1); renderMiniCalendar(); }; }
  // Ao mudar de mês, se o dia selecionado não pertence ao mês atual, mantém seleção e apenas atualiza grid.
}

async function solicitarCalculoRotasSemana(){
  const btn = elementos.calcWeekRoutesBtn; if (!btn) return;
  btn.classList.add('is-loading'); btn.setAttribute('disabled','disabled');
  try{
    const payload = { action:'calcular_rotas_semana', timestamp:new Date().toISOString(), origem:'dashboard_astronomo' };
    let ok=false, lastErr=null;
    for (const url of N8N_CALCULAR_ROTAS_URLS){
      try{
        const resp = await postWithTimeout(url, payload, 15000);
        if (resp.ok){ ok=true; break; }
        lastErr = new Error(`HTTP ${resp.status} em ${url}`);
      }catch(e){ lastErr = e; }
    }
    if (!ok) throw lastErr || new Error('Falha ao notificar');
    alert('Notificação enviada para calcular rotas da semana.');
  }catch(e){
    console.error('Erro ao notificar cálculo de rotas:', e);
    alert('Não foi possível enviar a notificação.');
  }finally{
    btn.classList.remove('is-loading'); btn.removeAttribute('disabled');
  }
}

// ===== Controle diário de popup de localização =====
function hojeKey(){
  try{
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }catch(_){ return String(Date.now()).slice(0,8); }
}
const LAST_LOCATION_PROMPT_KEY = 'location_prompt_last';
function foiMostradoPromptHoje(){
  try{ return localStorage.getItem(keyFor(LAST_LOCATION_PROMPT_KEY)) === hojeKey(); }catch(_){ return false; }
}
function marcarPromptMostradoHoje(){
  try{ localStorage.setItem(keyFor(LAST_LOCATION_PROMPT_KEY), hojeKey()); }catch(_){ }
}

document.addEventListener('DOMContentLoaded', async function(){
  console.log('Inicializando aplicacao...');
  try{ migrateDespesasStorage(); }catch(_){ }
  try{ applyUserTheme(); }catch(_){ }
  try{ const lbl = loadLocationLabel(); if (lbl) updateLocationLabelUI(lbl); }catch(_){ }
  inicializarTabs();
  inicializarEventListeners();
  // Localização:
  // - Se autorizado, envia coordenadas em todo carregamento
  // - Se não autorizado, mostrar popup no máximo 1x por dia
  try{
    const declined = localStorage.getItem(keyFor('location_declined')) === '1';
    if (!declined){
      const got = await capturarLocalizacaoAtual(false);
      if (!got && !foiMostradoPromptHoje()){
        try{ abrirPromptLocalizacaoManual(true); marcarPromptMostradoHoje(); }catch(_){ }
      }
    }
  }catch(_){ }
  bindDespesasUI();
  try{ bindCalendarNav(); renderMiniCalendar(); }catch(_){ }
  try{ setSelectedDate(new Date()); }catch(_){ }
  carregarAgendaDeCacheOuExemplo();
  // Atualização automática: tenta sincronizar 1x/dia ao iniciar (respeita janela mínima)
  try{ await carregarAgendaWebhook(false); }catch(_){ }
  try{ await initWeather(); }catch(_){}
  try{ syncFinalizadosComDespesas(); renderizarHistorico(); renderizarPendentesDeFinalizar(); }catch(_){ }
  try{ await solicitarMediasNoCarregamento(); }catch(_){ }
});

// Reage quando eventos forem atualizados (recalcula despesas)
document.addEventListener('eventsUpdated', async () => {
  await despesasRefresh(currentPeriod());
  try { popularSelectDespesasForm(); } catch(_){ }
  try { await initWeather(); } catch(_){ }
  try { syncFinalizadosComDespesas(); renderizarHistorico(); renderizarPendentesDeFinalizar(); } catch(_){ }
  try { renderMiniCalendar(); } catch(_){ }
  // Não requisita médias ao atualizar a agenda para evitar acionar endpoints de despesas
});

// Exports para botões inline
window.toggleEventDetails = toggleEventDetails;
window.abrirWhatsApp = abrirWhatsApp;
window.abrirRotaMaps = abrirRotaMaps;
window.verDetalhesCompletos = verDetalhesCompletos;
window.finalizarEvento = finalizarEvento;
window.cancelarEvento = cancelarEvento;
window.retomarEvento  = retomarEvento;
window.excluirEvento  = excluirEvento;
window.openExpenseForm = openExpenseForm;
window.openFinalizePrompt = openFinalizePrompt;
window.toggleRouteStep = function(id){
  const el = document.getElementById(id); if (!el) return;
  const details = el.querySelector('.route-step-details'); if (!details) return;
  const open = details.style.display !== 'none';
  details.style.display = open ? 'none' : 'block';
};

// Placeholder for buildRouteInfoHtml
window.buildRouteInfoHtml = function(event) {
  return '';
};

// Expor eventos atuais para outros módulos (ex.: calendar.js)
try{
  window.getCurrentEventsArray = function(){
    try{
      const arr = Array.isArray(eventosEnriquecidos) ? eventosEnriquecidos.slice() : [];
      return arr.filter(ev => !eventosCancelados.has(ev.id) && !eventosEliminados.has(ev.id));
    }catch(_){ return []; }
  };
  window.isEventFinalizado = function(id){ try{ return eventosFinalizados.has(String(id)); }catch(_){ return false; } };
}catch(_){ }

console.log('app.js carregado e pronto!');
