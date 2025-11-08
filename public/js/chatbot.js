// Chatbot.js - Assistente Multifuncional (CORRIGIDO)
// Webhook do agente de IA (n8n)
// Integração desabilitada: link removido conforme solicitação
// ATENÇÃO: para habilitar, informe AQUI a SUA URL do webhook do n8n (chat)
// Exemplo: const N8N_CHAT_WEBHOOK_URL = "https://seu-n8n.com/webhook/chat";
const N8N_CHAT_WEBHOOK_URL = "";

class ChatbotManager {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.currentForm = null;
        this.formData = {};
        this.clientId = this.getOrCreateClientId();
        this.userContext = this.getUserContext();
        
        console.log('ChatbotManager inicializado'); // Debug
        this.initializeChatbot();
    }

    // Inicializar chatbot
    initializeChatbot() {
        console.log('Inicializando chatbot...'); // Debug
        this.setupEventListeners();
        this.addWelcomeMessage();
    }

    // Configurar event listeners (CORRIGIDO)
    setupEventListeners() {
        console.log('Configurando event listeners...'); // Debug
        
        // Toggle do chatbot
        const toggleBtn = document.getElementById('chatbot-toggle');
        const closeBtn = document.getElementById('chatbot-close');
        
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleChatbot();
            });
            console.log('Toggle button encontrado'); // Debug
        } else {
            console.error('Toggle button não encontrado!'); // Debug
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeChatbot();
            });
        }

        // Envio de mensagens
        const sendBtn = document.getElementById('chatbot-send');
        const inputField = document.getElementById('chatbot-input');
        
        if (sendBtn && inputField) {
            sendBtn.addEventListener('click', () => this.sendMessage());
            inputField.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendMessage();
            });
        }

        // Botões de ação rápida
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.target.getAttribute('data-question');
                console.log('Botão rápido clicado:', action); // Debug
                this.handleQuickAction(action);
            });
        });

        // Fechar modal ao clicar fora (CORRIGIDO)
        document.addEventListener('click', (e) => {
            if (this.isOpen && 
                !e.target.closest('.chatbot-container') && 
                !e.target.closest('.chatbot-toggle')) {
                this.closeChatbot();
            }
        });

        // Prevenir fechamento ao clicar dentro do chatbot
        const chatbotContainer = document.getElementById('chatbot-container');
        if (chatbotContainer) {
            chatbotContainer.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        console.log('Event listeners configurados'); // Debug
    }

    // Alternar visibilidade do chatbot (CORRIGIDO)
    toggleChatbot() {
        console.log('Toggle chatbot chamado, estado atual:', this.isOpen); // Debug
        this.isOpen = !this.isOpen;
        const container = document.getElementById('chatbot-container');
        
        if (container) {
            if (this.isOpen) {
                container.classList.add('open');
                document.getElementById('chatbot-input').focus();
                console.log('Chatbot aberto'); // Debug
            } else {
                container.classList.remove('open');
                console.log('Chatbot fechado'); // Debug
            }
        } else {
            console.error('Container do chatbot não encontrado!'); // Debug
        }
    }

    // Fechar chatbot
    closeChatbot() {
        console.log('Fechando chatbot...'); // Debug
        this.isOpen = false;
        const container = document.getElementById('chatbot-container');
        if (container) {
            container.classList.remove('open');
        }
        this.closeCurrentForm();
    }

    // Adicionar mensagem de boas-vindas
    addWelcomeMessage() {
        this.addBotMessage(`
            Olá! Sou seu assistente virtual 🚀<br><br>
            Posso ajudar você com:
            <ul>
                <li>📅 <strong>Agendamento de hotéis</strong></li>
                <li>🍽️ <strong>Reserva de restaurantes</strong></li>
                <li>⏰ <strong>Lembretes e alertas</strong></li>
                <li>🗺️ <strong>Informações de rotas</strong></li>
                
            </ul>
            Como posso ajudar você hoje?
        `);
    }

    // Enviar mensagem
    sendMessage() {
        const input = document.getElementById('chatbot-input');
        const message = input.value.trim();

        if (message) {
            this.addUserMessage(message);
            input.value = '';
            // Envia ao agente de IA no n8n
            this.sendUserMessageToAgent(message).catch(err => console.error('[chatbot] Falha ao enviar ao agente:', err));
            this.processUserMessage(message);
        }
    }

    // Enviar mensagem livre do usuário ao agente de IA (n8n)
    async sendUserMessageToAgent(message, extra = {}) {
        // Se a integração estiver desabilitada, não envia nada para fora
        if (!N8N_CHAT_WEBHOOK_URL || typeof N8N_CHAT_WEBHOOK_URL !== 'string' || !/^https?:/i.test(N8N_CHAT_WEBHOOK_URL)) {
            console.info('[chatbot] Integração n8n desabilitada; não enviando.');
            return;
        }
        try {
            // atualizar contexto do usuário antes de enviar
            this.userContext = this.getUserContext();
            const payload = {
                type: 'user_message',
                message,
                clientId: this.clientId,
                username: this.userContext.username || null,
                userId: this.userContext.userId || null,
                page: typeof window !== 'undefined' ? window.location.href : undefined,
                timestamp: new Date().toISOString(),
                ...extra
            };

            // Envia todas as informações na querystring
            let targetUrl = N8N_CHAT_WEBHOOK_URL || '';
            try{
                const u = new URL(targetUrl, (typeof window!=='undefined' && window.location)? window.location.origin : undefined);
                Object.entries(payload).forEach(([k,v])=>{
                    if (v === undefined || v === null) return;
                    const val = (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ? String(v) : JSON.stringify(v);
                    try{ u.searchParams.set(k, val); }catch(_){ }
                });
                targetUrl = u.toString();
            }catch(_){ }

            const resp = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Accept':'application/json' }
            });

            // Opcional: tentar ler uma possível resposta do agente
            const contentType = resp.headers.get('content-type') || '';
            if (resp.ok && contentType.includes('application/json')) {
                const data = await resp.json();
                if (data && (data.reply || data.message)) {
                    this.addBotMessage(String(data.reply || data.message));
                }
            }
        } catch (error) {
            console.error('[chatbot] Erro ao enviar mensagem ao n8n:', error);
        }
    }

    // Gera/recupera um identificador simples do cliente para sessão
    // Enviar submissão de formulário ao n8n com dados em array
    async sendFormToAgent(formName, dataObj) {
        const formDataArray = Object.entries(dataObj || {}).map(([key, value]) => ({ key, value }));
        return this.sendUserMessageToAgent(null, {
            type: 'form_submission',
            formName,
            formData: formDataArray
        });
    }

    getOrCreateClientId() {
        try {
            const key = 'chatbotClientId';
            let id = localStorage.getItem(key);
            if (!id) {
                id = 'cb_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
                localStorage.setItem(key, id);
            }
            return id;
        } catch (_) {
            // Fallback se localStorage não estiver disponível
            return 'cb_' + Math.random().toString(36).slice(2, 10);
        }
    }

    // Processar mensagem do usuário
    // Recupera username e userId (1..18) da sessão de login
    getUserContext() {
        const ctx = { username: null, userId: null, assistant_id: null, row_number: null };
        try {
            const raw = localStorage.getItem('astronomo_session');
            if (!raw) return ctx;
            const data = JSON.parse(raw);
            ctx.username = data.username || data.USERNAME || null;
            const aId = Number(data.assistant_id ?? data.ASSISTANT_ID);
            const rNum = Number(data.row_number ?? data.ROW_NUMBER);
            if (!Number.isNaN(aId) && Number.isFinite(aId)) ctx.userId = aId;
            else if (!Number.isNaN(rNum) && Number.isFinite(rNum)) ctx.userId = rNum;
            ctx.assistant_id = data.assistant_id ?? data.ASSISTANT_ID ?? null;
            ctx.row_number = data.row_number ?? data.ROW_NUMBER ?? null;
        } catch (_) {}
        return ctx;
    }

    processUserMessage(message) {
        // Fechar formulário atual se existir
        this.closeCurrentForm();

        const lowerMessage = message.toLowerCase();

        if (lowerMessage.includes('hotel') || lowerMessage.includes('hospedagem') || lowerMessage.includes('alojamento')) {
            this.showHotelForm();
        } else if (lowerMessage.includes('restaurante') || lowerMessage.includes('comida') || lowerMessage.includes('alimentação')) {
            this.showRestaurantForm();
        } else if (lowerMessage.includes('lembrete') || lowerMessage.includes('alerta') || lowerMessage.includes('notificação')) {
            this.showReminderForm();
        } else {
            // Resposta padrão para outras mensagens
            setTimeout(() => {
                this.addBotMessage(`
                    Entendi sua mensagem: "${message}"<br><br>
                    Posso ajudar você com:
                    <ul>
                        <li>🏨 <strong>Agendar hotel</strong> - Clique em "Hotel"</li>
                        <li>🍽️ <strong>Reservar restaurante</strong> - Clique em "Restaurante"</li>
                        <li>⏰ <strong>Criar lembrete</strong> - Clique em "Lembretes"</li>
                    </ul>
                    Ou use os botões abaixo para ações rápidas!
                `);
            }, 1000);
        }
    }

    // Manipular ações rápidas
    handleQuickAction(action) {
        console.log('Ação rápida:', action); // Debug
        this.closeCurrentForm();

        switch (action) {
            case 'Hotel':
                this.showHotelForm();
                break;
            case 'Restaurante':
                this.showRestaurantForm();
                break;
            case 'Lembretes':
                this.showReminderForm();
                break;
            case 'Próximos eventos':
                this.showUpcomingEvents();
                break;
            case 'Rotas':
                this.showRouteInfo();
                break;
            
            default:
                this.addBotMessage(`Ação "${action}" não reconhecida.`);
        }
    }

    // ===== FORMULÁRIO DE HOTEL =====
    showHotelForm() {
        this.currentForm = 'hotel';
        this.formData = {};
        
        const formHTML = `
            <div class="chatbot-form" id="hotel-form">
                <div class="form-header">
                    <h4>🏨 Agendamento de Hotel</h4>
                    <p>Preencha os dados para buscar hospedagem</p>
                </div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label for="hotel-city">📍 Cidade</label>
                        <input type="text" id="hotel-city" placeholder="Ex: São Paulo, Florianópolis..." required>
                    </div>
                    
                    <div class="form-group">
                        <label for="hotel-checkin">📅 Check-in</label>
                        <input type="date" id="hotel-checkin" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="hotel-checkout">📅 Check-out</label>
                        <input type="date" id="hotel-checkout" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="hotel-guests">👥 Hóspedes</label>
                        <select id="hotel-guests" required>
                            <option value="">Selecione...</option>
                            <option value="1">1 pessoa</option>
                            <option value="2">2 pessoas</option>
                            <option value="3">3 pessoas</option>
                            <option value="4">4 pessoas</option>
                            <option value="5+">5+ pessoas</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="hotel-rooms">🛏️ Quartos</label>
                        <select id="hotel-rooms" required>
                            <option value="">Selecione...</option>
                            <option value="1">1 quarto</option>
                            <option value="2">2 quartos</option>
                            <option value="3">3 quartos</option>
                            <option value="4+">4+ quartos</option>
                        </select>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="window.chatbotManager.closeCurrentForm()">Cancelar</button>
                    <button type="button" class="btn btn-primary" onclick="window.chatbotManager.submitHotelForm()">Buscar Hotéis</button>
                </div>
            </div>
        `;

        this.addBotMessage('Vamos agendar seu hotel! Preencha o formulário abaixo:', formHTML);
        this.setMinCheckoutDate();
    }

    // Configurar data mínima para checkout
    setMinCheckoutDate() {
        setTimeout(() => {
            const checkinInput = document.getElementById('hotel-checkin');
            const checkoutInput = document.getElementById('hotel-checkout');
            
            if (checkinInput && checkoutInput) {
                // Data mínima é hoje
                const today = new Date().toISOString().split('T')[0];
                checkinInput.min = today;
                
                checkinInput.addEventListener('change', () => {
                    if (checkinInput.value) {
                        const minCheckout = new Date(checkinInput.value);
                        minCheckout.setDate(minCheckout.getDate() + 1);
                        checkoutInput.min = minCheckout.toISOString().split('T')[0];
                        checkoutInput.disabled = false;
                    }
                });
            }
        }, 100);
    }

    // Submeter formulário de hotel
    submitHotelForm() {
        const formData = this.getHotelFormData();
        
        if (this.validateHotelForm(formData)) {
            this.sendFormToAgent('hotel', formData)
                .then(() => {
                    this.addBotMessage(
                        'Solicitação de hotel enviada! Em breve retornarei com opções.'
                    );
                })
                .catch(() => {
                    this.addBotMessage(
                        'Não foi possível enviar ao n8n agora. Tente novamente mais tarde.'
                    );
                });
        }
    }

    // Obter dados do formulário de hotel
    getHotelFormData() {
        return {
            cidade: document.getElementById('hotel-city').value,
            checkin: document.getElementById('hotel-checkin').value,
            checkout: document.getElementById('hotel-checkout').value,
            hospedes: document.getElementById('hotel-guests').value,
            quartos: document.getElementById('hotel-rooms').value,
            timestamp: new Date().toISOString()
        };
    }

    // Validar formulário de hotel
    validateHotelForm(data) {
        if (!data.cidade) {
            this.showFormError('Por favor, informe a cidade.');
            return false;
        }
        if (!data.checkin || !data.checkout) {
            this.showFormError('Por favor, selecione as datas de check-in e check-out.');
            return false;
        }
        if (!data.hospedes) {
            this.showFormError('Por favor, selecione o número de hóspedes.');
            return false;
        }
        if (!data.quartos) {
            this.showFormError('Por favor, selecione o número de quartos.');
            return false;
        }
        return true;
    }

    // ===== FUNÇÕES UTILITÁRIAS =====
    addUserMessage(message) {
        this.addMessage(message, 'user');
    }

    addBotMessage(message, formHTML = null) {
        this.addMessage(message, 'bot', formHTML);
    }

    addMessage(content, type, formHTML = null) {
        const messagesContainer = document.getElementById('chatbot-messages');
        if (!messagesContainer) {
            console.error('Container de mensagens não encontrado!');
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}-message`;
        
        const timestamp = new Date().toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        messageDiv.innerHTML = `
            <div class="message-avatar">
                ${type === 'user' ? '👤' : '🤖'}
            </div>
            <div class="message-content">
                ${content}
                ${formHTML ? `<div class="message-form">${formHTML}</div>` : ''}
                <div class="message-timestamp">${timestamp}</div>
            </div>
        `;

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Adicionar à lista de mensagens
        this.messages.push({
            type: type,
            content: content,
            timestamp: new Date(),
            form: formHTML ? true : false
        });
    }

    closeCurrentForm() {
        this.currentForm = null;
        this.formData = {};
    }

    showFormError(message) {
        this.addBotMessage(`❌ ${message}`);
    }

    // Funções de informação rápida (simplificadas para teste)
    showUpcomingEvents() {
        this.addBotMessage(`
            📅 <strong>Próximos Eventos</strong><br><br>
            Estou verificando sua agenda...<br>
            Em breve mostrarei seus próximos compromissos!
        `);
    }

    showRouteInfo() {
        this.addBotMessage(`
            🗺️ <strong>Informações de Rota</strong><br><br>
            Analisando suas rotas otimizadas...<br>
            Mostrarei as melhores opções de trajeto!
        `);
    }

    

    showRestaurantForm() {
        this.addBotMessage(`
            🍽️ <strong>Reserva de Restaurante</strong><br><br>
            Em breve disponível!<br>
            No momento, você pode usar o formulário de hotel.
        `);
    }

    showReminderForm() {
        this.addBotMessage(`
            ⏰ <strong>Criar Lembrete</strong><br><br>
            Em breve disponível!<br>
            Estamos desenvolvendo esta funcionalidade.
        `);
    }

    // Integração com n8n (simplificada para teste)
    sendToN8N(action, data) {
        console.log('Enviando para n8n:', action, data);
        this.addBotMessage(`
            ✅ <strong>Solicitação enviada com sucesso!</strong><br><br>
            Sua solicitação de ${action} foi enviada para processamento.<br>
            Em breve você receberá as opções disponíveis.
        `);
    }
}

// Inicializar chatbot quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM carregado, inicializando chatbot...');
    window.chatbotManager = new ChatbotManager();
});

// Também inicializar quando a janela carregar completamente
window.addEventListener('load', function() {
    console.log('Página totalmente carregada');
    if (!window.chatbotManager) {
        window.chatbotManager = new ChatbotManager();
    }
});
