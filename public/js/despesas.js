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

    // Ensure global functions from app.js are available
    // These functions are expected to be defined in app.js and loaded before despesas.js
    const AGENDA_WEBHOOK_URL = 'https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/agenda-astronomos';
    const callAgendaWebhook = window.callAgendaWebhook;
    const normalizeEvent = window.normalizeEvento;
    const getLoggedSession = window.getLoggedSession;
    const buildRouteInfoHtml = window.buildRouteInfoHtml;
    // Função auxiliar para ler valores aninhados
    function readNested(obj, path) {
        if (!obj || !path) return undefined;
        return path.split('.').reduce((acc, part) => {
            if (acc && typeof acc === 'object') return acc[part];
            return undefined;
        }, obj);
    }

    // Função auxiliar para parse de números de rota
    function parseRouteNumber(raw) {
        if (raw == null) return null;
        const cleaned = String(raw).replace(',', '.').trim();
        if (!cleaned) return null;
        const parsed = Number.parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
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

    // Função para agrupar eventos únicos (evitar duplicação)
    function getUniqueEvents(events) {
        const uniqueMap = new Map();
        
        events.forEach(event => {
            // Criar chave única baseada em cidade, escola e data (sem hora)
            const eventDate = parseDatePreserveUTC(event.data_agendamento);
            const dateKey = eventDate ? eventDate.toISOString().split('T')[0] : 'no-date';
            const uniqueKey = `${event.cidade || ''}-${event.nome_da_escola || ''}-${dateKey}`;
            
            // Se já existe um evento com mesma chave, manter o primeiro
            if (!uniqueMap.has(uniqueKey)) {
                uniqueMap.set(uniqueKey, event);
            }
        });
        
        return Array.from(uniqueMap.values());
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

            // Usar eventos únicos para evitar duplicação
            allEvents = getUniqueEvents(eventsArray);
            
            console.log(`Carregados ${eventsArray.length} eventos, ${allEvents.length} únicos após deduplicação`);
            
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
            option.textContent = `${formattedDate} - ${event.nome_da_escola || event.cidade || 'Evento sem nome'}`;
            eventSelect.appendChild(option);
        });
    }

    function handleEventSelect(event) {
        const eventId = event.target.value;
        selectedEvent = allEvents.find(ev => ev.id === eventId);
        renderSelectedEventDetails(selectedEvent); // Render only the selected event
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

        const eventDetailsHtml = `
            <div class="event-item-despesa">
                <div class="event-header">
                    <div class="event-title">${event.nome_da_escola || event.cidade || 'Evento sem nome'}</div>
                    <div class="event-date">${formattedDate} ${formattedTime}</div>
                </div>
                <div class="event-details">
                    <div class="event-detail"><i>📍</i><span>${event.cidade} - ${event.local_instalacao || event.endereco || 'Local a definir'}</span></div>
                    <div class="event-detail"><i>👥</i><span>${event.faixa_de_alunos || 'Número não informado'}</span></div>
                    <div class="event-detail"><i>👨‍🏫</i><span>Responsável: ${event.responsavel_pelo_evento || '—'}</span></div>
                    <div class="event-detail"><i>💰</i><span>Faturamento: ${formatCurrencyBr(totalEventValueNum)}</span></div>
                </div>
                ${buildRouteInfoHtml(event)}
                <div class="controls" style="margin-top:10px;">
                    <button class="btn btn-secondary" id="launch-expense-btn"><i class="fas fa-file-invoice-dollar"></i> Lançar Despesa</button>
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

            const eventHtml = `
                <div class="event-item-despesa" data-event-id="${event.id}">
                    <div class="event-header">
                        <div class="event-title">${event.nome_da_escola || event.cidade || 'Evento sem nome'}</div>
                        <div class="event-date">${formattedDate} ${formattedTime}</div>
                    </div>
                    <div class="event-details">
                        <div class="event-detail"><i>📍</i><span>${event.cidade} - ${event.local_instalacao || event.endereco || 'Local a definir'}</span></div>
                        <div class="event-detail"><i>👥</i><span>${event.faixa_de_alunos || 'Número não informado'}</span></div>
                        <div class="event-detail"><i>👨‍🏫</i><span>Responsável: ${event.responsavel_pelo_evento || '—'}</span></div>
                        <div class="event-detail"><i>💰</i><span>Faturamento: ${formatCurrencyBr(totalEventValueNum)}</span></div>
                    </div>
                    ${buildRouteInfoHtml(event)}
                    <div class="controls" style="margin-top:10px;">
                        <button class="btn btn-secondary launch-expense-btn" data-event-id="${event.id}">
                            <i class="fas fa-file-invoice-dollar"></i> Lançar Despesa
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

        eventsForSummary.forEach(event => {
            const expenses = extractExpenseEstimates(event, event.routeInfo);
            
            console.log(`Evento ${event.id}:`, expenses);
            
            totalFuel += expenses.combustivel || 0;
            totalHotel += expenses.hospedagem || 0;
            totalFood += expenses.alimentacao || 0;
            totalPedagios += expenses.pedagios || 0;
            totalMonitor += expenses.monitor || 0;
        });

        console.log('Totais:', { totalFuel, totalHotel, totalFood, totalPedagios, totalMonitor });

        estCostFuel.textContent = formatCurrencyBr(totalFuel);
        estCostHotel.textContent = formatCurrencyBr(totalHotel);
        estCostFood.textContent = formatCurrencyBr(totalFood);
        estCostPedagios.textContent = formatCurrencyBr(totalPedagios);
        estCostMonitor.textContent = formatCurrencyBr(totalMonitor);
    }

    // --- Expenses Modal Functions (copied/adapted from app.js) ---
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

    expensesModalClose.addEventListener('click', closeExpensesModal);
    expCancelBtn.addEventListener('click', closeExpensesModal);
    expensesForm.addEventListener('submit', submitExpensesForm);
    expensesModal.addEventListener('click', (e) => {
        if (e.target === expensesModal) closeExpensesModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && expensesModal.classList.contains('open')) closeExpensesModal();
    });

    // --- Location Modal Functions (copied/adapted from app.js) ---
    const locationModal = document.getElementById('location-modal');
    const locationModalClose = document.getElementById('location-modal-close');
    const locCancelBtn = document.getElementById('loc-cancel');
    const manualLocationForm = document.getElementById('manual-location-form');

    function openLocationModal(ev, destino) {
        document.getElementById('loc-id-evento').value = ev?.id || '';
        document.getElementById('loc-destino').value = destino || '';
        locationModal.classList.add('open');
        locationModal.setAttribute('aria-hidden', 'false');
    }

    function closeLocationModal() {
        locationModal.classList.remove('open');
        locationModal.setAttribute('aria-hidden', 'true');
    }

    async function submitManualLocation(e) {
        e.preventDefault();
        const id_evento = document.getElementById('loc-id-evento').value;
        const manual_city = document.getElementById('manual-city').value.trim();
        const uf = document.getElementById('manual-uf').value.trim();
        const destino = document.getElementById('loc-destino').value;
        if (!manual_city || !uf) { showNotification('Informe cidade e UF.', 'error'); return; }
        try {
            // This part needs to be adapted if `requestRouteInfoForEvent` and `geocodeCityUF` are not global
            // For now, just send the location update
            await callAgendaWebhook('obter_localizacao', { id_evento, manual_city, uf, destino });
            showNotification('Localização manual enviada.', 'success');
            closeLocationModal();
        } catch (err) {
            showNotification('Falha ao enviar localização: ' + err.message, 'error');
        }
    }

    locationModalClose.addEventListener('click', closeLocationModal);
    locCancelBtn.addEventListener('click', closeLocationModal);
    manualLocationForm.addEventListener('submit', submitManualLocation);
    locationModal.addEventListener('click', (e) => {
        if (e.target === locationModal) closeLocationModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && locationModal.classList.contains('open')) closeLocationModal();
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

    // Função para parse de datas preservando UTC
    function parseDatePreserveUTC(dateString) {
        if (!dateString) return null;
        try {
            const date = new Date(dateString);
            return isNaN(date.getTime()) ? null : date;
        } catch (e) {
            return null;
        }
    }

    // Funções de manipulação de datas (se não existirem)
    function startOfDay(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function endOfDay(date) {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
    }

    function startOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day;
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function endOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() + (6 - day);
        d.setDate(diff);
        d.setHours(23, 59, 59, 999);
        return d;
    }

    function startOfMonth(date) {
        const d = new Date(date);
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function endOfMonth(date) {
        const d = new Date(date);
        d.setMonth(d.getMonth() + 1, 0);
        d.setHours(23, 59, 59, 999);
        return d;
    }
});
