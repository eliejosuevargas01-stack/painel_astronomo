(function(){
  const $ = (sel)=> document.querySelector(sel);
  const statusEl = $('#cc-status');
  const resultEl = $('#cc-result'); // legado (usado em modo coords)
  const eventsListEl = document.getElementById('cc-events-list');
  const orResultEl = document.getElementById('cc-or-result');
  const urlInput = $('#cc-webhook-url');
  const jsonInput = $('#cc-json');
  const userInput = $('#cc-usuario');

  function setStatus(msg, cls){
    statusEl.textContent = msg || '';
    statusEl.className = 'cc-status ' + (cls||'');
  }

  function parseNum(v){
    if (v == null) return NaN; if (typeof v === 'number') return v;
    const s = String(v);
    const m = s.match(/-?\d{1,3}(?:[\.\s]\d{3})*(?:[\.,]\d+)?|-?\d+(?:[\.,]\d+)?/);
    if (!m) return NaN;
    let num = m[0];
    if (num.includes('.') && num.includes(',')) num = num.replace(/\./g,'').replace(',', '.');
    else if (num.includes(',')) num = num.replace(',', '.');
    else num = num.replace(/\s+/g,'');
    const n = Number(num);
    return Number.isFinite(n) ? n : NaN;
  }

  function haversineKm(a, b){
    const toRad = (x)=> x * Math.PI / 180;
    const R = 6371; // km
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat), la2 = toRad(b.lat);
    const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return R * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function buildUrl(base){
    try{
      const u = new URL(base, window.location.origin);
      if (!u.searchParams.get('action')) u.searchParams.set('action','atualizar_agenda');
      const usuario = String((userInput && userInput.value) || '').trim();
      if (usuario) u.searchParams.set('usuario', usuario);
      // Anexa informações essenciais da sessão (sem perfil_*)
      try{
        const raw = localStorage.getItem('astronomo_session');
        if (raw){
          const s = JSON.parse(raw)||{};
          if (!usuario && s.username){ u.searchParams.set('usuario', String(s.username)); u.searchParams.set('username', String(s.username)); }
          if (s.id_astronomo!=null) { u.searchParams.set('id_astronomo', String(s.id_astronomo)); u.searchParams.set('user_id', String(s.id_astronomo)); }
          if (s.assistant_id) u.searchParams.set('assistant_id', String(s.assistant_id));
          if (s.row_number!=null) u.searchParams.set('row_number', String(s.row_number));
          const sid = s.session_id || s.sessionId; if (sid){ u.searchParams.set('session_id', String(sid)); }
        }
      }catch(_){ }
      return u.toString();
    }catch(_){
      const usuario = encodeURIComponent(String((userInput && userInput.value) || '').trim());
      return base + (base.includes('?') ? '&' : '?') + 'action=atualizar_agenda' + (usuario ? `&usuario=${usuario}` : '');
    }
  }

  // Busca cidade → coordenadas via Nominatim (search)
  async function searchCity(cityName){
    const q = String(cityName||'').trim();
    if (!q) throw new Error('Cidade vazia');
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1&accept-language=pt-BR`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error('Falha Nominatim: ' + resp.status);
    const list = await resp.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error('Cidade não encontrada: ' + q);
    const it = list[0];
    return { lat: parseNum(it.lat), lon: parseNum(it.lon), display: it.display_name || q, raw: it };
  }

  async function reverseGeocode(lat, lon){
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json&zoom=10&addressdetails=1&accept-language=pt-BR`;
    const resp = await fetch(url, { headers: { 'Accept':'application/json' } });
    if (!resp.ok) throw new Error('Reverse geocode falhou: ' + resp.status);
    const data = await resp.json();
    const a = (data && data.address) || {};
    const city = a.city || a.town || a.village || a.municipality || a.city_district || a.county || a.state;
    const state = a.state || a.region || '';
    return { city: city || '-', state: state || '-', display: data && data.display_name || '', raw: data };
  }

  // Extração por cidades do payload do n8n
  function extractEvents(payload){
    const arr = [];
    const pushEv = (o)=>{
      if (!o) return;
      const id = String(o.id || o.id_evento || o.event_id || '').trim() || undefined;
      const origem = (o.cidade_origem || o.cidade_base || o.origem || o.cidade_de || o.city_from || '').toString().trim();
      const destino = (o.cidade_destino || o.cidade || o.destino || o.city_to || '').toString().trim();
      const dist = parseNum(o.distancia_km || o.km || o.km_total || o.rota_distancia_km);
      if (origem || destino){ arr.push({ id, origem, destino, dist: Number.isFinite(dist)? dist: undefined }); }
    };

    function walk(x){
      if (!x) return;
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (typeof x === 'string'){
        try{ const j = JSON.parse(x); walk(j); }catch(_){ }
        return;
      }
      if (typeof x === 'object'){
        // evento único
        pushEv(x);
        // arrays comuns
        ['eventos','events','items','data','body','payload','result'].forEach(k=>{ if (x[k]!=null) walk(x[k]); });
      }
    }
    walk(payload);
    return arr;
  }

  function renderEventsList(events){
    if (!eventsListEl) return;
    if (!events || events.length===0){ eventsListEl.innerHTML = '<div class="cc-item">Nenhum evento encontrado.</div>'; return; }
    eventsListEl.innerHTML = events.map((ev,idx)=>{
      const title = `${ev.origem || '-'} → ${ev.destino || '-'}`;
      const sub = [ev.id? `ID: ${ev.id}`: null, Number.isFinite(ev.dist)? `n8n: ${ev.dist} km` : null].filter(Boolean).join(' • ');
      return `<div class="cc-item" data-index="${idx}"><div>${title}</div><div class="small">${sub}</div></div>`;
    }).join('');

    // Clique para comparar automaticamente
    eventsListEl.querySelectorAll('.cc-item').forEach(el=>{
      el.addEventListener('click', async ()=>{
        const i = parseInt(el.getAttribute('data-index'),10);
        const ev = events[i];
        await compareByCities(ev);
      });
    });
  }

  async function compareByCities(ev){
    try{
      if (!ev) return;
      setStatus(`Consultando Nominatim: ${ev.origem} → ${ev.destino} ...`,'');
      const [orig, dest] = await Promise.all([ searchCity(ev.origem), searchCity(ev.destino) ]);
      const km = haversineKm({lat:orig.lat, lon:orig.lon}, {lat:dest.lat, lon:dest.lon});
      const delta = Number.isFinite(ev.dist)? Math.abs(km - ev.dist) : NaN;
      const pct = Number.isFinite(ev.dist) && ev.dist>0 ? (delta/ev.dist)*100 : NaN;
      const ok = Number.isFinite(ev.dist) ? (delta <= 10 || pct <= 15) : true;
      if (orResultEl){
        orResultEl.innerHTML = `
          <div class="cc-box">
            <div class="cc-title">Cidades</div>
            <div class="cc-line"><span>Origem</span><span>${ev.origem}</span></div>
            <div class="cc-line"><span>Destino</span><span>${ev.destino}</span></div>
          </div>
          <div class="cc-box">
            <div class="cc-title">Coordenadas (Nominatim)</div>
            <div class="cc-line"><span>Origem</span><span>${orig.lat.toFixed(5)}, ${orig.lon.toFixed(5)}</span></div>
            <div class="cc-line"><span>Destino</span><span>${dest.lat.toFixed(5)}, ${dest.lon.toFixed(5)}</span></div>
          </div>
          <div class="cc-box">
            <div class="cc-title">Distância</div>
            <div class="cc-line"><span>Calculada (reta)</span><span>${km.toFixed(2)} km</span></div>
            <div class="cc-line"><span>Informada (n8n)</span><span>${Number.isFinite(ev.dist)? ev.dist.toFixed(2):'n/a'} km</span></div>
            <div class="cc-line"><span>Diferença</span><span>${Number.isFinite(delta)? delta.toFixed(2):'n/a'} km ${Number.isFinite(pct)? `(${pct.toFixed(1)}%)`:''}</span></div>
            <div class="cc-line"><span>Validação</span><span class="${ok?'cc-ok':'cc-warn'}">${ok? 'OK (dentro da tolerância)':'Atenção: divergente'}</span></div>
          </div>`;
      }
      setStatus('Comparação concluída.','');
    }catch(e){
      setStatus('Erro na comparação: '+(e&&e.message?e.message:String(e)),'cc-err');
      if (orResultEl) orResultEl.innerHTML = '';
    }
  }

  function extractCoords(payload){
    // String solta? tenta achar padrões via regex
    if (typeof payload === 'string'){
      const found = extractCoordsFromLooseText(payload);
      if (found) return found;
      // tenta parsear JSON novamente se vier com lixo antes/depois
      const m = payload.match(/[\[{][\s\S]*[\]}]/);
      if (m){
        try { const obj = JSON.parse(m[0]); const cand = extractCoords(obj); if (cand) return cand; } catch(_){ }
      }
    }
    // Tenta extrair diretamente
    if (payload && typeof payload === 'object'){
      const cand = tryFromObject(payload);
      if (cand) return cand;
    }
    // Array de objetos
    if (Array.isArray(payload)){
      for (const item of payload){
        const cand = tryFromObject(item);
        if (cand) return cand;
      }
    }
    // Objetos aninhados comuns
    const keys = ['data','body','payload','result','evento','event','events','eventos','items'];
    if (payload && typeof payload === 'object'){
      for (const k of keys){
        if (payload[k] != null){
          const cand = extractCoords(payload[k]);
          if (cand) return cand;
        }
      }
    }
    return null;
  }

  function tryFromObject(obj){
    if (!obj || typeof obj !== 'object') return null;
    const ok = ['origem_lat','origem_lon','destino_lat','destino_lon'];
    const hasAll = ok.every(k => k in obj);
    if (!hasAll) return null;
    const o = {
      origem_lat: parseNum(obj.origem_lat),
      origem_lon: parseNum(obj.origem_lon),
      destino_lat: parseNum(obj.destino_lat),
      destino_lon: parseNum(obj.destino_lon),
      distancia_km: parseNum(obj.distancia_km)
    };
    if ([o.origem_lat,o.origem_lon,o.destino_lat,o.destino_lon].some(n=>!Number.isFinite(n))) return null;
    return o;
  }

  function extractCoordsFromLooseText(text){
    try{
      const s = String(text||'');
      const rxNum = '(-?\\d+(?:[\\.,]\\d+)?)';
      const get = (key)=>{
        const re = new RegExp('"'+key+'"\\s*:\\s*"?'+rxNum+'"?', 'i');
        const m = s.match(re); return m ? parseNum(m[1]) : NaN;
      };
      const olat = get('origem_lat');
      const olon = get('origem_lon');
      const dlat = get('destino_lat');
      const dlon = get('destino_lon');
      if (!Number.isFinite(olat) || !Number.isFinite(olon) || !Number.isFinite(dlat) || !Number.isFinite(dlon)) return null;
      const dist = (function(){ const v = get('distancia_km'); return Number.isFinite(v) ? v : NaN; })();
      return { origem_lat: olat, origem_lon: olon, destino_lat: dlat, destino_lon: dlon, distancia_km: dist };
    }catch(_){ return null; }
  }

  function renderResult(info){
    const { coords, origin, dest, distCalcKm, distN8n } = info;
    const delta = Number.isFinite(distN8n) ? Math.abs(distN8n - distCalcKm) : NaN;
    const percent = Number.isFinite(distN8n) && distN8n>0 ? (delta / distN8n) * 100 : NaN;
    const okDist = Number.isFinite(distN8n) ? (delta <= 10 || (percent <= 15)) : false; // tolerância: 10 km ou 15%

    resultEl.innerHTML = `
      <div class="cc-grid">
        <div class="cc-box">
          <div class="cc-title">Origem</div>
          <div class="cc-line"><span>Cidade</span><span>${(origin.city||'-')} • ${origin.state||''}</span></div>
          <div class="cc-line"><span>Lat, Lon</span><span>${coords.origem_lat.toFixed(6)}, ${coords.origem_lon.toFixed(6)}</span></div>
        </div>
        <div class="cc-box">
          <div class="cc-title">Destino</div>
          <div class="cc-line"><span>Cidade</span><span>${(dest.city||'-')} • ${dest.state||''}</span></div>
          <div class="cc-line"><span>Lat, Lon</span><span>${coords.destino_lat.toFixed(6)}, ${coords.destino_lon.toFixed(6)}</span></div>
        </div>
        <div class="cc-box">
          <div class="cc-title">Distância</div>
          <div class="cc-line"><span>Calculada (reta)</span><span>${distCalcKm.toFixed(2)} km</span></div>
          <div class="cc-line"><span>Informada (n8n)</span><span>${Number.isFinite(distN8n) ? distN8n.toFixed(2) : 'n/a'} km</span></div>
          <div class="cc-line"><span>Diferença</span><span>${Number.isFinite(delta)? delta.toFixed(2):'n/a'} km ${Number.isFinite(percent)? `(${percent.toFixed(1)}%)`:''}</span></div>
          <div class="cc-line"><span>Validação</span><span class="${okDist?'cc-ok': 'cc-warn'}">${okDist? 'OK (diferença dentro da tolerância)': 'Atenção: divergente (rota x linha reta)'}</span></div>
        </div>
      </div>
    `;
  }

  async function verifyFromPayload(payload){
    try{
      setStatus('Processando payload...', '');
      const coords = extractCoords(payload);
      if (!coords) throw new Error('Não foi possível encontrar campos de coordenadas no JSON recebido.');

      const [origin, dest] = await Promise.all([
        reverseGeocode(coords.origem_lat, coords.origem_lon),
        reverseGeocode(coords.destino_lat, coords.destino_lon)
      ]);
      const distCalcKm = haversineKm({lat:coords.origem_lat, lon:coords.origem_lon}, {lat:coords.destino_lat, lon:coords.destino_lon});
      const distN8n = coords.distancia_km;

      renderResult({ coords, origin, dest, distCalcKm, distN8n });
      setStatus('Concluído.', '');
    }catch(e){
      setStatus('Erro: ' + (e && e.message ? e.message : 'falha ao verificar'), 'cc-err');
      resultEl.innerHTML = '';
    }
  }

  async function fetchFromWebhook(){
    try{
      const raw = String(urlInput.value||'').trim();
      if (!raw){ setStatus('Informe a URL do webhook.', 'cc-warn'); return; }
      const usuario = String((userInput && userInput.value)||'').trim();
      setStatus('Consultando webhook' + (usuario? ` • usuário: ${usuario}`:'' ) + '...', '');
      const u = buildUrl(raw);
      const resp = await fetch(u, { headers:{ 'Accept':'application/json' }, cache:'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ct = (resp.headers.get('content-type')||'').toLowerCase();
      const text = await resp.text();
      const trimmed = (text||'').trim();
      let data = null;
      if (!trimmed){
        // corpo vazio — tentar mesmo assim com string vazia para cair no extractor flexível
        data = '';
      } else if (ct.includes('application/json')){
        try { data = JSON.parse(trimmed); }
        catch { data = trimmed; }
      } else if (/^[\[{]/.test(trimmed)){
        // parece JSON mesmo sem header
        try { data = JSON.parse(trimmed); } catch { data = trimmed; }
      } else {
        data = trimmed; // texto solto; o extractor tentará regex
      }
      // Renderiza eventos (por cidades)
      const events = extractEvents(data);
      renderEventsList(events);
      if (events && events.length){
        // Auto: comparar primeiro item
        await compareByCities(events[0]);
      } else {
        setStatus('Nenhum evento com cidades encontrado no retorno do webhook.','cc-warn');
      }
    }catch(e){
      setStatus('Erro ao consultar webhook: ' + (e && e.message ? e.message : String(e)), 'cc-err');
    }
  }

  function usePastedJson(){
    try{
      const t = String(jsonInput.value||'').trim();
      if (!t){ setStatus('Cole um JSON primeiro.', 'cc-warn'); return; }
      const data = JSON.parse(t);
      const events = extractEvents(data);
      renderEventsList(events);
      if (events && events.length) await compareByCities(events[0]);
    }catch(e){ setStatus('JSON inválido: ' + (e && e.message ? e.message : String(e)), 'cc-err'); }
  }

  $('#cc-fetch').addEventListener('click', fetchFromWebhook);
  $('#cc-use-json').addEventListener('click', usePastedJson);
  $('#cc-clear').addEventListener('click', ()=>{ jsonInput.value=''; resultEl.innerHTML=''; setStatus('', ''); });
})();
