// account.js — página “Minha Conta”
(function(){
  function keyFor(base){
    try{
      const raw = localStorage.getItem('astronomo_session');
      const s = raw ? JSON.parse(raw) : null;
      const ns = (s && (s.username || s.USERNAME || s.assistant_id || s.id_astronomo)) || 'anon';
      return base + '::' + String(ns).toLowerCase().replace(/[^a-z0-9_-]+/g,'').slice(0,64);
    }catch(_){ return base + '::anon'; }
  }
  function loadUserTheme(){ try{ return JSON.parse(localStorage.getItem(keyFor('user_theme'))||'null')||null; }catch(_){ return null; } }
  function saveUserTheme(theme){ try{ localStorage.setItem(keyFor('user_theme'), JSON.stringify(theme||{})); }catch(_){ } }
  function applyTheme(theme){
    try{
      const root=document.documentElement; if(!theme) return;
      Object.entries(theme).forEach(([k,v])=> root.style.setProperty(k, String(v)) );
    }catch(_){ }
  }
  function deriveThemeFromUsername(username){
    try{
      if(!username) return null; const u=String(username).toLowerCase();
      const palettes=[
        { '--accent-purple':'#7b5cff','--accent-cyan':'#34d1f3','--accent-magenta':'#ff5ec4','--accent-gold':'#ffd86b' },
        { '--accent-purple':'#8b5cff','--accent-cyan':'#20e3b2','--accent-magenta':'#ff6b9f','--accent-gold':'#ffc857' },
        { '--accent-purple':'#6a6cff','--accent-cyan':'#4dd0e1','--accent-magenta':'#ff7ea5','--accent-gold':'#ffe082' }
      ];
      let h=0; for(let i=0;i<u.length;i++) h=(h*31+u.charCodeAt(i))>>>0; return palettes[h%palettes.length];
    }catch(_){ return null; }
  }
  function readSession(){
    try{
      const raw = localStorage.getItem('astronomo_session');
      if(!raw) return null;
      const s = JSON.parse(raw);
      if(!s || !s.loggedIn) return null;
      return s;
    }catch(e){ return null; }
  }

  function formatTime(ts){
    try{
      return new Date(ts).toLocaleString('pt-BR');
    }catch(e){ return '-'; }
  }

  function populate(session){
    const $ = (id)=>document.getElementById(id);
    if(!session) return;
    $('acc-username').textContent = session.username || '-';
    $('acc-astronomo-id').textContent = session.id_astronomo || '-';
    $('acc-assistant').textContent = session.assistant_id || '-';
    $('acc-row').textContent = session.row_number != null ? String(session.row_number) : '-';
    $('acc-session').textContent = session.sessionId || '-';
    $('acc-login-time').textContent = formatTime(session.timestamp);
  }

  document.addEventListener('DOMContentLoaded', function(){
    const session = readSession();
    if(!session){
      // Sem sessão -> login
      window.location.href = 'login.html';
      return;
    }
    populate(session);
    // Preencher e bind do editor de tema
    try{
      const toHex=(s)=>{ const m=String(s||'').trim(); return /^#/.test(m)? m : m; };
      const getVar=(name)=> getComputedStyle(document.documentElement).getPropertyValue(name) || '';
      const cur = loadUserTheme() || { '--accent-purple':getVar('--accent-purple'), '--accent-cyan':getVar('--accent-cyan'), '--accent-magenta':getVar('--accent-magenta'), '--accent-gold':getVar('--accent-gold') };
      const ip = document.getElementById('theme-purple'); if(ip) ip.value = toHex(cur['--accent-purple']||'#7b5cff');
      const ic = document.getElementById('theme-cyan');   if(ic) ic.value = toHex(cur['--accent-cyan']||'#34d1f3');
      const im = document.getElementById('theme-magenta');if(im) im.value = toHex(cur['--accent-magenta']||'#ff5ec4');
      const ig = document.getElementById('theme-gold');   if(ig) ig.value = toHex(cur['--accent-gold']||'#ffd86b');

      const onChange=()=>{
        const theme={ '--accent-purple':ip.value, '--accent-cyan':ic.value, '--accent-magenta':im.value, '--accent-gold':ig.value };
        applyTheme(theme);
      };
      [ip,ic,im,ig].forEach(inp=> inp && inp.addEventListener('input', onChange));

      const saveBtn=document.getElementById('theme-save'); if(saveBtn) saveBtn.addEventListener('click', ()=>{ const theme={ '--accent-purple':ip.value, '--accent-cyan':ic.value, '--accent-magenta':im.value, '--accent-gold':ig.value }; saveUserTheme(theme); alert('Tema salvo!'); });
      const resetBtn=document.getElementById('theme-reset'); if(resetBtn) resetBtn.addEventListener('click', ()=>{ try{ localStorage.removeItem(keyFor('user_theme')); }catch(_){ } const t=deriveThemeFromUsername(session.username) || null; if(t) applyTheme(t); else location.reload(); });
      const suggestBtn=document.getElementById('theme-suggest'); if(suggestBtn) suggestBtn.addEventListener('click', ()=>{ const t=deriveThemeFromUsername(session.username); if(!t) return; applyTheme(t); if(ip) ip.value=t['--accent-purple']; if(ic) ic.value=t['--accent-cyan']; if(im) im.value=t['--accent-magenta']; if(ig) ig.value=t['--accent-gold']; });
    }catch(_){ }
    const logoutBtn = document.getElementById('acc-logout');
    if(logoutBtn){
      logoutBtn.addEventListener('click', function(){
        try{ localStorage.removeItem('astronomo_session'); }catch(e){}
        window.location.href = 'login.html';
      });
    }
  });
})();
