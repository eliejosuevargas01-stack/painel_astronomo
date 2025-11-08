// Calendar.js - Sistema de Calendário com Indicadores de Eventos e Frases Sazonais
// Parse data preserving UTC day (avoid timezone shifts)
function parseDateNoUTC(val){
    try{
        if(!val) return null;
        if(val instanceof Date){ return new Date(val.getFullYear(), val.getMonth(), val.getDate()); }
        const s=String(val).trim().replace(/^"|"$/g,'').replace(/^'|'$/g,'');
        const mBR=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if(mBR){ return new Date(Number(mBR[3]), Number(mBR[2])-1, Number(mBR[1])); }
        const mISO=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if(mISO){ return new Date(Number(mISO[1]), Number(mISO[2])-1, Number(mISO[3])); }
        const d=new Date(s);
        if(!isNaN(d)) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        return null;
    }catch(_){ return null; }
}

class CalendarManager {
    constructor() {
        this.currentDate = new Date();
        this.currentMonth = this.currentDate.getMonth();
        this.currentYear = this.currentDate.getFullYear();
        this.eventsByDate = {};
        this.currentSeason = this.getCurrentSeason();
        this.phraseIndex = 0;
        this.phraseInterval = null;
        this.selectedDate = new Date();
        this.viewMode = 'day'; // 'day' | 'week'
        
        this.initializeCalendar();
    }

    // Atualiza o painel conforme data selecionada e modo de visão (dia/semana)
    setSelectedDate(date, eventsForDate = null) {
        this.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const today = new Date();
        today.setHours(0,0,0,0);
        const sel = new Date(this.selectedDate);
        sel.setHours(0,0,0,0);

        const titleEl = document.getElementById('today-title');
        const dateEl = document.getElementById('current-date');
        const todayList = document.getElementById('today-events-list');
        const weekList = document.getElementById('week-events-list');

        if (this.viewMode === 'day') {
            if (titleEl) {
                const isToday = sel.getTime() === today.getTime();
                titleEl.innerHTML = `<i class=\"fas ${isToday ? 'fa-sun' : 'fa-calendar-day'}\"></i> ${isToday ? 'Hoje' : 'Agenda do dia'}`;
            }
            if (dateEl) {
                const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                dateEl.textContent = this.selectedDate.toLocaleDateString('pt-BR', options);
            }
            if (todayList && weekList) { todayList.style.display = ''; weekList.style.display = 'none'; }
            const key = this.getDateKey(this.selectedDate);
            const events = eventsForDate ?? this.eventsByDate[key] ?? [];
            this.showDayEvents(this.selectedDate.getDate(), events);
        } else {
            if (titleEl) {
                titleEl.innerHTML = `<i class=\"fas fa-calendar-week\"></i> Agenda da semana`;
            }
            if (dateEl) {
                const { startOfWeek, endOfWeek } = this.getWeekRange(this.selectedDate);
                const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
                dateEl.textContent = `${fmt(startOfWeek)} — ${fmt(endOfWeek)}`;
            }
            if (todayList && weekList) { todayList.style.display = 'none'; weekList.style.display = ''; }
            this.showWeekEvents(this.selectedDate);
        }
    }

    // Inicializar calendário
    initializeCalendar() {
        this.setupEventListeners();
        this.renderCalendar();
        this.updateCurrentDate();
        this.setSelectedDate(new Date());
        this.startPhraseRotation();
    }

    // Configurar event listeners
    setupEventListeners() {
        document.getElementById('prev-month').addEventListener('click', () => this.previousMonth());
        document.getElementById('next-month').addEventListener('click', () => this.nextMonth());
        
        // Atualizar eventos quando os dados forem carregados
        document.addEventListener('eventsUpdated', (e) => {
            this.updateEvents(e.detail.events);
        });
        // Alternador de visão (Dia/Semana)
        try {
            const dayBtn = document.getElementById('view-mode-day');
            const weekBtn = document.getElementById('view-mode-week');
            if (dayBtn) dayBtn.addEventListener('click', () => this.setViewMode('day'));
            if (weekBtn) weekBtn.addEventListener('click', () => this.setViewMode('week'));
        } catch(_) {}
    }

    // Definir modo de visão
    setViewMode(mode) {
        const newMode = (mode === 'week') ? 'week' : 'day';
        if (this.viewMode === newMode) return;
        this.viewMode = newMode;
        // Atualizar estado visual dos botões
        try {
            const dayBtn = document.getElementById('view-mode-day');
            const weekBtn = document.getElementById('view-mode-week');
            if (dayBtn && weekBtn) {
                if (newMode === 'day') { dayBtn.classList.add('active'); weekBtn.classList.remove('active'); }
                else { weekBtn.classList.add('active'); dayBtn.classList.remove('active'); }
            }
        } catch(_) {}
        // Re-renderizar
        this.setSelectedDate(this.selectedDate);
    }

    // Mostrar eventos da semana
    showWeekEvents(selectedDate) {
        const weekContainer = document.getElementById('week-events-list');
        if (!weekContainer) return;
        const { days } = this.getWeekRange(selectedDate, true);

        let any = false;
        const html = days.map(d => {
            const key = this.getDateKey(d);
            const events = this.eventsByDate[key] || [];
            if (events.length) any = true;
            const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' });
            const shortDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const countLabel = events.length === 1 ? '1 evento' : `${events.length} eventos`;
            const offPhrases = this.getAgendaPhrases();
            const pi = offPhrases.length ? (d.getDay() % offPhrases.length) : 0;
            const eventsHtml = events.map(event => {
                const hasCoords = event.coordenadas && event.coordenadas.lat != null && event.coordenadas.lng != null;
                const lat = hasCoords ? event.coordenadas.lat : 'null';
                const lng = hasCoords ? event.coordenadas.lng : 'null';
                const hasGift = (function(v){ if (v===true) return true; if (typeof v==='string'){ const s=v.toLowerCase(); return s==='sim'||s==='true'; } return false; })(event.brinde ?? event.gift);
                const brindeBadge = hasGift
                    ? '<span class="brinde-badge yes"><i class="fas fa-gift"></i> Com brinde</span>'
                    : '<span class="brinde-badge no"><i class="fas fa-gift"></i> Sem brinde</span>';
                const alunosEstimados = (Number.isFinite(Number(event.alunos)) && Number(event.alunos) > 0)
                    ? Number(event.alunos)
                    : Math.max(1, Math.round((parseFloat(event.valor_total) || 0) / 100));
                const duracaoMinRaw = Number(event.duracao_minutos);
                const duracaoMin = Number.isFinite(duracaoMinRaw) && duracaoMinRaw > 0 ? Math.round(duracaoMinRaw) : null;
                const durFmt = duracaoMin == null ? '—' : (duracaoMin < 60 ? `${duracaoMin} min` : `${Math.floor(duracaoMin/60)}h ${String(duracaoMin%60).padStart(2,'0')} min`);
                return `
                    <div class=\"day-event-card\">
                        <div class=\"card-header\">
                            <div class=\"badge-icon\"><i class=\"fas fa-user-astronaut\"></i></div>
                            <div class=\"header-main\">
                                <h4>${event.nome_da_escola}</h4>
                                <div class=\"subline\"><i class=\"fas fa-map-marker-alt\"></i> ${event.cidade}</div>
                                <div class=\"meta-row\"> 
                                    <span><i class=\"fas fa-tasks\"></i> ${event.tarefa}</span>
                                    <span><i class=\"fas fa-money-bill-wave\"></i> R$ ${event.valor_total}</span>
                                    <span><i class=\"fas fa-clock\"></i> ${event.turno || 'Horário não definido'}</span>
                                    <span><i class=\"fas ${this.getStatusIcon(event.status)}\"></i> ${this.getStatusText(event.status)}</span>
                                    <span><i class=\"fas fa-users\"></i> ~${alunosEstimados}</span>
                                    ${brindeBadge}
                                </div>
                            </div>
                        </div>
                        <div class=\"card-route\">
                            <div class=\"route-stats\">
                                <div class=\"route-stat\"><i class=\"fas fa-road\"></i><span>${event.distancia_km || 'N/A'} km</span></div>
                                
                                <div class=\"route-stat\"><i class=\"fas fa-clock\"></i><span>${durFmt}</span></div>
                            </div>
                            <div class=\"day-route-actions\">
                                <button class=\"btn btn-sm btn-route\" onclick=\"calendarManager.openRouteInMaps('${event.cidade}', ${lat}, ${lng})\">\n                                    <i class=\"fas fa-directions\"></i> Ver Rota\n                                </button>
                                <button class=\"btn btn-sm btn-secondary\" onclick=\"calendarManager.openEventDetails('${event.id}')\">\n                                    <i class=\"fas fa-external-link-alt\"></i> Detalhes\n                                </button>
                            </div>
                        </div>
                    </div>`;
            }).join('');

            return `
                <div class=\"week-day-group\">
                    <div class=\"week-day-header\">
                        <div class=\"week-day-left\">
                            <span class=\"week-day-name\">${weekday}</span>
                            <span class=\"week-day-date\">${shortDate}</span>
                        </div>
                        <div class=\"week-day-count\">${countLabel}</div>
                    </div>
                    <div class=\"week-day-events\">${eventsHtml || `<div class=\\\"empty-state small\\\"><i class=\\\"fas fa-umbrella-beach\\\"></i> Folga: ${offPhrases[pi] || 'Aproveite o descanso!'} </div>`}</div>
                </div>`;
        }).join('');

        if (!any) {
            weekContainer.innerHTML = `
                <div class=\"empty-state\">\n                    <i class=\"fas fa-calendar-week\"></i>\n                    <p>Nenhum evento nesta semana</p>\n                </div>`;
        } else {
            weekContainer.innerHTML = html;
        }
    }

    // Início e fim da semana (segunda a domingo)
    getWeekRange(date, includeDays = false) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const day = d.getDay(); // 0=Dom,1=Seg
        const diffToMonday = (day === 0 ? -6 : 1 - day);
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() + diffToMonday);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        if (!includeDays) return { startOfWeek, endOfWeek };
        const days = [];
        for (let i = 0; i < 7; i++) { const di = new Date(startOfWeek); di.setDate(startOfWeek.getDate() + i); days.push(di); }
        return { startOfWeek, endOfWeek, days };
    }

    // Atualizar eventos no calendário
    updateEvents(events) {
        this.eventsByDate = {};
        const today = new Date(); today.setHours(0,0,0,0);
        const isFinalizado = (id)=>{ try{ return typeof window.isEventFinalizado==='function' ? window.isEventFinalizado(id) : false; }catch(_){ return false; } };

        events.forEach(event => {
            const dates = (function(){
                try{
                    if (Array.isArray(event.ocorrencias_dias) && event.ocorrencias_dias.length){
                        return event.ocorrencias_dias.map(s=>{
                            const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
                            if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
                            return parseDateNoUTC(s);
                        }).filter(Boolean);
                    }
                }catch(_){ }
                const d0 = parseDateNoUTC(event.data_agendamento);
                return d0 ? [d0] : [];
            })();

            dates.forEach(eventDate => {
                const dateKey = this.getDateKey(eventDate);
                if (!this.eventsByDate[dateKey]) {
                    this.eventsByDate[dateKey] = [];
                }

                const pastPending = (function(){
                    try{
                        if (!eventDate) return false;
                        const d = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
                        return (d < today) && !isFinalizado(event.id);
                    }catch(_){ return false; }
                })();

                const color = pastPending ? 'var(--planet-orange)' : this.getEventColor(event.tarefa);
                const status = pastPending ? 'pendente_finalizacao' : this.getEventStatus(event.tarefa);

                const arr = this.eventsByDate[dateKey];
                const exists = arr.some(e => String(e.id) === String(event.id));
                if (!exists){
                    arr.push({
                        ...event,
                        color,
                        status
                    });
                }
            });
        });

        this.renderCalendar();
        this.setSelectedDate(this.selectedDate);
    }

    // Obter cor do evento baseado na tarefa
    getEventColor(tarefa) {
        const colorMap = {
            'OLIVIA VISITA': 'var(--comet-green)',
            'OLIVIA PRÉ': 'var(--nebula-blue)',
            'OLIVIA RESERVA': 'var(--planet-orange)',
            'CS': 'var(--star-gold)',
            'MILENKO PRÉ': 'var(--nebula-purple)',
            'Follow-up': 'var(--text-moonlight)',
            'Negociar': 'var(--mars-red)',
            'Chamar agora!': 'var(--mars-red)',
            'Visita cancelada': 'var(--text-moonlight)'
        };
        
        return colorMap[tarefa] || 'var(--nebula-purple)';
    }

    // Obter status do evento
    getEventStatus(tarefa) {
        const statusMap = {
            'OLIVIA VISITA': 'confirmado',
            'OLIVIA PRÉ': 'confirmado',
            'OLIVIA RESERVA': 'reservado',
            'CS': 'confirmado',
            'MILENKO PRÉ': 'confirmado',
            'Follow-up': 'pendente',
            'Negociar': 'negociacao',
            'Chamar agora!': 'urgente',
            'Visita cancelada': 'cancelado'
        };
        
        return statusMap[tarefa] || 'pendente';
    }

    // Navegar para mês anterior
    previousMonth() {
        this.currentMonth--;
        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        }
        this.renderCalendar();
    }

    // Navegar para próximo mês
    nextMonth() {
        this.currentMonth++;
        if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }
        this.renderCalendar();
    }

    // Renderizar calendário
    renderCalendar() {
        const calendarGrid = document.getElementById('mini-calendar-grid');
        const monthLabel = this.getMonthName(this.currentMonth) + ' ' + this.currentYear;
        
        // Atualizar todos os títulos de mês (topo e mini calendário)
        try {
            const labels = document.querySelectorAll('.mini-calendar-month');
            labels.forEach(el => { el.textContent = monthLabel; });
        } catch(_) {}
        try {
            const el = document.getElementById('current-month');
            if (el) el.textContent = monthLabel;
        } catch(_) {}

        // Limpar grid
        calendarGrid.innerHTML = '';

        // Obter primeiro dia do mês e último dia
        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
        const startingDay = firstDay.getDay(); // 0 = Domingo, 1 = Segunda, etc.

        // Dias vazios no início
        for (let i = 0; i < startingDay; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.className = 'mini-calendar-day empty';
            calendarGrid.appendChild(emptyDay);
        }

        // Dias do mês
        for (let day = 1; day <= lastDay.getDate(); day++) {
            const dayElement = document.createElement('div');
            dayElement.className = 'mini-calendar-day';
            dayElement.textContent = day;
            
            const dateKey = this.getDateKey(new Date(this.currentYear, this.currentMonth, day));
            const today = new Date();
            
            // Verificar se é hoje
            if (this.isToday(this.currentYear, this.currentMonth, day)) {
                dayElement.classList.add('today');
            }
            
            // Verificar se é o dia atual selecionado
            if (this.currentYear === today.getFullYear() && 
                this.currentMonth === today.getMonth() && 
                day === today.getDate()) {
                dayElement.classList.add('current-day');
            }
            
            // Adicionar indicador de evento se houver eventos nesse dia
            if (this.eventsByDate[dateKey]) {
                dayElement.classList.add('has-event');
                
                // Criar container para os indicadores
                const indicatorsContainer = document.createElement('div');
                indicatorsContainer.className = 'event-indicators';
                
                // Adicionar indicadores coloridos para cada evento
                this.eventsByDate[dateKey].forEach((event, index) => {
                    const indicator = document.createElement('div');
                    indicator.className = 'event-indicator';
                    indicator.style.backgroundColor = event.color;
                    indicator.title = `${event.nome_da_escola} - ${event.tarefa}`;
                    
                    // Posicionar múltiplos indicadores
                    if (this.eventsByDate[dateKey].length > 1) {
                        indicator.style.transform = `translateX(${index * 4}px)`;
                    }
                    
                    indicatorsContainer.appendChild(indicator);
                });
                
                dayElement.appendChild(indicatorsContainer);
                
                // Adicionar contador se houver mais de 3 eventos
                if (this.eventsByDate[dateKey].length > 3) {
                    const countBadge = document.createElement('div');
                    countBadge.className = 'event-count-badge';
                    countBadge.textContent = `+${this.eventsByDate[dateKey].length - 3}`;
                    dayElement.appendChild(countBadge);
                }
                
                // Adicionar tooltip com informações dos eventos
                this.addEventTooltip(dayElement, this.eventsByDate[dateKey]);
            }
            
            // Adicionar evento de clique
            dayElement.addEventListener('click', () => {
                this.selectDay(day, this.eventsByDate[dateKey], dayElement);
            });
            
            calendarGrid.appendChild(dayElement);
        }
    }

    // Adicionar tooltip com informações dos eventos (cidade, escola, turno, brinde)
    addEventTooltip(dayElement, events) {
        let tooltip = document.createElement('div');
        tooltip.className = 'event-tooltip';

        const yesNo = (v) => {
            if (v === true) return 'Sim';
            if (v === false) return 'Não';
            const s = (v ?? '').toString().toLowerCase();
            return (s === 'sim' || s === 'true' || s === '1') ? 'Sim' : 'Não';
        };

        events.forEach(event => {
            const hasGift = (function(v){ if (v===true) return true; if (typeof v==='string'){ const s=v.toLowerCase(); return s==='sim'||s==='true'||s==='1'; } return false; })(event.brinde ?? event.gift);
            const turnos = event.turno || 'Não informado';
            const cidade = event.cidade || '—';
            const escola = event.nome_da_escola || '—';
            const alunosEstimados = (Number.isFinite(Number(event.alunos)) && Number(event.alunos) > 0)
                ? Number(event.alunos)
                : Math.max(1, Math.round((parseFloat(event.valor_total) || 0) / 100));

            const eventItem = document.createElement('div');
            eventItem.className = 'event-tooltip-item';
            eventItem.innerHTML = `
                <div class="event-tooltip-color" style="background-color: ${event.color}"></div>
                <div class="event-tooltip-info">
                    <strong>${escola}</strong>
                    <div class="event-tooltip-meta">
                        <span class="chip"><i class="fas fa-map-marker-alt"></i> ${cidade}</span>
                        <span class="chip"><i class="fas fa-clock"></i> ${turnos}</span>
                        <span class="chip"><i class="fas fa-users"></i> ~${alunosEstimados}</span>
                        <span class="chip"><i class="fas fa-gift"></i> ${yesNo(hasGift)}</span>
                    </div>
                </div>
            `;
            tooltip.appendChild(eventItem);
        });

        dayElement.appendChild(tooltip);

        // Mostrar/ocultar tooltip
        dayElement.addEventListener('mouseenter', () => {
            tooltip.style.display = 'block';
        });

        dayElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    }

    // Selecionar dia
    selectDay(day, events, element) {
        // Remover seleção anterior
        document.querySelectorAll('.mini-calendar-day.selected').forEach(el => {
            el.classList.remove('selected');
        });
        
        // Adicionar seleção atual
        if (element) {
            element.classList.add('selected');
        }
        
        // Atualizar painel para a data
        const date = new Date(this.currentYear, this.currentMonth, day);
        this.setSelectedDate(date, events);
    }

    // Mostrar eventos do dia selecionado — card avançado (layout antigo desejado)
    showDayEvents(day, events) {
        const todayEventsList = document.getElementById('today-events-list');
        if (!events || events.length === 0) { this.showSeasonalPhrases(todayEventsList); return; }

        todayEventsList.innerHTML = events.map(event => {
            const hasCoords = event.coordenadas && event.coordenadas.lat != null && event.coordenadas.lng != null;
            const lat = hasCoords ? event.coordenadas.lat : 'null';
            const lng = hasCoords ? event.coordenadas.lng : 'null';
            const hasGift = (function(v){ if (v===true) return true; if (typeof v==='string'){ const s=v.toLowerCase(); return s==='sim'||s==='true'; } return false; })(event.brinde ?? event.gift);
            const brindeBadge = hasGift
              ? '<span class="brinde-badge yes"><i class="fas fa-gift"></i> Com brinde</span>'
              : '<span class="brinde-badge no"><i class="fas fa-gift"></i> Sem brinde</span>';
            const alunosEstimados = (Number.isFinite(Number(event.alunos)) && Number(event.alunos) > 0)
                ? Number(event.alunos)
                : Math.max(1, Math.round((parseFloat(event.valor_total) || 0) / 100));
            const duracaoMinRaw = Number(event.duracao_minutos);
            const duracaoMin = Number.isFinite(duracaoMinRaw) && duracaoMinRaw > 0 ? Math.round(duracaoMinRaw) : null;
            const durFmt = duracaoMin == null ? '—' : (duracaoMin < 60 ? `${duracaoMin} min` : `${Math.floor(duracaoMin/60)}h ${String(duracaoMin%60).padStart(2,'0')} min`);
            return `
                <div class="day-event-card">
                    <div class="card-header">
                        <div class="badge-icon"><i class="fas fa-user-astronaut"></i></div>
                        <div class="header-main">
                            <h4>${event.nome_da_escola} <span class="chip small" title="ID do Evento"><i class="fas fa-hashtag"></i> ${event.id}</span></h4>
                            <div class="subline"><i class="fas fa-map-marker-alt"></i> ${event.cidade}</div>
                            <div class="meta-row">
                                <span><i class="fas fa-tasks"></i> ${event.tarefa||''}</span>
                                <span><i class="fas fa-money-bill-wave"></i> R$ ${parseFloat(event.valor_total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
                                <span><i class="fas fa-clock"></i> ${event.turno || 'Horário não definido'}</span>
                                <span><i class="fas ${this.getStatusIcon(event.status)}"></i> ${this.getStatusText(event.status)}</span>
                                <span><i class="fas fa-users"></i> ~${alunosEstimados}</span>
                                <span><i class="fas fa-hashtag"></i> ID ${event.id}</span>
                                ${brindeBadge}
                            </div>
                        </div>
                    </div>
                    <div class="card-route">
                        <div class="route-stats">
                            <div class="route-stat"><i class="fas fa-road"></i><span>${event.distancia_km || 'N/A'} km</span></div>
                            <div class="route-stat"><i class="fas fa-clock"></i><span>${durFmt}</span></div>
                        </div>
                        <div class="day-route-actions">
                            <button class="btn btn-sm btn-route" onclick="calendarManager.openRouteInMaps('${event.cidade}', ${lat}, ${lng})">
                                <i class="fas fa-directions"></i> Ver Rota
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="abrirHoteisProximos(${lat}, ${lng}, '${(event.cidade||'').toString().replace(/'/g, '\\')}')">
                                <i class="fas fa-hotel"></i> Hotéis
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="abrirRestaurantesProximos(${lat}, ${lng}, '${(event.cidade||'').toString().replace(/'/g, '\\')}')">
                                <i class="fas fa-utensils"></i> Comer
                            </button>
                            <button class="btn btn-sm btn-whatsapp" onclick="abrirWhatsApp('${(event.contato_responsavel||'').toString().replace(/[^0-9+]/g,'')}', '${(event.nome_da_escola||'').toString().replace(/'/g, '\\' )}')">
                                <i class="fab fa-whatsapp"></i> WhatsApp
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="calendarManager.openEventInUpcoming('${event.id}')">
                                <i class="fas fa-info-circle"></i> Detalhes
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Mostrar frases sazonais quando não há eventos
    showSeasonalPhrases(container) {
        const phrases = this.getAgendaPhrases();
        const routePhrases = this.getRoutePhrases();
        
        container.innerHTML = `
            <!-- Frases para Agenda do Dia -->
            <div class="seasonal-phrase-banner agenda-phrase">
                <div class="phrase-icon">${this.getSeasonIcon()}</div>
                <div class="phrase-content">
                    <div class="phrase-text" id="agenda-phrase">${phrases[0]}</div>
                    <div class="phrase-subtitle">Aproveite seu dia! 🌟</div>
                </div>
            </div>

            <!-- Frases para Rotas -->
            <div class="seasonal-phrase-banner route-phrase">
                <div class="phrase-icon">🚗</div>
                <div class="phrase-content">
                    <div class="phrase-text" id="route-phrase">${routePhrases[0]}</div>
                    <div class="phrase-subtitle">Planeje sua próxima aventura! 🗺️</div>
                </div>
            </div>
        `;

        // Iniciar rotação de frases
        this.startPhraseRotation();
    }

    // Obter frases sazonais para agenda
    getSeasonalPhrases() {
        const phrases = {
            summer: [
                "🌞 Que tal um sorvete hoje? O calor pede!",
                "🍉 Dia perfeito para uma prainha!",
                "🏖️ O verão chegou com tudo! Aproveite o sol!",
                "🧊 Refresque-se com uma bebida gelada!",
        "👨‍🚀 Até os astronomos curtem um bom verão!",
                "🌴 Momento de relaxar e recarregar as energias!",
                "🍹 Hora do descanso merecido!",
                "🎯 Folga hoje, missões amanhã!",
                "🌊 O mar está te esperando!",
                "🍍 Frutas frescas e um dia de paz!"
            ],
            autumn: [
                "🍂 Sinta a brisa do outono aconchegante!",
                "📚 Dia perfeito para ler um bom livro!",
                "🍁 As folhas caem, novas oportunidades surgem!",
                "☕ Que tal um café quentinho?",
                "🧥 Hora de tirar os casacos do armário!",
                "🎨 Inspire-se nas cores do outono!",
                "🌧️ Chuva fina, dia tranquilo!",
                "📖 Momento de planejar as próximas missões!",
                "🍂 A natureza se prepara para renovar!",
                "🧣 Aproveite o clima aconchegante!"
            ],
            winter: [
                "❄️ Hora de ficar quentinho em casa!",
                "☕ Chocolate quente e Netflix? Combinação perfeita!",
                "🧦 Dia de meias quentes e filmes!",
                "🔥 Aproveite o inverno com coisas gostosas!",
                "📺 Maratona de séries está liberada!",
                "🍲 Que tal uma sopa quentinha?",
                "🧤 Momento de descanso e recarga!",
                "🎬 Cinema em casa na tarde fria!",
                "🛋️ Sofá, cobertor e paz!",
        "🌟 Até os astronomos curtem um inverno aconchegante!",
            ],
            spring: [
                "🌷 As flores desabrocham, novas energias também!",
                "🌸 Primavera: tempo de renovação!",
                "🐦 Os pássaros cantam, a vida floresce!",
                "🌼 Dia perfeito para um piquenique!",
                "🌞 O sol da primavera aquece a alma!",
                "🦋 Novos começos, novas aventuras!",
                "🌱 Tempo de plantar novas ideias!",
                "💐 A natureza em festa!",
                "🚀 Energias renovadas para novas missões!",
                "🌈 Cores e alegria por toda parte!"
            ]
        };
        
        return phrases[this.currentSeason] || phrases.summer;
    }

    // Frases divertidas de astronomo (adicionais)
    getAstronautPhrases() {
        return [
            "Hora de ajustar os telescópios!",
            "Oxigênio ok, café ok, missão ok.",
            "Trajetória traçada: bora decolar!",
            "Painéis solares carregados, energia no topo.",
            "Checagem de cabine concluída. Partiu missão!",
            "Contagem regressiva: 3, 2, 1… 🚀",
            "Rota calculada ao ritmo das estrelas.",
            "Capacete polido, foco ajustado.",
            "Explorar é o nosso combustível favorito.",
            "Hoje a órbita é de produtividade!",
            "Sinais claros: a galáxia sorri pra gente.",
            "Checklist pronto, curiosidade ligada.",
            "Nave em cruzeiro — mente criativa no comando.",
            "Comandante, o universo mandou energias boas!"
        ];
    }

    // 60% sazonais + 40% astronomos
    getAgendaPhrases() {
        const seasonals = this.getSeasonalPhrases();
        const astro = this.getAstronautPhrases();
        const total = Math.max(seasonals.length, astro.length);
        const mix = [];
        for (let i = 0; i < total; i++) {
            if (i < seasonals.length && (i % 5 !== 1 && i % 5 !== 3)) {
                mix.push(seasonals[i]); // ~60%
            }
            if (i < astro.length && (i % 5 === 1 || i % 5 === 3)) {
                mix.push(astro[i]); // ~40%
            }
        }
        return mix.length ? mix : seasonals;
    }

    // Obter frases para rotas
    getRoutePhrases() {
        const phrases = {
            summer: [
                "🛣️ Estradas ensolaradas te esperam!",
                "🌅 Perfeito para uma road trip!",
                "🚗 Vento no rosto, estrada pela frente!",
                "🗺️ Novas rotas, novas descobertas!",
                "🌞 Estrada + Sol = Combinação perfeita!",
                "👨‍🚀 Até no espaço temos rotas a explorar!",
                "🔄 Momento de planejar a próxima jornada!",
                "🎯 Rotas traçadas, aventuras garantidas!",
                "🌄 Cada curva uma nova paisagem!",
                "🚙 Hora de explorar novos caminhos!"
            ],
            autumn: [
                "🍂 Estradas com paisagens douradas!",
                "🛣️ Perfeito para dirigir com a brisa do outono!",
                "🗺️ Rotas cheias de charme outonal!",
                "🌧️ Estrada molhada, direção cuidadosa!",
                "🍁 Cada viagem uma nova experiência!",
                "🚗 A estrada chama, a aventura espera!",
                "🧭 Navegando por paisagens transformadas!",
                "🔄 Tempo de recalcular rotas!",
                "🌄 Pôr do sol lindo na estrada!",
                "🛤️ Novos caminhos a descobrir!"
            ],
            winter: [
                "❄️ Estradas tranquilas no inverno!",
                "🛣️ Hora de planejar rotas seguras!",
                "🧭 Navegação cuidadosa na estrada fria!",
                "🚗 Viagens planejadas são as melhores!",
                "🌨️ Momento de revisar os trajetos!",
                "🗺️ Rotas aquecidas pelo planejamento!",
                "🔍 Estudando os melhores caminhos!",
                "🔄 Recalculando para dias melhores!",
                "🧊 Estrada livre, mente tranquila!",
                "🚙 Preparando a próxima aventura!"
            ],
            spring: [
                "🌷 Estradas floridas te esperam!",
                "🛣️ Perfeito para explorar novos caminhos!",
                "🌸 Rotas cheias de vida e cor!",
                "🚗 Primavera: época de novas jornadas!",
                "🗺️ Cada estrada uma descoberta!",
                "🌼 Paisagens renovadas na estrada!",
                "🧭 Navegando entre flores e esperanças!",
                "🔄 Rotas que florescem como a primavera!",
                "🌄 Amanhecer lindo na estrada!",
                "🚙 Hora de colocar o pé na estrada!"
            ]
        };
        
        return phrases[this.currentSeason] || phrases.summer;
    }

    // Iniciar rotação de frases
    startPhraseRotation() {
        // Limpar intervalo anterior
        if (this.phraseInterval) {
            clearInterval(this.phraseInterval);
        }
        
        // Rotacionar frases a cada 4 segundos
        this.phraseInterval = setInterval(() => {
            this.rotatePhrases();
        }, 4000);
    }

    // Rotacionar frases
    rotatePhrases() {
        const agendaPhraseElement = document.getElementById('agenda-phrase');
        const routePhraseElement = document.getElementById('route-phrase');
        
        if (agendaPhraseElement && routePhraseElement) {
            const agendaPhrases = this.getAgendaPhrases();
            const routePhrases = this.getRoutePhrases();
            
            this.phraseIndex = (this.phraseIndex + 1) % agendaPhrases.length;
            
            agendaPhraseElement.style.opacity = '0';
            routePhraseElement.style.opacity = '0';
            
            setTimeout(() => {
                agendaPhraseElement.textContent = agendaPhrases[this.phraseIndex];
                routePhraseElement.textContent = routePhrases[this.phraseIndex];
                
                agendaPhraseElement.style.opacity = '1';
                routePhraseElement.style.opacity = '1';
            }, 500);
        }
    }

    // Obter ícone da estação
    getSeasonIcon() {
        const icons = {
            summer: "🌞",
            autumn: "🍂", 
            winter: "❄️",
            spring: "🌷"
        };
        return icons[this.currentSeason] || "👨‍🚀";
    }

    // Obter estação atual
    getCurrentSeason() {
        const month = new Date().getMonth() + 1;
        
        if (month >= 12 || month <= 2) return 'summer';    // Verão: Dez, Jan, Fev
        if (month >= 3 && month <= 5) return 'autumn';     // Outono: Mar, Abr, Mai
        if (month >= 6 && month <= 8) return 'winter';     // Inverno: Jun, Jul, Ago
        return 'spring';                                   // Primavera: Set, Out, Nov
    }

    // Renderizar eventos de hoje
    renderTodayEvents() {
        const today = new Date();
        const todayKey = this.getDateKey(today);
        const todayEvents = this.eventsByDate[todayKey] || [];
        
        this.setSelectedDate(today, todayEvents);
    }

    // Abrir rota no Google Maps
    openRouteInMaps(cidade, lat, lng) {
        if (lat && lng) {
            const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
            window.open(url, '_blank');
        } else {
            const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cidade)}`;
            window.open(url, '_blank');
        }
    }

    // Mostrar detalhes da rota
    showRouteDetails(eventId) {
        // Chama verDetalhesCompletos se existir; mantém evento para compatibilidade
        try { if (typeof window.verDetalhesCompletos === 'function') return window.verDetalhesCompletos(eventId); } catch(_){}
        const event = new CustomEvent('showRouteDetails', { detail: { eventId } });
        document.dispatchEvent(event);
    }

    // Abrir detalhes do evento
    openEventDetails(eventId) {
        // Mantém compat para ouvintes antigos, mas também abre nos Próximos Eventos
        try {
            const ev = new CustomEvent('openEventModal', { detail: { eventId } });
            document.dispatchEvent(ev);
        } catch(_) {}
        try { this.openEventInUpcoming(eventId); } catch(_) {}
    }

    // Abrir o evento correspondente na seção de Próximos Eventos
    openEventInUpcoming(eventId) {
        try {
            // Ativar aba Agenda se houver sistema de tabs
            const btn = document.querySelector('.tab-btn[data-tab="agenda"]');
            if (btn && !btn.classList.contains('active')) btn.click();
        } catch(_) {}

        // Garantir que a seção esteja visível (se existir um colapso)
        try {
            const section = document.getElementById('upcoming-section');
            if (section && section.style && section.style.display === 'none') {
                const t = document.getElementById('toggle-upcoming');
                if (t) t.click();
            }
        } catch(_) {}

        // Abrir o card correspondente
        const openCard = () => {
            const card = document.getElementById(`event-card-${eventId}`);
            if (card && typeof card.open !== 'undefined') {
                card.open = true;
                try { card.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(_) { card.scrollIntoView(); }
                // Destaque temporário
                try {
                    card.classList.add('pulse');
                    setTimeout(() => { try { card.classList.remove('pulse'); } catch(_){} }, 1200);
                } catch(_) {}
                return true;
            }
            return false;
        };

        // Tenta abrir agora; se a lista ainda não renderizou, tenta novamente em seguida
        if (!openCard()) setTimeout(openCard, 250);
    }

    // Utilitários
    getDateKey(date) {
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }

    isToday(year, month, day) {
        const today = new Date();
        return year === today.getFullYear() && 
               month === today.getMonth() && 
               day === today.getDate();
    }

    getMonthName(month) {
        const months = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        return months[month];
    }

    getStatusIcon(status) {
        const icons = {
            'confirmado': 'fa-check-circle',
            'reservado': 'fa-calendar-check',
            'pendente': 'fa-clock',
            'negociacao': 'fa-handshake',
            'urgente': 'fa-exclamation-circle',
            'cancelado': 'fa-times-circle'
        };
        return icons[status] || 'fa-circle';
    }

    getStatusText(status) {
        const texts = {
            'confirmado': 'Confirmado',
            'reservado': 'Reservado',
            'pendente': 'Pendente',
            'negociacao': 'Em negociação',
            'urgente': 'Urgente',
            'cancelado': 'Cancelado'
        };
        return texts[status] || 'Pendente';
    }

    updateCurrentDate() {
        const today = new Date();
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        };
        document.getElementById('current-date').textContent = 
            today.toLocaleDateString('pt-BR', options);
    }
}

// Inicializar calendário quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', function() {
    window.calendarManager = new CalendarManager();
    // Tentar carregar eventos já presentes no cache (caso o evento 'eventsUpdated' já tenha sido disparado)
    try{
        const get = window.getCurrentEventsArray && window.getCurrentEventsArray();
        if (Array.isArray(get) && get.length){
            window.calendarManager.updateEvents(get);
        }
    }catch(_){ }
});
