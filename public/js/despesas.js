// public/js/despesas.js
console.log('despesas.js carregado');

document.addEventListener('DOMContentLoaded', function() {
    const eventSelect = document.getElementById('event-select-despesas');
    const despesasEventsList = document.getElementById('despesas-events-list');

    // Summary cards elements
    const estCostFuel = document.getElementById('est-cost-fuel');
    const estCostHotel = document.getElementById('est-cost-hotel');
    const estCostFood = document.getElementById('est-cost-food');
    const estCostPedagios = document.getElementById('est-cost-pedagios');
    const estCostMonitor = document.getElementById('est-cost-monitor');
    const eventTotalValue = document.getElementById('event-total-value');
    const astronomerProfit = document.getElementById('astronomer-profit');

    let allEvents = [];
    let selectedEvent = null;
    let currentPeriodFilter = 'all'; // 'all', 'day', 'week', 'month'
    const groupColors = new Map(); // Para cores consistentes dos grupos

    // Ensure global functions from app.js are available
    const AGENDA_WEBHOOK_URL = 'https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/agenda-astronomos';
    const callAgendaWebhook = window.callAgendaWebhook;
    const normalizeEvent = window.normalizeEvent; // CORRIGIDO: sem "o" no final
    const getLoggedSession = window.getLoggedSession;
    const buildRouteInfoHtml = window.buildRouteInfoHtml;
    const formatCurrencyBr = window.formatCurrencyBr;
    const showNotification = window.showNotification;
    const parseCurrencyBR = window.parseCurrencyBR;
    const parseDatePreserveUTC = window.parseDatePreserveUTC;
    const startOfDay = window.startOfDay;
    const endOfDay = window.endOfDay;
    const startOfWeek = window.startOfWeek;
    const endOfWeek = window.endOfWeek;
    const startOfMonth = window.startOfMonth;
    const endOfMonth = window.endOfMonth;

    // ===== FUNÇÕES DE AGRUPAMENTO (IGUAL AO INDEX) =====
    
    // Função auxiliar para ler valores aninhados
    function readNested(obj, path) {
        if (!obj || !path) return undefined;
        return path.split('.').reduce((acc, part) => {
            if (acc && typeof acc === 'object') return acc[part];
            return undefined;
        }, obj);
    }

    // Função auxiliar para parse de números
    function parseRouteNumber(raw) {
        if (raw == null) return null;
        const cleaned = String(raw).replace(',', '.').trim();
        if (!cleaned) return null;
        const parsed = Number.parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function normalizeKey(v) {
        return String(v ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // remove acentos
            .toLowerCase()
            .replace(/\s+/g, ' ') // espaços múltiplos
            .replace(/[\-_/.,;:|]+/g, ' ') // pontuações comuns
            .trim();
    }

    function groupKey(ev) {
        const parts = [
            ev.astronomo,
            ev.cidade,
            ev.local_instalacao || ev.endereco,
            ev.nome_da_escola || ev.nome_lead,
            ev.responsavel_pelo_evento,
            String(parseCurrencyBR(ev.valor_total || 0))
        ];
        return parts.map(normalizeKey).join('|');
    }

    function hashCode(str) { 
        let h = 0; 
        for(let i = 0; i < str.length; i++) { 
            h = ((h << 5) - h) + str.charCodeAt(i); 
            h |= 0; 
        } 
        return h; 
    }

    function colorForGroup(id) {
        if (groupColors.has(id)) return groupColors.get(id);
        const h = Math.abs(hashCode(String(id))) % 360;
        const s = 70, l = 55;
        const c = `hsl(${h}, ${s}%, ${l}%)`;
        groupColors.set(id, c);
        return c;
    }

    // Função principal de agrupamento (igual ao index)
    function groupEvents(events) {
        const groupedEvents = [];
        const byGroup = new Map();

        // Agrupar eventos por chave única
        events.forEach(ev => {
            const key = groupKey(ev);
            if (!byGroup.has(key)) {
                byGroup.set(key, []);
            }
            byGroup.get(key).push(ev);
        });

        // Para cada grupo, criar um evento consolidado
        byGroup.forEach((eventList, groupKey) => {
            if (eventList.length === 0) return;

            // Ordenar por data
            eventList.sort((a, b) => new Date(a.data_e_hora_do_agendamento) - new Date(b.data_e_hora_do_agendamento));
            
            // Usar o primeiro evento como base
            const baseEvent = { ...eventList[0] };
            
            // Calcular totais consolidados
            const totalValor = eventList.reduce((sum, ev) => sum + parseCurrencyBR(ev.valor_total || 0), 0);
            const totalDiarias = eventList.reduce((sum, ev) => sum + (ev.numero_diarias || 1), 0);
            
            // Atualizar com valores consolidados
            baseEvent.valor_total = totalValor;
            baseEvent.numero_diarias = totalDiarias;
            baseEvent._groupedCount = eventList.length; // Quantos eventos foram agrupados
            baseEvent._groupedEvents = eventList; // Lista de eventos originais
            baseEvent._groupKey = groupKey;
            baseEvent._color = colorForGroup(groupKey);
            
            // Se há múltiplas datas, usar a primeira data e marcar como multi-dia
            if (eventList.length > 1) {
                const firstDate = new Date(eventList[0].data_e_hora_do_agendamento);
                const lastDate = new Date(eventList[eventList.length - 1].data_e_hora_do_agendamento);
                baseEvent.data_e_hora_do_agendamento = firstDate.toISOString();
                baseEvent._isMultiDay = true;
                baseEvent._dateRange = `${firstDate.toLocaleDateString('pt-BR')} - ${lastDate.toLocaleDateString('pt-BR')}`;
            }

            groupedEvents.push(baseEvent);
            
            console.log(`Agrupados ${eventList.length} eventos em: ${baseEvent.nome_da_escola} - ${baseEvent.cidade}`);
        });

        console.log(`Total: ${events.length} eventos originais → ${groupedEvents.length} eventos agrupados`);
        return groupedEvents;
    }

    function extractExpenseEstimates(ev, routeInfo) {
        try {
            const diarias = (function() {
                const raw = ev?.numero_de_diarias ?? ev?.numero_diarias ?? ev?.diarias ?? 1;
                const n = parseInt(String(raw ?? '').replace(/\D+/g, ''), 10);
                return Number.isFinite(n) && n > 0 ? n : 1;
            })();

            // Função auxiliar para buscar valores em múltiplos campos
            const pick = (...keys) => {
                for (const k of keys) {
                    const v = readNested(ev, k) ?? ev[k];
                    const n = parseRouteNumber(v);
                    if (n != null) return n;
                }
                return null;
            };

            // Combustível: preferir rota calculada, depois campos do evento
            let combustivel = (routeInfo && routeInfo.fuelCost != null) ? routeInfo.fuelCost : null;
            if (combustivel == null) {
                combustivel = pick('custo_total_combustivel', 'gasto_combustivel', 'gasto_combustivel_media', 'combustivel');
            }

            // Hospedagem por diária * diárias
            const hospDia = pick('valor_diaria_hospedagem', 'diaria_hospedagem', 'diaria_hospedagem_media', 'hospedagem_diaria');
            const hospedagem = hospDia != null ? hospDia * diarias : null;

            // Alimentação por diária * diárias
            const alimDia = pick('valor_diario_alimentacao', 'alimentacao_diaria', 'alimentacao_diaria_media', 'alimentacao_diaria');
            const alimentacao = alimDia != null ? alimDia * diarias : null;

            // Pedágios e Monitor
            const pedagios = pick('pedagios', 'pedagios_media', 'custo_pedagios');
            const monitor = pick('monitor', 'monitor_media', 'custo_monitor');

            // Calcular total
            const parts = [combustivel, hospedagem, alimentacao, pedagios, monitor].filter(v => Number.isFinite(v));
            const total = parts.length ? parts.reduce((a, b) => a + b, 0) : null;

            return { 
                combustivel, 
                hospedagem, 
                alimentacao, 
                pedagios, 
                monitor, 
                total 
            };
        } catch (_) {
            console.warn('Erro ao extrair estimativas de despesas para evento:', ev?.id);
            return { 
                combustivel: null, 
                hospedagem: null, 
                alimentacao: null, 
                pedagios: null, 
                monitor: null, 
                total: null 
            };
        }
    }

    function extractFuelDataFromEvent(ev) {
        if (!ev || typeof ev !== 'object') return {};
        const data = {};
        const consumo = parseRouteNumber(ev.consumo_km_l ?? ev.km_por_litro ?? ev.km_per_liter);
        if (consumo != null) data.consumo_km_l = consumo;
        const valor = parseRouteNumber(ev.valor_litro ?? ev.valor_litro_real ?? ev.preco_litro);
        if (valor != null) data.valor_litro = valor;
        return data;
    }

    async function fetchEvents() {
        try {
            eventSelect.innerHTML = '<option value="">Carregando eventos...</option>';
            const s = getLoggedSession();
            let data;
            if (s?.id_astronomo != null) {
                data = await callAgendaWebhook('atualizar_agenda', { id_astronomo: s.id_astronomo });
            } else {
                data = await callAgendaWebhook('atualizar_agenda', {});
            }

            if (data == null) throw new Error('Sem dados retornados');

            let eventsArray = [];
            if (Array.isArray(data)) {
                eventsArray = data.map(normalizeEvent);
            } else if (typeof data === 'object' && Array.isArray(data.eventos)) {
                eventsArray = data.eventos.map(normalizeEvent);
            } else {
                throw new Error('Formato de dados inválido recebido do webhook');
            }

            // Usar agrupamento sofisticado (igual ao index)
            allEvents = groupEvents(eventsArray);
            
            console.log(`Carregados ${eventsArray.length} eventos, ${allEvents.length} únicos após agrupamento`);
            
            populateEventSelect();
            updateSummaryCards();
            renderEventsForPeriod();

        } catch (error) {
            console.error('Erro ao buscar eventos:', error);
            eventSelect.innerHTML = '<option value="">Erro ao carregar eventos</option>';
            showNotification(`Erro ao carregar eventos: ${error.message}`, 'error');
        }
    }

    function getFilteredEventsByPeriod(events, period) {
        const now = new Date();
        let periodStart, periodEnd;

        if (period === 'day') {
            periodStart = startOfDay(now);
            periodEnd = endOfDay(now);
        } else if (period === 'week') {
            periodStart = startOfWeek(now);
            periodEnd = endOfWeek(now);
        } else if (period === 'month') {
            periodStart = startOfMonth(now);
            periodEnd = endOfMonth(now);
        } else { // 'all'
            return events;
        }

        return events.filter(event => {
            const eventDate = parseDatePreserveUTC(event.data_agendamento);
            return eventDate && eventDate >= periodStart && eventDate <= periodEnd;
        });
    }

    function populateEventSelect() {
        eventSelect.innerHTML = '<option value="">-- Selecione um Evento --</option>';
        const eventsToDisplay = getFilteredEventsByPeriod(allEvents, currentPeriodFilter);

        eventsToDisplay.forEach(event => {
            const option = document.createElement('option');
            option.value = event.id;
            const eventDate = parseDatePreserveUTC(event.data_agendamento);
            const formattedDate = eventDate ? eventDate.toLocaleDateString('pt-BR') : 'Data Indefinida';
            
            // Adicionar indicador de agrupamento se houver múltiplos eventos
            const groupIndicator = event._groupedCount > 1 ? ` (${event._groupedCount} dias)` : '';
            
            option.textContent = `${formattedDate} - ${event.nome_da_escola || event.cidade || 'Evento sem nome'}${groupIndicator}`;
            eventSelect.appendChild(option);
        });
    }

    function handleEventSelect(event) {
        const eventId = event.target.value;
        selectedEvent = allEvents.find(ev => ev.id === eventId);
        renderSelectedEventDetails(selectedEvent);
    }

    function renderSelectedEventDetails(event) {
        despesasEventsList.innerHTML = '';
        if (!event) {
            eventTotalValue.textContent = formatCurrencyBr(0);
            astronomerProfit.textContent = formatCurrencyBr(0);
            return;
        }

        const eventDate = parseDatePreserveUTC(event.data_agendamento);
        const formattedDate = eventDate ? eventDate.toLocaleDateString('pt-BR') : 'Data Indefinida';
        const formattedTime = eventDate ? eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

        const totalEventValueNum = parseCurrencyBR(event.valor_total || 0);
        const astronomerProfitNum = totalEventValueNum * 0.26;

        eventTotalValue.textContent = formatCurrencyBr(totalEventValueNum);
        astronomerProfit.textContent = formatCurrencyBr(astronomerProfitNum);

        // Badge de agrupamento se houver múltiplos eventos
        const groupBadge = event._groupedCount > 1 
            ? `<div class="group-badge" style="background: ${event._color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; display: inline-block; margin-left: 8px;">
                 ${event._groupedCount} eventos agrupados
               </div>`
            : '';

        // Data formatada para eventos multi-dia
        const dateDisplay = event._dateRange 
            ? event._dateRange 
            : `${formattedDate} ${formattedTime}`;

        const eventDetailsHtml = `
            <div class="event-item-despesa" data-event-id="${event.id}" style="border-left: 4px solid ${event._color || '#4a90e2'}">
                <div class="event-header">
                    <div class="event-title">
                        ${event.nome_da_escola || event.cidade || 'Evento sem nome'}
                        ${groupBadge}
                    </div>
                    <div class="event-date">${dateDisplay}</div>
                </div>
                <div class="event-details">
                    <div class="event-detail"><i>📍</i><span>${event.cidade} - ${event.local_instalacao || event.endereco || 'Local a definir'}</span></div>
                    <div class="event-detail"><i>👥</i><span>${event.faixa_de_alunos || 'Número não informado'}</span></div>
                    <div class="event-detail"><i>👨‍🏫</i><span>Responsável: ${event.responsavel_pelo_evento || '—'}</span></div>
                    <div class="event-detail"><i>💰</i><span>Faturamento Total: ${formatCurrencyBr(totalEventValueNum)}</span></div>
                    ${event._groupedCount > 1 ? `<div class="event-detail"><i>📅</i><span>${event._groupedCount} dias de evento</span></div>` : ''}
                    <div class="event-detail"><i>🏨</i><span>Diárias: ${event.numero_diarias || 1}</span></div>
                </div>
                ${buildRouteInfoHtml(event)}
                <div class="controls" style="margin-top:10px;">
                    <button class="btn btn-secondary" id="launch-expense-btn">
                        <i class="fas fa-file-invoice-dollar"></i> Lançar Despesas
                    </button>
                </div>
            </div>
        `;
        despesasEventsList.innerHTML = eventDetailsHtml;

        document.getElementById('launch-expense-btn').addEventListener('click', () => {
            openExpensesModal(event);
        });
    }

    function renderEventsForPeriod() {
        despesasEventsList.innerHTML = '';
        eventTotalValue.textContent = formatCurrencyBr(0);
        astronomerProfit.textContent = formatCurrencyBr(0);

        const eventsToRender = getFilteredEventsByPeriod(allEvents, currentPeriodFilter);

        if (eventsToRender.length === 0) {
            despesasEventsList.innerHTML = '<p>Nenhum evento encontrado para o período selecionado.</p>';
            return;
        }

        eventsToRender.forEach(event => {
            const eventDate = parseDatePreserveUTC(event.data_agendamento);
            const formattedDate = eventDate ? eventDate.toLocaleDateString('pt-BR') : 'Data Indefinida';
            const formattedTime = eventDate ? eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

            const totalEventValueNum = parseCurrencyBR(event.valor_total || 0);
            const astronomerProfitNum = totalEventValueNum * 0.26;

            // Badge de agrupamento se houver múltiplos eventos
            const groupBadge = event._groupedCount > 1 
                ? `<div class="group-badge" style="background: ${event._color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; display: inline-block; margin-left: 8px;">
                     ${event._groupedCount} eventos agrupados
                   </div>`
                : '';

            // Data formatada para eventos multi-dia
            const dateDisplay = event._dateRange 
                ? event._dateRange 
                : `${formattedDate} ${formattedTime}`;

            const eventHtml = `
                <div class="event-item-despesa" data-event-id="${event.id}" style="border-left: 4px solid ${event._color || '#4a90e2'}">
                    <div class="event-header">
                        <div class="event-title">
                            ${event.nome_da_escola || event.cidade || 'Evento sem nome'}
                            ${groupBadge}
                        </div>
                        <div class="event-date">${dateDisplay}</div>
                    </div>
                    <div class="event-details">
                        <div class="event-detail"><i>📍</i><span>${event.cidade} - ${event.local_instalacao || event.endereco || 'Local a definir'}</span></div>
                        <div class="event-detail"><i>👥</i><span>${event.faixa_de_alunos || 'Número não informado'}</span></div>
                        <div class="event-detail"><i>👨‍🏫</i><span>Responsável: ${event.responsavel_pelo_evento || '—'}</span></div>
                        <div class="event-detail"><i>💰</i><span>Faturamento Total: ${formatCurrencyBr(totalEventValueNum)}</span></div>
                        ${event._groupedCount > 1 ? `<div class="event-detail"><i>📅</i><span>${event._groupedCount} dias de evento</span></div>` : ''}
                        <div class="event-detail"><i>🏨</i><span>Diárias: ${event.numero_diarias || 1}</span></div>
                    </div>
                    ${buildRouteInfoHtml(event)}
                    <div class="controls" style="margin-top:10px;">
                        <button class="btn btn-secondary launch-expense-btn" data-event-id="${event.id}">
                            <i class="fas fa-file-invoice-dollar"></i> Lançar Despesas
                        </button>
                    </div>
                </div>
            `;
            despesasEventsList.insertAdjacentHTML('beforeend', eventHtml);
        });

        // Remover event listeners antigos antes de adicionar novos
        despesasEventsList.querySelectorAll('.launch-expense-btn').forEach(button => {
            button.replaceWith(button.cloneNode(true));
        });

        // Add event listeners para todos os botões "Lançar Despesa"
        despesasEventsList.querySelectorAll('.launch-expense-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const eventId = e.target.dataset.eventId;
                const eventToLaunch = allEvents.find(ev => ev.id === eventId);
                if (eventToLaunch) {
                    openExpensesModal(eventToLaunch);
                }
            });
        });
    }

    function updateSummaryCards() {
        const eventsForSummary = getFilteredEventsByPeriod(allEvents, currentPeriodFilter);
        
        console.log(`Período: ${currentPeriodFilter}, Eventos: ${eventsForSummary.length}`);

        let totalFuel = 0;
        let totalHotel = 0;
        let totalFood = 0;
        let totalPedagios = 0;
        let totalMonitor = 0;
        let totalFaturamento = 0;

        eventsForSummary.forEach(event => {
            const expenses = extractExpenseEstimates(event, event.routeInfo);
            const faturamentoEvento = parseCurrencyBR(event.valor_total || 0);
            
            console.log(`Evento ${event.id} (${event._groupedCount || 1} dias):`, expenses, `Faturamento: ${faturamentoEvento}`);
            
            totalFuel += expenses.combustivel || 0;
            totalHotel += expenses.hospedagem || 0;
            totalFood += expenses.alimentacao || 0;
            totalPedagios += expenses.pedagios || 0;
            totalMonitor += expenses.monitor || 0;
            totalFaturamento += faturamentoEvento;
        });

        const totalLucroAstronomo = totalFaturamento * 0.26;

        console.log('Totais:', { 
            totalFuel, 
            totalHotel, 
            totalFood, 
            totalPedagios, 
            totalMonitor, 
            totalFaturamento,
            totalLucroAstronomo
        });

        estCostFuel.textContent = formatCurrencyBr(totalFuel);
        estCostHotel.textContent = formatCurrencyBr(totalHotel);
        estCostFood.textContent = formatCurrencyBr(totalFood);
        estCostPedagios.textContent = formatCurrencyBr(totalPedagios);
        estCostMonitor.textContent = formatCurrencyBr(totalMonitor);
        eventTotalValue.textContent = formatCurrencyBr(totalFaturamento);
        astronomerProfit.textContent = formatCurrencyBr(totalLucroAstronomo);
    }

    // --- Expenses Modal Functions ---
    const expensesModal = document.getElementById('expenses-modal');
    const expensesModalClose = document.getElementById('expenses-modal-close');
    const expensesForm = document.getElementById('expenses-form');
    const expCancelBtn = document.getElementById('exp-cancel');

    function openExpensesModal(ev) {
        document.getElementById('exp-id-evento').value = ev?.id || '';
        // Pre-fill with estimated values if available
        const estimates = extractExpenseEstimates(ev, ev.routeInfo);
        document.getElementById('exp-combustivel').value = estimates.combustivel?.toFixed(2) || '';
        document.getElementById('exp-hospedagem').value = estimates.hospedagem?.toFixed(2) || '';
        document.getElementById('exp-alimentacao').value = estimates.alimentacao?.toFixed(2) || '';
        document.getElementById('exp-pedagios').value = estimates.pedagios?.toFixed(2) || '';
        document.getElementById('exp-monitor').value = estimates.monitor?.toFixed(2) || '';
        document.getElementById('exp-outros').value = ''; // 'Outros' is not estimated

        expensesModal.classList.add('open');
        expensesModal.setAttribute('aria-hidden', 'false');
    }

    function closeExpensesModal() {
        expensesModal.classList.remove('open');
        expensesModal.setAttribute('aria-hidden', 'true');
    }

    async function submitExpensesForm(e) {
        e.preventDefault();
        const id_evento = document.getElementById('exp-id-evento').value;
        
        // Usar parseCurrencyBR para converter valores brasileiros
        const combustivel = parseCurrencyBR(document.getElementById('exp-combustivel').value || 0);
        const hospedagem = parseCurrencyBR(document.getElementById('exp-hospedagem').value || 0);
        const alimentacao = parseCurrencyBR(document.getElementById('exp-alimentacao').value || 0);
        const pedagios = parseCurrencyBR(document.getElementById('exp-pedagios').value || 0);
        const monitor = parseCurrencyBR(document.getElementById('exp-monitor').value || 0);
        const outros = parseCurrencyBR(document.getElementById('exp-outros').value || 0);

        if (!id_evento) { 
            showNotification('Evento inválido.', 'error'); 
            return; 
        }

        try {
            const result = await callAgendaWebhook('lancar_despesas', {
                id_evento: id_evento,
                combustivel: combustivel,
                hospedagem: hospedagem,
                alimentacao: alimentacao,
                pedagios: pedagios,
                monitor: monitor,
                outros: outros
            });
            
            console.log('Resposta do webhook:', result);
            showNotification('Despesas lançadas com sucesso.', 'success');
            closeExpensesModal();
            
            // Disparar geração de médias após lançar despesas
            const s = getLoggedSession();
            if (s?.id_astronomo != null) {
                try { 
                    await callAgendaWebhook('gerar_media_de_gastos', { id_astronomo: s.id_astronomo }); 
                } catch (err) { 
                    console.warn('Não foi possível gerar médias:', err);
                }
            }
            
            // Re-fetch events para atualizar summary
            fetchEvents();
        } catch (err) {
            console.error('Erro ao lançar despesas:', err);
            showNotification('Falha ao lançar despesas: ' + err.message, 'error');
        }
    }

    // ... resto do código (modal de localização, event listeners, etc) permanece igual ...
    expensesModalClose.addEventListener('click', closeExpensesModal);
    expCancelBtn.addEventListener('click', closeExpensesModal);
    expensesForm.addEventListener('submit', submitExpensesForm);
    expensesModal.addEventListener('click', (e) => {
        if (e.target === expensesModal) closeExpensesModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && expensesModal.classList.contains('open')) closeExpensesModal();
    });

    // Period filter buttons
    document.querySelectorAll('.period-filter-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.period-filter-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentPeriodFilter = button.dataset.period;
            
            console.log(`Filtro alterado para: ${currentPeriodFilter}`);
            
            // Clear selected event and reset dropdown
            selectedEvent = null;
            eventSelect.value = "";

            populateEventSelect();
            updateSummaryCards();
            renderEventsForPeriod();
        });
    });

    // Initial fetch
    fetchEvents();
    eventSelect.addEventListener('change', handleEventSelect);
});