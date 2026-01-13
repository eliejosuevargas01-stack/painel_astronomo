(function(){
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search || '');
  const rawParam = params.get('demo');
  const demoByPath = window.location && window.location.pathname
    ? window.location.pathname.includes('-demo')
    : false;
  const normalizeFlag = (val) => {
    if (val == null) return null;
    const v = String(val).trim().toLowerCase();
    if (v === '' || v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    return true;
  };
  const paramEnabled = normalizeFlag(rawParam != null ? rawParam : (demoByPath ? '1' : null));
  try{
    if (paramEnabled === false) localStorage.removeItem('urania_demo');
  }catch(_){}
  const storedEnabled = (() => {
    try{ return localStorage.getItem('urania_demo') === '1'; }catch(_){ return false; }
  })();
  const enabled = paramEnabled != null ? paramEnabled : storedEnabled;
  if (!enabled) return;
  try{ localStorage.setItem('urania_demo', '1'); }catch(_){}

  const now = new Date();
  const isoAt = (days, hour, minute) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour == null ? 19 : hour, minute == null ? 0 : minute, 0, 0);
    return d.toISOString();
  };

  const demoSession = {
    loggedIn: true,
    id_astronomo: 42,
    assistant_id: 'assist-urania-42',
    username: 'nina.lima',
    usuario: 'nina.lima',
    nome_completo: 'Nina Lima',
    astronomo: 'Nina Lima',
    row_number: 12,
    sessionId: 'demo-session-42',
    timestamp: now.toISOString(),
    telefone: '67999998888',
    email: 'nina.lima@urania.demo',
    cidade_base: 'Campo Grande - MS',
    estado: 'MS',
    veiculo: 'Van Mercedes Sprinter',
    consumo_km_l: 9.8,
    combustivel: 'Diesel S10',
    valor_litro: 6.35,
    percentual_lucro: 0.28,
    diaria_hospedagem: 180,
    monitor: 120,
    pedagios: 35,
    alimentacao_diaria: 85,
    origem_real: 'Planetario Urania',
    origem_lat: -20.4697,
    origem_lon: -54.6201,
    precisa_voltar_para_base: true
  };

  const shared = {
    id_astronomo: demoSession.id_astronomo,
    assistant_id: demoSession.assistant_id,
    usuario: demoSession.usuario,
    astronomo: demoSession.astronomo,
    tipo_da_tarefa: 'Visita Tecnica'
  };

  const demoEvents = [
    {
      ...shared,
      id_evento: 1001,
      nome_da_escola: 'Escola Estelar Sirius',
      cidade: 'Campo Grande - MS',
      cidade_destino: 'Campo Grande - MS',
      destino_lat: '-20.4697',
      destino_lon: '-54.6201',
      data_e_hora_do_agendamento: isoAt(-12, 19),
      data_agendamento: isoAt(-12, 19),
      valor_total: 5200,
      numero_de_diarias: 1,
      distancia_km: 12,
      consumo_km_l: 10,
      valor_litro: 6.2,
      valor_diaria_hospedagem: 180,
      alimentacao_diaria: 85,
      pedagios: 0,
      monitor: 120,
      local_instalacao: 'Auditorio Central',
      endereco: 'Av. das Constelacoes, 1200',
      numero_de_alunos: 420,
      conteudo_da_apresentacao: 'Viagem pelas Galaxias',
      avaliacao: 'Excelente sessao, equipe muito preparada.',
      nota_npm: 9,
      finalizado: true,
      data_finalizacao: isoAt(-12, 22),
      despesas_reais: {
        combustivel_real: 95,
        hospedagem_real: 0,
        alimentacao_real: 160,
        pedagios_real: 0,
        monitor_real: 120,
        outros: 40
      }
    },
    {
      ...shared,
      id_evento: 1002,
      nome_da_escola: 'Colegio Polaris',
      cidade: 'Dourados - MS',
      cidade_destino: 'Dourados - MS',
      destino_lat: '-22.2231',
      destino_lon: '-54.8122',
      data_e_hora_do_agendamento: isoAt(-5, 18),
      data_agendamento: isoAt(-5, 18),
      valor_total: 6800,
      numero_de_diarias: 2,
      distancia_km: 220,
      consumo_km_l: 9.5,
      valor_litro: 6.3,
      valor_diaria_hospedagem: 190,
      alimentacao_diaria: 95,
      pedagios: 25,
      monitor: 120,
      local_instalacao: 'Ginasio Municipal',
      endereco: 'Rua Saturno, 45',
      numero_de_alunos: 520,
      conteudo_da_apresentacao: 'Sistema Solar em Movimento',
      avaliacao_astronomo: 'Bom conteudo, logistica ok.',
      nota_npm: 7,
      finalizado: true,
      data_finalizacao: isoAt(-4, 22),
      despesas_reais: {
        combustivel_real: 310,
        hospedagem_real: 190,
        alimentacao_real: 190,
        pedagios_real: 35,
        monitor_real: 120,
        outros: 60
      }
    },
    {
      ...shared,
      id_evento: 1003,
      nome_da_escola: 'Instituto Orion',
      cidade: 'Tres Lagoas - MS',
      cidade_destino: 'Tres Lagoas - MS',
      destino_lat: '-20.7511',
      destino_lon: '-51.6782',
      data_e_hora_do_agendamento: isoAt(6, 20),
      data_agendamento: isoAt(6, 20),
      valor_total: 7400,
      numero_de_diarias: 3,
      distancia_km: 330,
      consumo_km_l: 9.8,
      valor_litro: 6.4,
      valor_diaria_hospedagem: 210,
      alimentacao_diaria: 100,
      pedagios: 40,
      monitor: 150,
      local_instalacao: 'Centro Cultural',
      endereco: 'Rod. BR-262, Km 12',
      numero_de_alunos: 610,
      conteudo_da_apresentacao: 'Nebulosas e Buracos Negros',
      avaliacao: 'Alguns equipamentos falharam.',
      nota_npm: 5,
      finalizado: false
    },
    {
      ...shared,
      id_evento: 1004,
      nome_da_escola: 'Centro Vega',
      cidade: 'Corumba - MS',
      cidade_destino: 'Corumba - MS',
      destino_lat: '-19.0072',
      destino_lon: '-57.6517',
      data_e_hora_do_agendamento: isoAt(14, 19),
      data_agendamento: isoAt(14, 19),
      valor_total: 4600,
      numero_de_diarias: 1,
      distancia_km: 410,
      consumo_km_l: 9.2,
      valor_litro: 6.25,
      valor_diaria_hospedagem: 180,
      alimentacao_diaria: 90,
      pedagios: 50,
      monitor: 130,
      local_instalacao: 'Auditorio Principal',
      endereco: 'Av. Leste Oeste, 900',
      numero_de_alunos: 380,
      conteudo_da_apresentacao: 'Viagem ao Cosmos',
      finalizado: false
    }
  ];

  const seed = () => {
    try{ localStorage.setItem('astronomo_session', JSON.stringify(demoSession)); }catch(_){}
    try{ localStorage.setItem('userSession', JSON.stringify(demoSession)); }catch(_){}
    try{
      const key = `agenda_cache_v1::${String(demoSession.id_astronomo).toLowerCase()}`;
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), events: demoEvents }));
    }catch(_){}
  };

  window.URANIA_DEMO = {
    enabled: true,
    session: demoSession,
    events: demoEvents,
    seed
  };

  seed();
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', seed, { once: true });
    } else {
      setTimeout(seed, 0);
    }
  }
})();
