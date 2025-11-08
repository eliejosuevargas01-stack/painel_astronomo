// Painel RH - Astrônomos (frontend puro)
// Usa os endpoints do n8n (relativos)
(function(){
  // ===== UI Select (dropdown custom com paleta do app) =====
  const UISelect = (function(){
    const map = new WeakMap();
    let __openInstance = null;
    const svgCaret = "<svg width='14' height='14' viewBox='0 0 20 20' fill='currentColor' aria-hidden='true'><path d='M5.25 7.5l4.75 5 4.75-5H5.25z'/></svg>";
    function build(select){
      if (!select || map.has(select)) return;
      const wrap = document.createElement('div');
      wrap.className = 'ui-select';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ui-select__button';
      const caret = document.createElement('span'); caret.className='ui-select__caret'; caret.innerHTML = svgCaret;
      const label = document.createElement('span'); label.className='ui-select__label';
      btn.append(label, caret);
      const menu = document.createElement('div'); menu.className='ui-select__menu';
      // move select para dentro do wrap e oculta
      select.classList.add('is-ui-hidden');
      const parent = select.parentNode; parent.insertBefore(wrap, select); wrap.appendChild(select); wrap.appendChild(btn); wrap.appendChild(menu);

      function setLabelFromSelect(){
        const opt = select.options[select.selectedIndex];
        label.textContent = opt ? opt.textContent : '';
      }
      function open(){
        try{ if (__openInstance && __openInstance!==api){ __openInstance.close(); } }catch(_){ }
        wrap.classList.add('is-open'); btn.setAttribute('aria-expanded','true');
        portalizeMenu();
        menu.style.display = 'block';
        positionMenu();
        __openInstance = api;
        window.addEventListener('resize', positionMenu);
        window.addEventListener('scroll', positionMenu, true);
      }
      function close(){
        wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded','false');
        try{ menu.style.display = 'none'; }catch(_){ }
        deportalizeMenu();
        if (__openInstance===api) __openInstance=null;
        window.removeEventListener('resize', positionMenu);
        window.removeEventListener('scroll', positionMenu, true);
      }
      function toggle(){ wrap.classList.contains('is-open') ? close() : open(); }
      function positionMenu(){
        try{
          if (!menu.isConnected) return;
          const rect = btn.getBoundingClientRect();
          const pad = 6;
          menu.style.position = 'fixed';
          menu.style.left = `${Math.round(rect.left)}px`;
          menu.style.top = `${Math.round(rect.bottom + pad)}px`;
          menu.style.width = `${Math.round(rect.width)}px`;
          menu.style.zIndex = '2000';
          const maxH = Math.min(320, Math.max(160, window.innerHeight - rect.bottom - 20));
          menu.style.maxHeight = `${maxH}px`;
        }catch(_){ }
      }
      function onOutside(e){ try{ if (!wrap.contains(e.target) && !menu.contains(e.target)) close(); }catch(_){ } }

      function portalizeMenu(){
        try{
          if (menu.__portaled) return;
          document.body.appendChild(menu);
          menu.classList.add('ui-select__menu--portal');
          menu.__portaled = true;
        }catch(_){ }
      }
      function deportalizeMenu(){
        try{
          if (!menu.__portaled) return;
          // deixa no body, mas esvazia estilos posicionais
          menu.style.left = menu.style.top = menu.style.width = menu.style.maxHeight = '';
          menu.style.position = '';
          menu.classList.remove('ui-select__menu--portal');
        }catch(_){ }
      }

      function selectValue(value){
        if (select.value === value) { close(); return; }
        select.value = value;
        setLabelFromSelect();
        close();
        try{ select.dispatchEvent(new Event('change', { bubbles:true })); }catch(_){ }
      }
      function rebuildMenu(){
        menu.innerHTML = '';
        Array.from(select.options).forEach((o, idx)=>{
          const it = document.createElement('div');
          it.className = 'ui-select__option';
          it.textContent = o.textContent;
          it.setAttribute('role','option');
          if (o.disabled){ it.setAttribute('aria-disabled','true'); }
          it.setAttribute('aria-selected', String(o.selected));
          it.dataset.value = o.value;
          it.addEventListener('click', ()=>{ if (!o.disabled) selectValue(o.value); });
          menu.appendChild(it);
        });
        setLabelFromSelect();
      }
      rebuildMenu();

      btn.addEventListener('click', toggle);
      document.addEventListener('mousedown', onOutside);
      btn.addEventListener('keydown', (e)=>{
        const key = e.key;
        const opts = Array.from(select.options);
        let idx = select.selectedIndex;
        if (key==='ArrowDown'){ e.preventDefault(); idx = Math.min(opts.length-1, idx+1); selectValue(opts[idx].value); open(); }
        if (key==='ArrowUp'){ e.preventDefault(); idx = Math.max(0, idx-1); selectValue(opts[idx].value); open(); }
        if (key==='Enter' || key===' '){ e.preventDefault(); toggle(); }
        if (key==='Escape'){ e.preventDefault(); close(); }
        if (key==='Home'){ e.preventDefault(); if (opts.length){ selectValue(opts[0].value); open(); } }
        if (key==='End'){ e.preventDefault(); if (opts.length){ selectValue(opts[opts.length-1].value); open(); } }
      });

      const api = { wrap, btn, menu, rebuildMenu, setLabelFromSelect, open, close };
      map.set(select, api);
    }
    function refresh(select){
      const rec = map.get(select);
      if (!rec){ build(select); return; }
      rec.rebuildMenu();
    }
    function enhance(sel){
      if (!sel) return; if (NodeList.prototype.isPrototypeOf(sel) || Array.isArray(sel)){ sel.forEach(build); } else { build(sel); }
    }
    return { enhance, refresh };
  })();
  // expõe para chamadas em outros trechos
  try{ window.UISelect = UISelect; }catch(_){ }
  // Endpoint fixo de produção (sem "-test")
  const API_URL = 'https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/novo-astronomo';

  // Resolve preferências de endpoints (ordem de tentativa)
  function resolveUnifiedBases(){
    // Permite override manual via janela (para testes), senão fixa API_URL
    try{
      if (typeof window !== 'undefined' && Array.isArray(window.N8N_RH_ENDPOINTS) && window.N8N_RH_ENDPOINTS.length){
        return window.N8N_RH_ENDPOINTS.map(String).filter(Boolean);
      }
    }catch(_){ }
    return [API_URL];
  }

  // Cache local (30 dias)
  const CACHE_KEY = 'rh_astronomos_cache_v1';
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

  function saveCache(list){
    try{
      const payload = { ts: Date.now(), items: Array.isArray(list) ? list : [] };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    }catch(e){ /* storage cheio ou indisponível */ }
  }
  function loadCache(){
    try{
      const raw = localStorage.getItem(CACHE_KEY); if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.items)) return null;
      if (typeof obj.ts !== 'number') return null;
      if ((Date.now() - obj.ts) > CACHE_TTL_MS) return null; // expirado
      return obj.items;
    }catch(_){ return null; }
  }
  function clearCache(){ try{ localStorage.removeItem(CACHE_KEY); }catch(_){ } }

  let data = [];
  let editingCid = null; // ID interno do cliente para mapear a linha correta
  let dataSource = { method:'cache', url:'', label:'cache' };
  let filters = { estado:'', cidade:'', busca:'' };
  let page = 1; let pageSize = 20;

  // ===== Debug utilities =====
  function getDebugEnabled(){
    try{
      const w = (typeof window!=='undefined') ? window : null;
      const fromWin = w && 'RH_DEBUG' in w ? Boolean(w.RH_DEBUG) : null;
      const urlHas = w ? /[?&]rh_debug=1/i.test(w.location.search) : false;
      const ls = localStorage.getItem('rh_debug') === '1';
      return Boolean((fromWin!==null? fromWin: false) || urlHas || ls);
    }catch(_){ return false; }
  }
  function setDebugEnabled(v){ try{ localStorage.setItem('rh_debug', v? '1':'0'); }catch(_){ } }
  function dbgNow(){ const d=new Date(); return d.toISOString().split('T')[1].replace('Z',''); }
  let __dbgEl=null, __dbgPre=null;
  function ensureDebugPanel(){
    try{
      if (!getDebugEnabled()) return;
      if (__dbgEl) return;
      const host = document.createElement('div'); host.id='rh-debug-panel'; host.className='open';
      host.innerHTML = '<div class="dbg-box"><div class="dbg-head">RH Debug <div><button id="dbg-clear" class="btn btn-secondary">Limpar</button></div></div><div class="dbg-body"><pre id="dbg-pre"></pre></div></div>';
      document.body.appendChild(host);
      __dbgEl = host; __dbgPre = host.querySelector('#dbg-pre');
      host.querySelector('#dbg-clear')?.addEventListener('click', ()=>{ try{ __dbgPre.textContent=''; }catch(_){ } });
    }catch(_){ }
  }
  function dlog(){ try{ if (!getDebugEnabled()) return; ensureDebugPanel(); console.log('[RH-DEBUG]', ...arguments); const msg = Array.from(arguments).map(x=> typeof x==='string'? x: JSON.stringify(x)).join(' '); if (__dbgPre){ __dbgPre.textContent += '['+dbgNow()+'] '+msg+'\n'; __dbgPre.scrollTop = __dbgPre.scrollHeight; } }catch(_){ }
  }

  // ===== Cache de coordenadas por Cidade+UF =====
  const COORDS_CACHE_KEY = 'rh_coords_cache_v1';
  function normalizeCoordKey(city, uf){
    try{ return `${String(city||'').trim().toLowerCase()}|${String(uf||'').trim().toLowerCase()}`; }catch(_){ return `${city}|${uf}`; }
  }
  function loadCoordsCache(){
    try{ const raw = localStorage.getItem(COORDS_CACHE_KEY); const obj = raw? JSON.parse(raw): null; return (obj && typeof obj==='object')? obj: {}; }catch(_){ return {}; }
  }
  function saveCoordsCache(map){
    try{ localStorage.setItem(COORDS_CACHE_KEY, JSON.stringify(map||{})); }catch(_){ }
  }
  let coordsCache = loadCoordsCache();
  function getCachedCoords(city, uf){
    try{
      const k = normalizeCoordKey(city, uf);
      const rec = coordsCache[k];
      if (rec && rec.lat && rec.lon) return { lat:String(rec.lat), lon:String(rec.lon) };
      return null;
    }catch(_){ return null; }
  }
  function setCachedCoords(city, uf, lat, lon){
    try{
      const k = normalizeCoordKey(city, uf);
      coordsCache[k] = { lat:String(lat), lon:String(lon), ts: Date.now() };
      saveCoordsCache(coordsCache);
    }catch(_){ }
  }

  // ===== Pending edits cache (confirmação pós-resposta) =====
  const PENDING_EDITS_KEY = 'rh_pending_edits_v1';
  function loadPendingEdits(){
    try{ const raw = localStorage.getItem(PENDING_EDITS_KEY); const obj = raw? JSON.parse(raw): {}; return (obj && typeof obj==='object')? obj: {}; }catch(_){ return {}; }
  }
  function savePendingEdits(map){
    try{ localStorage.setItem(PENDING_EDITS_KEY, JSON.stringify(map||{})); }catch(_){ }
  }
  function setPendingEdit(id, patch){ const m = loadPendingEdits(); m[String(id||'__cid')]=patch||{}; savePendingEdits(m); }
  function getPendingEdit(id){ const m = loadPendingEdits(); return m[String(id||'__cid')]||null; }
  function clearPendingEdit(id){ const m = loadPendingEdits(); delete m[String(id||'__cid')]; savePendingEdits(m); }

  // Normaliza valores para comparação (números, null/undefined/"null")
  function normVal(v){
    try{
      if (v===null || v===undefined) return '';
      let s = String(v).trim();
      const low = s.toLowerCase();
      if (low==='null' || low==='undefined' || low==='nan') return '';
      // Remove máscara simples de número
      const sNum = s.replace(/\s|\./g,'').replace(',', '.'); // aceita virgula
      const maybe = s.replace(',', '.');
      const n = Number(maybe);
      if (Number.isFinite(n) && /^(?:-?\d+[\.,]?\d*|\d)$/.test(s)){
        return String(Number.parseFloat(n.toFixed(6))); // precisão razoável
      }
      return s;
    }catch(_){ return String(v); }
  }
  function diffAgainstPatch(patch, record){
    const diffs = [];
    if (!patch || !record) return [{ field:'__all__', expected: JSON.stringify(patch), got: JSON.stringify(record) }];
    for (const [k, v] of Object.entries(patch)){
      if (v===undefined) continue; // ignora ausentes
      if (k==='__cid') continue;
      const pv = normVal(v);
      const rv = normVal(record[k]);
      if (pv !== rv){ diffs.push({ field:k, expected:String(v), got: String(record[k]) }); }
    }
    return diffs;
  }

  const $ = (id)=> document.getElementById(id);
  const tbody = $('tbody-astronomos');
  const totalEl = $('total-astronomos');
  const sourceEl = $('data-source-label');
  const clearCacheBtn = $('btn-clear-cache');
  const filterEstado = $('filter-estado');
  const filterCidade = $('filter-cidade');
  const filterBusca = $('filter-busca');
  const pageSizeSel = $('page-size');
  const prevPageBtn = $('prev-page');
  const nextPageBtn = $('next-page');
  const pageInfo = $('page-info');
  const modal = $('rh-modal');
  const form = $('form-astronomo');
  const title = $('modal-title');

  // Loading overlay helpers
  const loadingEl = $('rh-loading');
  const loadingText = $('rh-loading-text');
  let __loadingCount = 0;
  function setButtonLoading(btn, is){ try{ if(!btn) return; if(is){ btn.classList.add('is-loading'); btn.setAttribute('disabled','disabled'); } else { btn.classList.remove('is-loading'); btn.removeAttribute('disabled'); } }catch(_){ }}
  function showLoading(msg){ try{ __loadingCount++; if (loadingEl){ loadingEl.classList.add('open'); if (loadingText) loadingText.textContent = msg || 'Processando…'; } }catch(_){ } }
  function hideLoading(){ try{ __loadingCount = Math.max(0, __loadingCount-1); if (__loadingCount===0 && loadingEl){ loadingEl.classList.remove('open'); } }catch(_){ } }

  const fields = [
    'id_astronomo',
    'usuario','senha_usuario','nome_completo','cidade_base','estado','telefone','email',
    'veiculo','consumo_km_l','combustivel','valor_litro','diaria_hospedagem','alimentacao_diaria','monitor','pedagios',
    // Novos campos de coordenadas da cidade base
    'origem_lat','origem_lon'
  ];

  function openModal(edit = false, row = null){
    editingCid = edit && row ? row.__cid : null;
    title.textContent = edit ? 'Editar Astrônomo' : 'Novo Astrônomo';
    if (edit && row){
      fields.forEach(f => {
        const el = $(f); if (el) el.value = row[f] != null ? String(row[f]) : '';
      });
    } else {
      form.reset();
    }
    // Limpa coords se não houver cidade/UF, e prepara auto-lookup
    try{
      const cidadeEl = $('cidade_base');
      const ufEl = $('estado');
      const latEl = $('origem_lat');
      const lonEl = $('origem_lon');
      if (!edit){ if (latEl) latEl.value = ''; if (lonEl) lonEl.value=''; }
      attachCoordLookupHandlers(cidadeEl, ufEl, latEl, lonEl);
    }catch(_){ }
    modal.classList.add('open');
  }
  function closeModal(){ modal.classList.remove('open'); editingCid = null; }

  function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

  function buildRow(r){
    const s = (v)=> v==null ? '-' : String(v);
    const num = (v)=> {
      const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('pt-BR') : '-';
    };
    return `<tr>
      <td>${s(r.id_astronomo)}</td>
      <td>${s(r.nome_completo)}</td>
      <td>${s(r.usuario)}</td>
      <td>${s(r.cidade_base)}</td>
      <td>${s(r.estado)}</td>
      <td>${s(r.telefone)}</td>
      <td>${s(r.email)}</td>
      <td>${s(r.veiculo)}</td>
      <td style="text-align:right">${s(r.consumo_km_l)}</td>
      <td>${s(r.combustivel)}</td>
      <td style="text-align:right">${s(r.valor_litro)}</td>
      <td style="text-align:right">${s(r.diaria_hospedagem)}</td>
      <td style="text-align:right">${s(r.alimentacao_diaria)}</td>
      <td style="text-align:right">${s(r.monitor)}</td>
      <td style="text-align:right">${s(r.pedagios)}</td>
      <td>
        <button class="btn btn-secondary" data-action="edit" data-id="${r.__cid}"><i class="fas fa-pen"></i></button>
        <button class="btn btn-secondary" data-action="del" data-id="${r.__cid}"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }

  function isLocalDev(){
    try{
      return location.protocol === 'file:' || /^(127\.0\.0\.1|localhost)$/i.test(location.hostname);
    }catch(_){ return true; }
  }

  async function fetchJSON(url, opts){
    const method = (opts && opts.method) ? String(opts.method).toUpperCase() : 'GET';
    const fetchOpts = Object.assign({}, opts||{});
    const hasBody = method === 'POST' && fetchOpts.body != null;
    const baseHeaders = hasBody
      ? { 'Accept': 'application/json, text/plain;q=0.5', 'Content-Type': 'application/json' }
      : { 'Accept': 'application/json, text/plain;q=0.5' };
    fetchOpts.headers = Object.assign({}, baseHeaders, fetchOpts.headers||{});
    const resp = await fetch(url, fetchOpts);
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const ct = (resp.headers.get('content-type')||'').toLowerCase();
    const txt = await resp.text();
    const t = (txt||'').trim();
    // Só tenta parsear JSON se o header indicar JSON ou se o texto aparenta JSON
    if (ct.includes('application/json') || (t.startsWith('{') || t.startsWith('['))){
      try { return t ? JSON.parse(t) : null; } catch(_){ /* retorna null se não for JSON válido */ return null; }
    }
    // conteúdo não-JSON (ex.: "OK"), devolve null para indicar ausência de payload
    return null;
  }

  // POST tolerante a CORS (não precisa ler a resposta)
  async function postTolerant(url, payload){
    try{
      const resp = await fetch(url, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
        mode: 'cors',
      });
      return resp;
    }catch(_){ return null; }
  }

  // POST sem CORS (não lê resposta). Útil em dev quando o servidor não envia headers CORS.
  async function postNoCors(url, payload){
    try{
      const resp = await fetch(url, {
        method:'POST',
        // text/plain evita preflight e segue "simple request"
        headers:{ 'Content-Type':'text/plain;charset=UTF-8', 'Accept': '*/*' },
        body: JSON.stringify(payload),
        mode: 'no-cors',
      });
      return resp; // resposta opaca; tratamos como sucesso de envio
    }catch(_){ return null; }
  }

  // Envio de arquivo (CSV) como multipart/form-data
  async function postFile(url, file, extra){
    const fd = new FormData();
    // Envia tipo de ação explicitamente
    fd.append('action', (extra && extra.action) ? String(extra.action) : 'import_csv');
    fd.append('file', file, file && file.name ? file.name : 'import.csv');
    // Campos extras opcionais
    if (extra){
      for (const [k,v] of Object.entries(extra)){
        if (k === 'action') continue;
        if (v == null) continue;
        try { fd.append(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch(_){}
      }
    }
    const resp = await fetch(url, { method:'POST', body: fd, mode:'cors' });
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    return resp;
  }
  async function postFileTolerant(url, file, extra){
    try{ return await postFile(url, file, extra); }
    catch(_){ return null; }
  }

  async function postFileNoCors(url, file, extra){
    try{
      const fd = new FormData();
      fd.append('action', (extra && extra.action) ? String(extra.action) : 'import_csv');
      fd.append('file', file, file && file.name ? file.name : 'import.csv');
      const resp = await fetch(url, { method:'POST', body: fd, mode:'no-cors' });
      return resp;
    }catch(_){ return null; }
  }

  // ===== Single-flight guard (uma requisição por ação por vez) =====
  const __inFlightActions = new Map();
  function withSingleFlight(action, taskFn){
    const key = String(action||'__generic');
    const existing = __inFlightActions.get(key);
    if (existing) return existing;
    const p = (async()=>{
      try { return await taskFn(); }
      finally { __inFlightActions.delete(key); }
    })();
    __inFlightActions.set(key, p);
    return p;
  }

  // Envia ação JSON para o webhook unificado com fallback aos externos
  async function sendUnifiedAction(payload){
    const act = (payload && payload.action) ? String(payload.action).toLowerCase() : 'unknown';
    const buildQuery = (base, obj)=>{
      const p = Object.entries(obj||{})
        .filter(([k,v])=> v !== undefined)
        .map(([k,v])=> `${encodeURIComponent(k)}=${encodeURIComponent(typeof v==='string'? v: JSON.stringify(v))}`)
        .join('&');
      return base + (base.includes('?')? '&':'?') + p;
    };
    return withSingleFlight(act, async ()=>{
      const bases = resolveUnifiedBases();
      let lastErr = null;
      const isWrite = /^(edit|add|delete|import_csv|update|upsert)$/i.test(act);
      const isEdit = act === 'edit';
      for (const base of bases){
        const url = buildQuery(base, payload);
        // Requisito: EDIT deve ser enviado na query (GET) com todos os campos
        if (isEdit){
          try{
            const resp = await fetch(url, { method:'GET', headers:{ 'Accept':'application/json' } });
            let data = null;
            try{
              const ct = (resp.headers.get('content-type')||'').toLowerCase();
              const txt = await resp.text();
              if (ct.includes('application/json') || (/^\s*[\[{]/.test(txt))) data = txt ? JSON.parse(txt) : null;
            }catch(_){ data = null; }
            dlog('send edit GET (query)', { url, status: resp.status });
            // Retorna mesmo em HTTP 500/erro — fluxo pode ter aplicado no backend
            return { primary:true, data, url, mode:'cors', method:'GET' };
          }catch(err){
            console.error(`Erro no EDIT (GET query) ${url}:`, err);
            // Sucesso otimista: consideramos enviado
            return { primary:false, data:null, url, mode:'get-optimistic', method:'GET' };
          }
        }
        try{
          const data = await fetchJSON(url, { method:'GET' });
          dlog('send action GET (single)', { action: act, url });
          dlog('action response (single)', { action: act, url, body: dbgPreview(data) });
          return { primary:true, data, url, mode:'cors', method:'GET' };
        } catch (err){
          console.error(`Erro no endpoint ${url}:`, err);
          lastErr = err;
          // Para ações de escrita, tenta POST como fallback mesmo em 5xx (muitos fluxos aplicam mas retornam 500)
          const shouldPost = isWrite || /HTTP\s+(404|405)/i.test(String(err && err.message));
          if (!shouldPost) continue;
          try{
            dlog('send action POST fallback', { action: act, base });
            const data = await fetchJSON(base, { method:'POST', body: JSON.stringify(payload) });
            return { primary:true, data, url: base, mode:'cors', method:'POST' };
          }catch(postErr){
            console.error(`Erro no POST ${base}:`, postErr);
            lastErr = postErr;
            // Último recurso: no-cors POST (otimista) para gravações
            if (isWrite){
              try{
                const resp = await postNoCors(base, payload);
                if (resp){
                  dlog('send action POST no-cors fallback (optimistic success)', { action: act, base });
                  return { primary:false, data:null, url: base, mode:'no-cors', method:'POST' };
                }
              }catch(ncErr){ console.error('no-cors fallback falhou', ncErr); lastErr = ncErr; }
            }
            continue;
          }
        }
      }
      throw lastErr || new Error(`Nenhum endpoint respondeu para ação: ${payload && payload.action}`);
    });
  }

  // Envia arquivo (CSV) para o unificado com fallback aos externos
  async function sendUnifiedFileAction(file, extra){
    return withSingleFlight('import_csv', async ()=>{
      const base = resolveUnifiedBase();
      const r = await postFile(base, file, extra||{ action:'import_csv' });
      if (r && r.ok) return { primary:true };
      throw new Error('Falha ao enviar arquivo');
    });
  }

  async function loadList(){
    showLoading('Atualizando lista…'); setButtonLoading($('btn-refresh'), true);
    // 1) Tenta cache e renderiza rápido
    const cached = loadCache();
    if (cached){ data = cached; render(); }
    setDataSource({ method:'cache', url:'', label:'cache' });

    // 2) Busca servidor (uma única requisição GET)
    try{
      const res = await withSingleFlight('list', async ()=>{
        const bases = resolveUnifiedBases();
        let lastErr = null;
        for (const base of bases){
          const url = base + (base.includes('?') ? '&' : '?') + 'action=list';
          try{
            const arr = await fetchJSON(url, { method:'GET' });
            setDataSource({ method:'GET', url, label:`GET: ${shortUrl(url)}` });
            return arr;
          }catch(err){
            lastErr = err;
            if (!/HTTP\s+(404|405)/i.test(String(err && err.message))) continue;
            try{
              const arr = await fetchJSON(base, { method:'POST', body: JSON.stringify({ action:'list' }) });
              setDataSource({ method:'POST', url: base, label:`POST: ${shortUrl(base)}` });
              return arr;
            }catch(postErr){ lastErr = postErr; continue; }
          }
        }
        throw lastErr || new Error('Sem endpoint disponível');
      });
      const list = normalizeList(res);
      const normalized = unifyRecords(list);
      data = normalized;
      saveCache(normalized);
      render();
      populateEstadoOptions();
    }catch(err){
      console.warn('Falha ao listar. Mantendo cache/local se existir.', err);
      if (!cached){ data = []; render(); }
    } finally { hideLoading(); setButtonLoading($('btn-refresh'), false); }
  }

  // Apenas lê do cache e renderiza, sem chamadas ao servidor
  function loadFromCacheOnly(){
    const cached = loadCache();
    if (cached){ data = unifyRecords(cached); }
    setDataSource({ method:'cache-only', url:'', label:'cache' });
    render();
    populateEstadoOptions();
  }

  function normalizeList(raw){
    try{
      if (Array.isArray(raw)) return raw;
      if (!raw || typeof raw !== 'object') return [];
      const keys = ['items','astronomos','astronomers','data','records','rows','list','result','payload','response'];
      for (const k of keys){ if (Array.isArray(raw[k])) return raw[k]; }
      // Alguns webhooks retornam a lista como string JSON
      if (typeof raw.body === 'string'){
        try{ const j = JSON.parse(raw.body); if (Array.isArray(j)) return j; for (const k of keys){ if (Array.isArray(j[k])) return j[k]; } }catch(_){ }
      }
      // Caso venha um único registro
      const sampleKeys = ['usuario','nome_completo','cidade_base','estado','email'];
      const hasRecordShape = sampleKeys.some(k => k in raw);
      if (hasRecordShape) return [raw];
      return [];
    }catch(_){ return []; }
  }

  function extractSingle(raw){
    try{
      const keys = ['record','item','astronomo','astronomer'];
      if (Array.isArray(raw) && raw.length===1 && looksLikeRecord(raw[0])) return raw[0];
      if (raw && typeof raw==='object'){
        for (const k of keys){ if (raw[k] && typeof raw[k]==='object') return raw[k]; }
        if (Array.isArray(raw.data) && raw.data.length===1 && looksLikeRecord(raw.data[0])) return raw.data[0];
        if (Array.isArray(raw.items) && raw.items.length===1 && looksLikeRecord(raw.items[0])) return raw.items[0];
      }
      return null;
    }catch(_){ return null; }
  }
  function looksLikeRecord(o){ if (!o || typeof o!=='object') return false; const req=['usuario','nome_completo','cidade_base','estado']; return req.some(k=> k in o); }
  function ensureRecordId(o){ if (!o) return o; if (o.id_astronomo==null || o.id_astronomo===''){ o.id_astronomo = String(Date.now())+'_'+Math.floor(Math.random()*1000); } return o; }

  // Garante chaves padronizadas (especialmente id_astronomo) para operações de edição
  function unifyRecord(r){
    try{
      const o = { ...r };
      // Normaliza id_astronomo a partir de variações comuns, sem alterar outros campos
      o.id_astronomo = o.id_astronomo ?? o.id ?? o.ID_ASTRONOMO ?? o.Id ?? o.ID ?? null;
      return o;
    }catch(_){ return r; }
  }
  function unifyRecords(list){
    try{
      let i = 0;
      return Array.isArray(list)
        ? list.map((r)=>{
            const o = unifyRecord(r) || {};
            // __cid interno para mapear ações mesmo quando id_astronomo é nulo
            if (!o.__cid) { o.__cid = (o.id_astronomo!=null && o.id_astronomo!=='') ? `id:${o.id_astronomo}` : `cid:${Date.now()}:${i++}`; }
            return o;
          })
        : [];
    }catch(_){ return Array.isArray(list)? list: []; }
  }

  function applyFilters(list){
    let xs = Array.isArray(list)? list: [];
    if (filters.estado){ xs = xs.filter(r => String(r.estado||'').toLowerCase() === String(filters.estado).toLowerCase()); }
    if (filters.cidade){ const t=filters.cidade.toLowerCase(); xs = xs.filter(r => String(r.cidade_base||'').toLowerCase().includes(t)); }
    if (filters.busca){ const q=filters.busca.toLowerCase(); xs = xs.filter(r => String(r.nome_completo||'').toLowerCase().includes(q) || String(r.usuario||'').toLowerCase().includes(q)); }
    return xs;
  }
  function render(){
    const filtered = applyFilters(data);
    const total = data.length; const totalFiltered = filtered.length;
    totalEl.textContent = `Total: ${total} astrônomos${totalFiltered!==total? ` • Filtrados: ${totalFiltered}`:''}`;
    if (!filtered.length){
      tbody.innerHTML = '<tr><td colspan="16" style="padding:12px; color: var(--muted); text-align:center;">Nenhum dado carregado ou filtros sem resultados.</td></tr>';
      updatePagination(0,0);
      return;
    }
    const ps = Math.max(1, Number(pageSize)||20);
    const maxPage = Math.max(1, Math.ceil(filtered.length / ps));
    if (page>maxPage) page=maxPage;
    const start = (page-1)*ps; const end = start + ps;
    const slice = filtered.slice(start, end);
    tbody.innerHTML = slice.map(buildRow).join('');
    updatePagination(page, maxPage);
  }

  function updatePagination(cur, max){
    if (pageInfo) pageInfo.textContent = `${Math.max(1,cur)} / ${Math.max(1,max)}`;
    if (prevPageBtn) prevPageBtn.disabled = cur<=1;
    if (nextPageBtn) nextPageBtn.disabled = cur>=max;
  }

  function setDataSource(info){ dataSource = info||{method:'cache',url:'',label:'cache'}; try{ if (sourceEl) sourceEl.textContent = `Fonte: ${dataSource.label||'—'}`; }catch(_){ } }
  function shortUrl(u){ try{ const o=new URL(u, location.href); return o.host + o.pathname; }catch(_){ return u; } }
  function dbgPreview(v){
    try{
      if (Array.isArray(v)) return { type:'array', length: v.length, sample: v[0] };
      if (v && typeof v==='object'){
        const out = {}; let i=0; for (const k of Object.keys(v)){ if (i++>12) break; out[k]=v[k]; }
        return out;
      }
      return v;
    }catch(_){ return v; }
  }

  // Buscar lista somente do cache local (sem chamadas ao servidor)
  // Política: só enviamos action=list quando o usuário clicar em "Atualizar".
  async function fetchListForVerify(){
    try{
      const cached = loadCache();
      const list = Array.isArray(cached) ? cached : [];
      return unifyRecords(list);
    }catch(_){ return []; }
  }

  // ===== Coordenadas via Nominatim =====
  async function lookupCoordsForCityUF(city, uf){
    // Primeiro tenta cache
    const cached = getCachedCoords(city, uf);
    if (cached){ dlog('coords cache hit', { city, uf, cached }); return cached; }
    try{
      const q = `${String(city||'').trim()}, ${String(uf||'').trim()}, Brasil`;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(q)}&addressdetails=1`;
      dlog('coords fetch', { url });
      const resp = await fetch(url, { method:'GET', headers:{ 'Accept':'application/json' } });
      if (!resp.ok) return null;
      const arr = await resp.json(); dlog('coords fetch ok', { results: Array.isArray(arr)? arr.length: 0 });
      if (!Array.isArray(arr) || !arr.length) return null;
      const item = arr[0];
      const lat = item && (item.lat!=null ? String(item.lat) : null);
      const lon = item && (item.lon!=null ? String(item.lon) : null);
      if (!lat || !lon) return null;
      // salva no cache
      setCachedCoords(city, uf, lat, lon);
      dlog('coords fetched', { city, uf, lat, lon });
      return { lat, lon };
    }catch(_){ return null; }
  }

  let __coordLookupTimer = null;
  function attachCoordLookupHandlers(cidadeEl, ufEl, latEl, lonEl){
    const doLookup = async ()=>{
      const cidade = cidadeEl && cidadeEl.value ? cidadeEl.value.trim() : '';
      const uf = ufEl && ufEl.value ? ufEl.value.trim() : '';
      if (!cidade || !uf) return;
      // Primeiro tenta cache sem overlay
      const c = getCachedCoords(cidade, uf);
      if (c){ dlog('auto-lookup cache fill', { cidade, uf, c }); if (latEl) latEl.value=c.lat; if (lonEl) lonEl.value=c.lon; return; }
      showLoading('Buscando coordenadas…');
      try{
        dlog('auto-lookup fetch', { cidade, uf });
        const r = await lookupCoordsForCityUF(cidade, uf);
        if (r){ if (latEl) latEl.value = r.lat; if (lonEl) lonEl.value = r.lon; }
        else { notify('info', 'Não foi possível localizar coordenadas para esta cidade/UF'); }
      }catch(_){ notify('error', 'Falha ao consultar coordenadas'); }
      finally{ hideLoading(); }
    };
    const schedule = ()=>{
      if (__coordLookupTimer) clearTimeout(__coordLookupTimer);
      __coordLookupTimer = setTimeout(doLookup, 250);
    };
    try{ cidadeEl && cidadeEl.addEventListener('input', schedule); }catch(_){ }
    try{ ufEl && ufEl.addEventListener('input', schedule); }catch(_){ }
    try{ cidadeEl && cidadeEl.addEventListener('change', doLookup); }catch(_){ }
    try{ ufEl && ufEl.addEventListener('change', doLookup); }catch(_){ }
    try{ cidadeEl && cidadeEl.addEventListener('blur', schedule); }catch(_){ }
    try{ ufEl && ufEl.addEventListener('blur', schedule); }catch(_){ }
    try{
      const btn = $('btn-lookup-coords');
      btn && btn.addEventListener('click', doLookup);
    }catch(_){ }
    // Auto-disparo imediato se já houver valores e coordenadas vazias
    try{
      if (cidadeEl && ufEl && latEl && lonEl){
        const hasCity = String(cidadeEl.value||'').trim() !== '';
        const hasUf = String(ufEl.value||'').trim() !== '';
        const hasCoords = String(latEl.value||'').trim() !== '' && String(lonEl.value||'').trim() !== '';
        if (hasCity && hasUf && !hasCoords) { doLookup(); }
      }
    }catch(_){ }
  }

  function populateEstadoOptions(){
    if (!filterEstado) return;
    try{
      // Normaliza valores para evitar duplicatas por diferença de caixa/acentos
      const normKey = (s)=>{
        try{ return String(s||'').trim().normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase(); }
        catch(_){ return String(s||'').trim().toLowerCase(); }
      };
      const displayLabel = (s)=>{
        const t = String(s||'').trim();
        if (t.length <= 3) return t.toUpperCase();
        return t.charAt(0).toUpperCase() + t.slice(1);
      };
      const map = new Map(); // norm -> { value, label }
      (data||[]).forEach(r=>{
        const raw = String(r.estado||'').trim();
        if (!raw) return;
        const k = normKey(raw);
        if (!map.has(k)) map.set(k, { value: raw, label: displayLabel(raw) });
      });
      const cur = filterEstado.value;
      const options = Array.from(map.values()).sort((a,b)=> a.label.localeCompare(b.label, 'pt-BR'))
        .map(({value,label})=>`<option value="${value}">${label}</option>`).join('');
      filterEstado.innerHTML = '<option value="">Todos</option>' + options;
      if (cur){
        const curKey = normKey(cur);
        const found = Array.from(map.values()).find(x => normKey(x.value) === curKey);
        filterEstado.value = found ? found.value : '';
      }
      // Atualiza a UI custom
      try{ UISelect.refresh(filterEstado); }catch(_){ }
    }catch(_){ }
  }

  // Notificações simples usando estilos .toast (presentes em css/style.css)
  function notify(type, message){
    try{
      const el = document.createElement('div');
      el.className = 'toast';
      el.style.zIndex = 1600;
      el.innerHTML = `<span class="toast-icon">${type==='success'?'✅': type==='error'?'⚠️':'ℹ️'}</span>
        <span class="toast-message">${String(message||'')}</span>
        <button class="toast-close" aria-label="Fechar">×</button>`;
      const close = ()=>{ try{ el.remove(); }catch(_){ } };
      el.querySelector('.toast-close')?.addEventListener('click', close);
      document.body.appendChild(el);
      setTimeout(close, 3200);
    }catch(_){ }
  }

  function readForm(){
    const o = {};
    fields.forEach(f => {
      const el = $(f);
      if (!el) return;
      const val = (el.value != null) ? String(el.value).trim() : '';
      if (el.type === 'number' && val !== ''){
        const n = parseFloat(val.replace(',', '.'));
        o[f] = Number.isFinite(n) ? n : 0;
      } else {
        o[f] = val;
      }
    });
    return o;
  }

  function computeChangedPatch(oldRow, payload){
    const ignoreSend = new Set(['__cid']);
    const changed = {};
    const old = oldRow || {};
    for (const [k, v] of Object.entries(payload||{})){
      if (ignoreSend.has(k)) continue;
      const nv = normVal(v);
      const ov = normVal(old[k]);
      // Considera nulos/indefinidos como vazios, mas não envia quando nv=''
      if (nv !== ov && !(nv === '' && (ov === '' || ov === null || ov === undefined))){
        changed[k] = v;
      }
    }
    return changed;
  }

  async function save(){
    const payload = readForm();
    try{ console.log('Iniciando save, editingCid:', editingCid); console.log('Payload:', payload); console.log('Row encontrada:', data.find(r=> String(r.__cid)===String(editingCid))); }catch(_){ }
    try{
      showLoading('Salvando astrônomo…'); setButtonLoading($('modal-save'), true);
      if (editingCid!=null){
        const row = data.find(r=> String(r.__cid)===String(editingCid));
        const idToSend = payload.id_astronomo || (row && row.id_astronomo) || null;
        const patch = computeChangedPatch(row, payload);
        if (!Object.keys(patch).length){ notify('info','Nenhuma alteração detectada'); closeModal(); hideLoading(); setButtonLoading($('modal-save'), false); return; }
        // Enviar TODOS os dados do astrônomo no EDIT (não apenas o patch)
        // Monta um objeto completo com os campos do formulário, garantindo id_astronomo
        const fullRecord = (function(){
          const o = {};
          try{
            // Usa a lista "fields" do formulário como referência daquilo que o backend espera
            (fields||[]).forEach(k=>{ o[k] = payload[k]; });
            // Garante o id
            o.id_astronomo = idToSend;
            // Remove metadados internos
            delete o.__cid;
          }catch(_){ }
          return o;
        })();
        const bodyEdit = { action: 'edit', ...fullRecord };
        // Guarda patch como pendente para confirmação
        const pendingId = idToSend || editingCid;
        const res = await sendUnifiedAction(bodyEdit);
        dlog('edit action result', { endpoint: res && res.url, mode: res && res.mode, returned: !!(res && res.data), body: dbgPreview(res && res.data) });
        // Tenta extrair o registro do servidor para confirmar
        const rec = res && res.primary && res.data ? (unifyRecord(extractSingle(res.data))||null) : null;
        if (rec){
          const patchToCompare = Object.assign({}, patch);
          delete patchToCompare.senha_usuario; // senha pode não vir/vir mascarada
          const diffs = diffAgainstPatch(patchToCompare, rec);
          if (!diffs.length){
            // Confirma: atualiza local com o que veio do servidor
            data = data.map(x => String(x.__cid) === String(editingCid) ? { ...x, ...rec } : x);
            saveCache(data);
            notify('success', 'Astrônomo editado com sucesso');
            clearPendingEdit(pendingId);
          } else {
            // Não confirma: mostra diferenças, mantém dados locais antigos
            const msg = 'Servidor retornou valores diferentes em: ' + diffs.slice(0,5).map(d=> `${d.field} (enviado: "${d.expected}" | recebido: "${d.got}")`).join('; ');
            notify('error', msg);
          }
        } else {
          // Sem corpo: atualiza com os dados enviados (fallback otimista)
          data = data.map(x => String(x.__cid) === String(editingCid) ? { ...x, ...fullRecord } : x);
          saveCache(data);
          notify('info', 'Alteração enviada (sem retorno do servidor)');
        }
        // Finaliza UI
        closeModal();
        setDataSource({ method:'cache', url:'', label:'cache' });
        page = 1; render(); populateEstadoOptions();
      } else {
        const bodyAdd = { action: 'add', ...payload };
        let rec = null;
        const res = await sendUnifiedAction(bodyAdd);
        dlog('add action result', { endpoint: res && res.url, mode: res && res.mode, returned: !!(res && res.data), body: dbgPreview(res && res.data) });
        const maybe = res && res.primary && res.data ? extractSingle(res.data) : null;
        rec = maybe || { ...payload };
        if (!rec.__cid) rec.__cid = `cid:${Date.now()}:${Math.random().toString(36).slice(2,7)}`;
        data.push(rec);
        saveCache(data);
        notify('success', 'Astrônomo adicionado com sucesso');
      }
      closeModal();
      setDataSource({ method:'cache', url:'', label:'cache' });
      page = 1; render(); populateEstadoOptions();
    }catch(err){ notify('error', 'Falha ao salvar: ' + (err && err.message ? err.message : 'Erro desconhecido')); console.error('Erro ao salvar:', err); }
    finally { hideLoading(); setButtonLoading($('modal-save'), false); }
  }

  async function remove(id){
    if (!confirm('Confirma remover este astrônomo?')) return;
    try{
      showLoading('Removendo…');
      // id aqui será o __cid (data-id do botão)
      const row = data.find(r=> String(r.__cid)===String(id));
      const payload = { action: 'delete', id_astronomo: row && row.id_astronomo };
      const res = await sendUnifiedAction(payload);
      dlog('delete action result', { endpoint: res && res.url, mode: res && res.mode, returned: !!(res && res.data) });
      // Remove local também
      data = data.filter(x => String(x.__cid) !== String(id));
      saveCache(data);
      render();
      notify('success', 'Astrônomo removido com sucesso');
      setDataSource({ method:'cache', url:'', label:'cache' });
      page = 1; render(); populateEstadoOptions();
    }catch(err){ notify('error', 'Falha ao remover.'); console.error(err); }
    finally { hideLoading(); }
  }

  function exportCSV(){
    const headers = ['id_astronomo','assistant_id','usuario','senha_usuario','nome_completo','cidade_base','estado','telefone','email','veiculo','consumo_km_l','combustivel','valor_litro','diaria_hospedagem','alimentacao_diaria','monitor','pedagios'];
    const rows = [headers.join(',')].concat(data.map(r=> headers.map(h=> {
      let v = r[h]; if (v==null) v=''; v = String(v).replace(/"/g,'""'); return '"'+v+'"';
    }).join(',')));
    const blob = new Blob([rows.join('\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='astronomos.csv'; a.click(); URL.revokeObjectURL(url);
  }

  // ===== CSV: leitura, geocodificação e enriquecimento =====
  function parseCsv(text){
    const rows = [];
    let i=0, field='', row=[], inQuotes=false;
    while(i<text.length){
      const ch = text[i++];
      if (inQuotes){
        if (ch === '"'){
          if (text[i] === '"'){ field += '"'; i++; }
          else { inQuotes = false; }
        } else { field += ch; }
      } else {
        if (ch === '"'){ inQuotes = true; }
        else if (ch === ','){ row.push(field); field=''; }
        else if (ch === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
        else if (ch === '\r'){ /* ignore */ }
        else { field += ch; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function toCsv(rows){
    return rows.map(cols => cols.map(v=>{
      const s = v==null? '': String(v);
      if (/[,"\n\r]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
      return s;
    }).join(',')).join('\n');
  }

  async function enrichCsvWithCoords(file){
    try{
      dlog('csv import selected', { name: file && file.name, size: file && file.size });
      const text = await file.text();
      const rows = parseCsv(text);
      dlog('csv parsed rows', rows.length);
      if (!rows.length) { dlog('csv empty'); return null; }
      const header = rows[0].map(h=>String(h||'').trim());
      // Normalizador de cabeçalhos: minúsculas, sem acentos/pontuação extra
      const norm = (s)=> String(s||'')
        .normalize('NFD').replace(/\p{Diacritic}+/gu,'')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g,' ');
      const headerNorm = header.map(norm);
      const dataRows = rows.slice(1).filter(r=> r.some(c=> String(c||'').trim()!==''));
      dlog('csv data rows', dataRows.length);
      // Detecta Cidade Base
      let idxCidade = header.findIndex(h=> /cidade_base/i.test(h));
      if (idxCidade < 0){
        idxCidade = headerNorm.findIndex(h => h.includes('cidade base') || (h.includes('cidade') && (h.includes('base') || h.includes('origem'))));
      }
      // Detecta Estado (UF)
      let idxEstado = header.findIndex(h=> /^estado$/i.test(h));
      if (idxEstado < 0){
        idxEstado = headerNorm.findIndex(h => h === 'estado' || h.includes('estado') || /\buf\b/.test(h));
      }
      dlog('csv header idx', { idxCidade, idxEstado, header, headerNorm });
      // localizar coluna de id do astrônomo (aceita variações)
      const idCols = ['id_astronomo','ID_ASTRONOMO','id','ID','astronomer_id'];
      let idxId = -1; let idColName = '';
      for (const name of idCols){ const i = header.findIndex(h=> h === name); if (i>=0){ idxId=i; idColName=name; break; } }
      if (idxId < 0){
        // Tenta variantes normalizadas (e.g., "id do astronomo", "astronomo id")
        idxId = headerNorm.findIndex(h => /\bid\b.*\bastronom/.test(h) || /\bastronom.*\bid\b/.test(h));
        if (idxId>=0) idColName = header[idxId];
      }
      if (idxCidade<0 || idxEstado<0 || idxId<0){
        throw new Error('CSV precisa conter as colunas: cidade_base, estado e id_astronomo (ou equivalente)');
      }
      dlog('csv id column', { idxId, idColName });
      let idxLat = header.findIndex(h=> /origem_lat/i.test(h));
      let idxLon = header.findIndex(h=> /origem_lon/i.test(h));
      const addLatLon = (idxLat<0 || idxLon<0);
      if (idxLat<0){ header.push('origem_lat'); idxLat = header.length-1; }
      if (idxLon<0){ header.push('origem_lon'); idxLon = header.length-1; }

      const comboMap = new Map(); // key => {lat,lon}
      const uniqueCombos = [];
      for (const r of dataRows){
        const cidade = String(r[idxCidade]||'').trim();
        const uf = String(r[idxEstado]||'').trim();
        const idVal = String(r[idxId]||'').trim();
        if (!idVal){ throw new Error('Há linhas no CSV sem id do astrônomo'); }
        if (!cidade || !uf) continue;
        const key = `${cidade}|${uf}`;
        if (!comboMap.has(key)) {
          // preenche com cache se existir
          const cached = getCachedCoords(cidade, uf);
          if (cached) { comboMap.set(key, cached); }
          else { comboMap.set(key, null); uniqueCombos.push({key, cidade, uf}); }
        }
      }
      dlog('csv unique combos', uniqueCombos.length);

      // Consulta sequencial apenas para combos sem cache (respeito ao serviço público do Nominatim)
      for (let i=0;i<uniqueCombos.length;i++){
        const {key, cidade, uf} = uniqueCombos[i];
        const fromCache = getCachedCoords(cidade, uf);
        if (fromCache){ comboMap.set(key, fromCache); continue; }
        dlog('csv coords fetch', { cidade, uf });
        const coords = await lookupCoordsForCityUF(cidade, uf);
        if (coords){ comboMap.set(key, coords); setCachedCoords(cidade, uf, coords.lat, coords.lon); }
        // intervalo curto para evitar agressividade
        await new Promise(r=>setTimeout(r, 650));
      }
      // salva cache atualizado
      saveCoordsCache(coordsCache);

      // garantir coluna padronizada id_astronomo
      let idxIdAstronomo = header.findIndex(h=> h === 'id_astronomo');
      const needIdAstronomo = idxIdAstronomo < 0;
      if (needIdAstronomo){ header.push('id_astronomo'); idxIdAstronomo = header.length-1; }

      const outRows = [header.slice()];
      for (const r of dataRows){
        const row = r.slice();
        if ((addLatLon || needIdAstronomo) && row.length < header.length){
          // garante tamanho
          while(row.length < header.length) row.push('');
        }
        if (needIdAstronomo){ row[idxIdAstronomo] = row[idxId]; }
        const cidade = String(row[idxCidade]||'').trim();
        const uf = String(row[idxEstado]||'').trim();
        const key = `${cidade}|${uf}`;
        const coords = comboMap.get(key);
        if (coords){
          if (!row[idxLat]) row[idxLat] = coords.lat;
          if (!row[idxLon]) row[idxLon] = coords.lon;
        }
        outRows.push(row);
      }

      const csv = toCsv(outRows);
      dlog('csv enriched rows', outRows.length);
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
      try{
        const enrichedFile = new File([blob], (file && file.name? file.name.replace(/\.csv$/i,'') : 'astronomos') + '-enriquecido.csv', { type: blob.type });
        dlog('csv enriched file', { name: enrichedFile.name, size: enrichedFile.size });
        return enrichedFile;
      }catch(_){
        // browsers sem File()
        blob.name = 'astronomos-enriquecido.csv';
        dlog('csv enriched blob', { name: blob.name, size: blob.size });
        return blob;
      }
    }catch(err){ dlog('csv enrich failed', String((err&&err.message)||err)); return null; }
  }

  // Eventos UI
  document.addEventListener('DOMContentLoaded', ()=>{
    // Debug toggle & panel
    $('btn-debug')?.addEventListener('click', ()=>{ const cur=getDebugEnabled(); setDebugEnabled(!cur); alert('Debug '+(!cur?'ativado':'desativado')+' — recarregando'); location.reload(); });
    if (getDebugEnabled()) ensureDebugPanel();

    $('btn-refresh')?.addEventListener('click', loadList);
    clearCacheBtn?.addEventListener('click', ()=>{ try{ clearCache(); setDataSource({method:'cache',url:'',label:'limpo'}); }catch(_){ } render(); });
    filterEstado?.addEventListener('change', ()=>{ filters.estado = filterEstado.value || ''; page=1; render(); });
    filterCidade?.addEventListener('input', ()=>{ filters.cidade = filterCidade.value || ''; page=1; render(); });
    filterBusca?.addEventListener('input', ()=>{ filters.busca = filterBusca.value || ''; page=1; render(); });
    pageSizeSel?.addEventListener('change', ()=>{ pageSize = Math.max(1, Number(pageSizeSel.value)||20); page=1; render(); });
    prevPageBtn?.addEventListener('click', ()=>{ if (page>1){ page--; render(); } });
    nextPageBtn?.addEventListener('click', ()=>{ page++; render(); });
    $('btn-export')?.addEventListener('click', exportCSV);
    // Import CSV (envia arquivo inteiro ao webhook) — inclui action=import_csv
    $('btn-import')?.addEventListener('click', ()=> $('file-import')?.click());
    $('file-import')?.addEventListener('change', async (e)=>{
      const f = e.target.files && e.target.files[0]; if (!f) return;
      showLoading('Validando e enriquecendo CSV…');
      try{
        const enriched = await enrichCsvWithCoords(f);
        if (!enriched) throw new Error('Falha na validação do CSV');
        const fileToSend = enriched;
        const r = await sendUnifiedFileAction(fileToSend, { action:'import_csv' });
        dlog('import_csv action result', { endpoint: r && r.url, mode: r && r.mode });
        notify('success', 'CSV validado e enviado com sucesso');
      }catch(err){ console.error(err); notify('error', 'Falha ao validar/enviar o CSV'); }
      finally{ hideLoading(); }
      e.target.value = '';
    });
    $('btn-novo')?.addEventListener('click', ()=> openModal(false, null));
    $('modal-close')?.addEventListener('click', closeModal);
    $('modal-cancel')?.addEventListener('click', closeModal);
    form?.addEventListener('submit', (e)=>{ e.preventDefault(); save(); });

    tbody?.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id'); // agora é __cid
      const row = data.find(x=> String(x.__cid)===String(id));
      const action = btn.getAttribute('data-action');
      if (action==='edit' && row){ openModal(true, row); }
      if (action==='del' && id){ remove(id); }
    });

    // Máscaras/validações simples do formulário
    try{
      const tel = $('telefone');
      tel?.addEventListener('input', ()=>{
        const d = (tel.value||'').replace(/\D/g,'').slice(0,11);
        if (d.length<=10) tel.value = d.replace(/(\d{0,2})(\d{0,4})(\d{0,4}).*/, (m,a,b,c)=> [a&&`(${a}`, a&&') ', b, b&&'-', c].filter(Boolean).join(''));
        else tel.value = d.replace(/(\d{0,2})(\d{0,5})(\d{0,4}).*/, (m,a,b,c)=> [a&&`(${a}`, a&&') ', b, b&&'-', c].filter(Boolean).join(''));
      });
      const email = $('email');
      form?.addEventListener('submit', (ev)=>{
        const em = (email?.value||'').trim();
        if (em && !/.+@.+\..+/.test(em)){ ev.preventDefault(); notify('error','E-mail inválido'); return false; }
        return true;
      });
    }catch(_){ }

    // Inicial: apenas do cache, sem buscar no servidor
    loadFromCacheOnly();

    // Aplica melhoria visual aos selects principais
    try{ UISelect.enhance(document.querySelectorAll('.summary-card select')); }catch(_){ }
  });

  // (Import CSV sem parsing: o servidor n8n processa o arquivo.)
})();
