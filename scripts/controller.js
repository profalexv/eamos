// --- 1. CONFIGURAÇÃO E INICIALIZAÇÃO ---
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Conecta diretamente ao backend, usando o namespace '/eamos'
const socketUrl = isDevelopment ? 'http://localhost:3000/eamos' : 'https://profalexv-alexluza.onrender.com/eamos';
const socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
});
let sessionDeadline = null;
let currentQuestions = []; // Armazena a lista de perguntas da sessão
let previousUsers = {}; // Armazena o estado anterior da lista de usuários para notificações

/**
 * Aplica um tema visual ao body, trocando a classe de tema.
 * @param {string} theme - O nome do tema (ex: 'light', 'dark', 'corporate').
 */
function applyTheme(theme = 'light') {
    console.log(`Aplicando tema de controller: ${theme}`);
    const body = document.body;
    // Remove temas antigos para garantir que apenas um esteja ativo
    body.classList.remove('theme-light', 'theme-dark', 'theme-corporate', 'theme-fun', 'theme-sublime');
    body.classList.add(`theme-${theme}`);
}

// --- 2. MÓDULO DE UI ---
// Gerencia todas as interações com o DOM e os event listeners.
const ui = {
    editingQuestionId: null, // To track which question is being edited
    sortableInstance: null,
    progressModalViewIndex: 0,
    elements: {
        sessionCodeDisplay: document.getElementById('session-code'),
        questionTypeSelect: document.getElementById('question-type'),
        optionsConfig: document.getElementById('options-config'), // Container para toda a config de opções
        textAnswerConfig: document.getElementById('text-answer-config'), // Container para config de resposta de texto
        textConfig: document.getElementById('text-config'),
        timerEnabledCheckbox: document.getElementById('timer-enabled'),
        timerOptionsDiv: document.getElementById('timer-options'),
        createBtn: document.getElementById('create-question-btn'),
        cancelEditBtn: document.getElementById('cancel-edit-btn'),
        openPresenterBtn: document.getElementById('open-presenter-btn'),
        toggleUrlBtn: document.getElementById('toggle-url-btn'),
        resetAllBtn: document.getElementById('reset-all-btn'),
        endSessionBtn: document.getElementById('end-session-btn'),
        questionsContainer: document.getElementById('questions-container'),
        saveQuestionsBtn: document.getElementById('save-questions-btn'),
        loadQuestionsBtn: document.getElementById('load-questions-btn'),
        loadQuestionsInput: document.getElementById('load-questions-input'),
        sessionThemeSwitcher: document.getElementById('session-theme-switcher'),
        audienceCounter: document.getElementById('audience-counter'),
        audienceListContainer: document.getElementById('audience-list-container'),
        toastContainer: document.getElementById('toast-container'),
        formColumn: document.querySelector('.form-column'),
        notificationSound: document.getElementById('notification-sound'),
        // New elements
        sessionCodeContainer: document.getElementById('session-code-container'),
        headerRankingContainer: document.getElementById('header-ranking-container'),
        progressModalOverlay: document.getElementById('progress-modal-overlay'),
        progressModalContent: document.getElementById('progress-modal-content'),
        progressModalBody: document.getElementById('progress-modal-body'),
        progressModalClose: document.getElementById('progress-modal-close'),
        // Novos elementos para controle da visão do presenter
        presenterViewModeSelect: document.getElementById('presenter-view-mode'),
        chartTypeOptions: document.getElementById('chart-type-options'),
        presenterShowRankPositionCheckbox: document.getElementById('presenter-show-rank-position'),
        chartTypeRadios: document.querySelectorAll('input[name="chart-type"]'),
        audienceViewModeCheckboxes: document.querySelectorAll('input[name="audience-view-mode"]'),
        // Inputs do formulário
        questionTextInput: document.getElementById('question-text'),
        correctAnswerInput: document.getElementById('correct-answer'),
        additionalAnswersContainer: document.getElementById('additional-answers-container'),
        addAnswerBtn: document.getElementById('add-answer-btn'),
        imageUrlInput: document.getElementById('question-image'),
        mediaUrlInput: document.getElementById('media-url'),
        optionsList: document.getElementById('options-list'),
        addOptionBtn: document.getElementById('add-option-btn'),
        charLimitInput: document.getElementById('char-limit'),
        timerDurationInput: document.getElementById('timer-duration'),
        timerShowAudienceCheckbox: document.getElementById('timer-show-audience'),
        // MCQ Logic
        mcqLogicConfig: document.getElementById('mcq-logic-config'),
        mcqAcceptMultipleCheckbox: document.getElementById('mcq-accept-multiple'),
        mcqRequireAllLabel: document.getElementById('mcq-require-all-label'),
        mcqRequireAllCheckbox: document.getElementById('mcq-require-all'),
        // Skip logic inputs
        skipConfigYesNo: document.getElementById('skip-config-yesno'),
        skipOnWrongCheckbox: document.getElementById('skip-on-wrong'),
        skipConfigMcqNumber: document.getElementById('skip-config-mcq-number'),
        autoSkipAttemptsMcqInput: document.getElementById('auto-skip-attempts-mcq'),
        skipConfigText: document.getElementById('skip-config-text'),
        allowSkipAttemptsInput: document.getElementById('allow-skip-attempts'),
        autoSkipAttemptsTextInput: document.getElementById('auto-skip-attempts-text'),
    },

    setCreateButtonState(isLoading) {
        if (!this.elements.createBtn) return;
        const originalText = this.editingQuestionId !== null ? 'Salvar Alterações' : 'Criar Pergunta';
        if (isLoading) {
            this.elements.createBtn.disabled = true;
            this.elements.createBtn.innerHTML = `<span class="spinner"></span> Processando...`;
        } else {
            this.elements.createBtn.disabled = false;
            this.elements.createBtn.innerText = originalText;
        }
    },

    init(socketHandler) {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        const presenterPassword = sessionStorage.getItem('eamos_presenter_pass');

        if (this.elements.sessionCodeDisplay) {
            this.elements.sessionCodeDisplay.innerText = sessionCode;
        }

        this.elements.timerEnabledCheckbox?.addEventListener('change', (e) => this.toggleTimerOptions(e.target.checked));

        // Listeners para os botões de adicionar dinâmico
        this.elements.addAnswerBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.addAnswerInput();
        });
        this.elements.addOptionBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.addOptionInput();
        });

        // Add listeners to remove validation error on input
        this.elements.questionTextInput.addEventListener('input', () => this.elements.questionTextInput.classList.remove('invalid'));

        // Listener for clickable session code
        this.elements.sessionCodeContainer?.addEventListener('click', () => {
            const sessionCode = this.elements.sessionCodeDisplay.innerText;
            const audienceUrl = `${window.location.origin}/pages/audience.html?session=${sessionCode}`;
            navigator.clipboard.writeText(audienceUrl).then(() => {
                this.showToast('Link de acesso copiado!');
            }).catch(err => {
                console.error('Falha ao copiar o link: ', err);
                this.showToast('Falha ao copiar o link.', 'error');
            });
        });

        // Listeners for progress modal
        this.setupProgressModal();

        this.elements.createBtn?.addEventListener('click', () => {
            this.setCreateButtonState(true);
            const questionData = this.getQuestionData();

            if (questionData) {
                const onComplete = (response) => {
                    if (response && response.success) {
                        this.exitEditMode();
                    }
                    this.setCreateButtonState(false);
                };

                if (this.editingQuestionId !== null) {
                    socketHandler.editQuestion(this.editingQuestionId, questionData, onComplete);
                } else {
                    socketHandler.createQuestion(questionData, onComplete);
                }
            } else {
                // If validation fails locally, re-enable the button
                this.setCreateButtonState(false);
            }
        });

        this.elements.cancelEditBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.exitEditMode();
        });

        this.elements.toggleUrlBtn?.addEventListener('click', () => {
            const isHiding = this.elements.toggleUrlBtn.innerText.includes('Ocultar');
            const newVisibility = !isHiding;
            socketHandler.toggleAudienceUrl(newVisibility);
            this.elements.toggleUrlBtn.innerText = newVisibility ? 'Ocultar Endereço' : 'Exibir Endereço';
        });

        this.elements.resetAllBtn?.addEventListener('click', () => {
            if (confirm('Tem certeza que deseja zerar o progresso de TODOS os participantes?')) {
                socketHandler.resetAllUsersProgress();
            }
        });

        if (this.elements.openPresenterBtn) {
            if (presenterPassword) {
                this.elements.openPresenterBtn.addEventListener('click', () => {
                    // Usa localStorage para passar a senha para a nova aba de forma segura
                    localStorage.setItem('eamos_temp_pass', presenterPassword);
                    window.open(`presenter.html?session=${sessionCode}`, '_blank');
                });
            } else {
                this.elements.openPresenterBtn.disabled = true;
                this.elements.openPresenterBtn.title = 'Disponível apenas para sessões criadas neste navegador.';
            }
        }

        this.elements.endSessionBtn?.addEventListener('click', () => {
            if (confirm('Tem certeza que deseja encerrar esta sessão para todos os participantes?')) {
                socketHandler.endSession();
            }
        });

        this.elements.sessionThemeSwitcher?.addEventListener('change', (e) => {
            const newTheme = e.target.value;
            socketHandler.changeTheme(newTheme);
        });

        this.elements.saveQuestionsBtn?.addEventListener('click', () => {
            this.saveQuestionsToFile();
        });

        this.elements.loadQuestionsBtn?.addEventListener('click', () => {
            this.elements.loadQuestionsInput.click();
        });

        this.elements.loadQuestionsInput?.addEventListener('change', (e) => {
            this.loadQuestionsFromFile(e.target.files[0], socketHandler);
        });

        // Inicializa o Drag-and-Drop na lista de perguntas
        this.sortableInstance = new Sortable(this.elements.questionsContainer, {
            animation: 150,
            handle: '.drag-handle', // Classe do elemento que aciona o arrastar
            onEnd: (evt) => {
                // Previne o bug do SortableJS onde o onEnd é chamado ao filtrar
                if (evt.oldIndex === undefined || evt.newIndex === undefined) {
                    return;
                }

                // Verifica se o item foi realmente movido para uma nova posição
                if (evt.oldIndex === evt.newIndex && evt.from === evt.to) {
                    return;
                }


                // Reordena o array local
                const [movedItem] = currentQuestions.splice(evt.oldIndex, 1);
                currentQuestions.splice(evt.newIndex, 0, movedItem);

                socketHandler.reorderQuestions(currentQuestions);
            },
        });

        // --- Listeners para Controle da Visão do Presenter ---
        console.log("DEBUG: Procurando elementos de controle do presenter...");
        console.log("DEBUG: Select de modo:", this.elements.presenterViewModeSelect);
        console.log("DEBUG: Opções de gráfico:", this.elements.chartTypeOptions);

        this.elements.presenterViewModeSelect?.addEventListener('change', () => {
            this.handlePresenterModeChange(socketHandler);
        });

        this.elements.chartTypeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                this.handlePresenterModeChange(socketHandler);
            });
        });

        this.elements.presenterShowRankPositionCheckbox?.addEventListener('change', () => {
            this.handlePresenterModeChange(socketHandler);
        });

        this.elements.audienceViewModeCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.handleAudienceViewChange(socketHandler);
            });
        });

        this.elements.questionTypeSelect.addEventListener('change', () => {
            this.toggleQuestionTypeOptions(this.elements.questionTypeSelect.value);
            });
        
        this.elements.mcqAcceptMultipleCheckbox?.addEventListener('change', (e) => {
            const showRequireAll = e.target.checked;
            this.elements.mcqRequireAllLabel.style.display = showRequireAll ? 'flex' : 'none';
            if (!showRequireAll) this.elements.mcqRequireAllCheckbox.checked = false;
        });
    },

    getQuestionData() {
        // Clear previous validation errors
        this.elements.questionTextInput.classList.remove('invalid');

        let isValid = true;

        const questionText = this.elements.questionTextInput.value.trim();

        const questionType = this.elements.questionTypeSelect.value;

        const question = {
            text: questionText,
            correctAnswer: [], // Será preenchido abaixo
            imageUrl: this.elements.imageUrlInput.value || null,
            mediaUrl: this.elements.mediaUrlInput.value || null,
            questionType: questionType,
            options: null,
            charLimit: null,
            timer: null,
            skipConfig: {},
            answerConfig: {} // Para lógica de MCQ
        };

        // Validação e coleta de dados por tipo de pergunta
        if (!question.text) {
            this.elements.questionTextInput.classList.add('invalid');
            this.elements.questionTextInput.focus();
            isValid = false;
        }

        if (['short_text', 'long_text'].includes(questionType)) {
            const mainAnswer = this.elements.correctAnswerInput.value.trim();
            if (!mainAnswer) {
                this.elements.correctAnswerInput.classList.add('invalid');
                if (isValid) this.elements.correctAnswerInput.focus();
                isValid = false;
            } else {
                question.correctAnswer.push(mainAnswer);
            }
            this.elements.additionalAnswersContainer.querySelectorAll('input').forEach(input => {
                const altAnswer = input.value.trim();
                if (altAnswer) question.correctAnswer.push(altAnswer);
            });
        }

        if (questionType === 'options') {
            const optionRows = this.elements.optionsList.querySelectorAll('.dynamic-input-row');
            if (optionRows.length < 2) {
                this.showToast('Perguntas de múltipla escolha devem ter pelo menos 2 opções.', 'error');
                isValid = false;
            }

            question.options = [];
            optionRows.forEach((row, index) => {
                const optionText = row.querySelector('input[type="text"]').value.trim();
                const isCorrect = row.querySelector('input[type="checkbox"]').checked;
                const optionId = `opt${index}`;
                
                if (optionText) {
                    question.options.push({ id: optionId, text: optionText });
                    if (isCorrect) {
                        question.correctAnswer.push(optionId);
                    }
                }
            });

            if (question.correctAnswer.length === 0) {
                this.showToast('Selecione pelo menos uma resposta correta para a pergunta.', 'error');
                isValid = false;
            }
            question.answerConfig.acceptMultiple = this.elements.mcqAcceptMultipleCheckbox.checked;
            question.answerConfig.requireAll = this.elements.mcqRequireAllCheckbox.checked;
        }

        if (question.questionType === 'short_text') {
            question.charLimit = parseInt(this.elements.charLimitInput.value) || 25;
        } else if (question.questionType === 'long_text') {
            question.charLimit = null; // No limit
        }

        // Get Skip Logic Config
        switch (question.questionType) {
            case 'yes_no':
                question.skipConfig.autoSkipOnWrong = this.elements.skipOnWrongCheckbox.checked;
                break;
            case 'options':
            case 'number':
            case 'integer':
                const autoSkipMcq = parseInt(this.elements.autoSkipAttemptsMcqInput.value);
                if (autoSkipMcq > 0) question.skipConfig.autoSkipAfter = autoSkipMcq;
                break;
            case 'short_text':
            case 'long_text':
                const allowSkip = parseInt(this.elements.allowSkipAttemptsInput.value);
                const autoSkipText = parseInt(this.elements.autoSkipAttemptsTextInput.value);
                if (allowSkip > 0) question.skipConfig.allowSkipAfter = allowSkip;
                if (autoSkipText > 0) question.skipConfig.autoSkipAfter = autoSkipText;
                break;
        }

        if (this.elements.timerEnabledCheckbox.checked) {
            const durationInMinutes = parseInt(this.elements.timerDurationInput.value);
            if (durationInMinutes > 0) {
                question.timer = {
                    duration: durationInMinutes * 60, // Converte para segundos
                    showToAudience: this.elements.timerShowAudienceCheckbox.checked
                };
            }
        }

        if (!isValid) return null;
        return question;
    },

    clearForm() {
        this.elements.questionTextInput.value = '';
        this.elements.imageUrlInput.value = '';
        this.elements.mediaUrlInput.value = '';
        this.elements.correctAnswerInput.value = '';
        this.elements.additionalAnswersContainer.innerHTML = '';
        this.elements.optionsList.innerHTML = '';
        this.elements.charLimitInput.value = '';
        this.elements.timerEnabledCheckbox.checked = false;
        this.elements.timerDurationInput.value = '';
        this.elements.timerShowAudienceCheckbox.checked = false;
        this.toggleTimerOptions(false);
        // Clear MCQ logic
        this.elements.mcqAcceptMultipleCheckbox.checked = false;
        this.elements.mcqRequireAllCheckbox.checked = false;
        this.elements.mcqRequireAllLabel.style.display = 'none';
        // Clear skip logic
        this.elements.skipOnWrongCheckbox.checked = true; // Default for yes/no
        this.elements.autoSkipAttemptsMcqInput.value = '';
        this.elements.allowSkipAttemptsInput.value = '';
        this.elements.autoSkipAttemptsTextInput.value = '';
        // Set default question type
        this.elements.questionTypeSelect.value = 'short_text';
        this.toggleQuestionTypeOptions('short_text');
    },

    setupProgressModal() {
        const openModal = () => {
            this.progressModalViewIndex = 0; // Reset to first view
            this.renderProgressModalContent();
            this.elements.progressModalOverlay.style.display = 'flex';
        };

        const closeModal = () => {
            this.elements.progressModalOverlay.style.display = 'none';
        };

        const cycleView = (e) => {
            // Prevent closing when clicking inside the content, but not on the close button
            if (e.target.id === 'progress-modal-close') return;
            
            this.progressModalViewIndex++;
            this.renderProgressModalContent();
        };

        this.elements.headerRankingContainer?.addEventListener('click', openModal);
        this.elements.progressModalClose?.addEventListener('click', closeModal);
        this.elements.progressModalContent?.addEventListener('click', cycleView);
    },

    addAnswerInput(value = '') {
        const container = this.elements.additionalAnswersContainer;
        const div = document.createElement('div');
        div.className = 'dynamic-input-row';
        div.innerHTML = `
            <input type="text" value="${value}" placeholder="Resposta alternativa">
            <button class="remove-btn" title="Remover resposta">X</button>
        `;
        div.querySelector('.remove-btn').onclick = () => div.remove();
        container.appendChild(div);
    },

    addOptionInput(text = '', isCorrect = false) {
        const container = this.elements.optionsList;
        const div = document.createElement('div');
        div.className = 'dynamic-input-row';
        div.innerHTML = `
            <input type="checkbox" ${isCorrect ? 'checked' : ''} title="Marcar como resposta correta">
            <input type="text" value="${text}" placeholder="Texto da opção">
            <button class="remove-btn" title="Remover opção">X</button>
        `;
        div.querySelector('.remove-btn').onclick = () => div.remove();
        container.appendChild(div);
    },

    exitEditMode() {
        this.clearForm();
        this.editingQuestionId = null;
        this.elements.createBtn.innerText = 'Criar Pergunta';
        this.elements.cancelEditBtn.style.display = 'none';
    },

    handlePresenterModeChange(socketHandler) {
        if (!this.elements.presenterViewModeSelect) return;

        const mode = this.elements.presenterViewModeSelect.value;
        const chartTypeRadio = document.querySelector('input[name="chart-type"]:checked');
        const chartType = chartTypeRadio ? chartTypeRadio.value : 'bar';
        const showRankPosition = this.elements.presenterShowRankPositionCheckbox.checked;

        // Mostra/oculta opções de tipo de gráfico
        const showChartOptions = ['individual', 'overall'].includes(mode);
        this.elements.chartTypeOptions.style.display = showChartOptions ? 'block' : 'none';
        this.elements.presenterShowRankPositionCheckbox.parentElement.style.display = mode === 'ranking' ? 'flex' : 'none';

        socketHandler.changePresenterMode(mode, chartType, showRankPosition);
    },

    handleAudienceViewChange(socketHandler) {
        if (!this.elements.audienceViewModeCheckboxes) return;

        const allowedViews = Array.from(this.elements.audienceViewModeCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);
        
        socketHandler.changeAudienceView(allowedViews);
    },

    setAudienceViewControls(audienceView) {
        if (!audienceView || !this.elements.audienceViewModeCheckboxes) return;
        this.elements.audienceViewModeCheckboxes.forEach(checkbox => {
            checkbox.checked = audienceView.includes(checkbox.value);
        });
    },

    setPresenterModeControls(presenterMode) {
        if (!presenterMode || !this.elements.presenterViewModeSelect) return;

        this.elements.presenterViewModeSelect.value = presenterMode.mode;
        this.elements.presenterShowRankPositionCheckbox.checked = presenterMode.showRankPosition || false;
        this.elements.presenterShowRankPositionCheckbox.parentElement.style.display = presenterMode.mode === 'ranking' ? 'flex' : 'none';

        const showChartOptions = ['individual', 'overall'].includes(presenterMode.mode);
        this.elements.chartTypeOptions.style.display = showChartOptions ? 'block' : 'none';

        if (showChartOptions && presenterMode.chartType) {
            const radio = document.querySelector(`input[name="chart-type"][value="${presenterMode.chartType}"]`);
            if (radio) radio.checked = true;
        }
    },

    toggleTimerOptions: (isEnabled) => ui.elements.timerOptionsDiv && (ui.elements.timerOptionsDiv.style.display = isEnabled ? 'block' : 'none'),

    toggleQuestionTypeOptions(type) {
        if (this.elements.optionsConfig) this.elements.optionsConfig.style.display = type === 'options' ? 'block' : 'none';
        const isTextAnswer = ['short_text', 'long_text'].includes(type);
        if (this.elements.textAnswerConfig) this.elements.textAnswerConfig.style.display = isTextAnswer ? 'block' : 'none';
        if (this.elements.textConfig) this.elements.textConfig.style.display = ['short_text', 'long_text'].includes(type) ? 'block' : 'none';

        // Toggle skip logic sections
        if (this.elements.skipConfigYesNo) {
            this.elements.skipConfigYesNo.style.display = type === 'yes_no' ? 'block' : 'none';
        }
        if (this.elements.skipConfigMcqNumber) {
            const isMcqOrNumber = ['options', 'number', 'integer'].includes(type);
            this.elements.skipConfigMcqNumber.style.display = isMcqOrNumber ? 'block' : 'none';
        }
        if (this.elements.skipConfigText && isTextAnswer) { // Only show for text types
            const isText = ['short_text', 'long_text'].includes(type);
            this.elements.skipConfigText.style.display = isText ? 'block' : 'none';
        }
    },

    renderQuestions(questions, socketHandler) {
        currentQuestions = questions; // Atualiza a lista de perguntas local
        const container = this.elements.questionsContainer;
        if (!container) return;
        container.innerHTML = '';

        const validQuestions = questions.filter(q => q !== null);
        if (validQuestions.length === 0) {
            container.innerHTML = '<p>Nenhuma pergunta criada ainda.</p>';
            this.renderHeaderRanking(previousUsers, 0); // Update header with 0 questions
            return;
        }

        // After rendering, always reset the create button state
        this.setCreateButtonState(false);
        this.renderHeaderRanking(previousUsers, validQuestions.length); // Render header ranking

        validQuestions.forEach((q, index) => {
            const div = document.createElement('div');
            div.className = `question-item`;
            div.id = `question-item-${q.id}`;
            div.innerHTML = `
                <span class="drag-handle" title="Arraste para reordenar">↕️</span>
                <div class="question-main">
                    <p><strong>${index + 1}. ${q.text}</strong></p>
                </div>
                <div class="question-item-controls" id="question-controls-${q.id}"></div>
            `;
            container.appendChild(div);

            const controlsDiv = div.querySelector(`#question-controls-${q.id}`);

            // Botão de Editar
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '✏️ <span class="btn-text">Editar</span>';
            editBtn.className = 'icon-button edit-btn';
            editBtn.title = 'Editar Pergunta';
            editBtn.onclick = () => this.enterEditMode(q);

            // Botão de Duplicar
            const duplicateBtn = document.createElement('button');
            duplicateBtn.innerHTML = '📋 <span class="btn-text">Duplicar</span>';
            duplicateBtn.className = 'icon-button duplicate-btn';
            duplicateBtn.title = 'Duplicar Pergunta';
            duplicateBtn.onclick = () => this.enterDuplicateMode(q);

            // Botão de Deletar
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '🗑️ <span class="btn-text">Deletar</span>';
            deleteBtn.className = 'icon-button danger delete-btn';
            deleteBtn.title = 'Deletar Pergunta';
            deleteBtn.onclick = () => {
                if (confirm(`Tem certeza que deseja deletar a pergunta "${q.text}"?`)) {
                    socketHandler.deleteQuestion(q.id);
                }
            };

            controlsDiv.appendChild(editBtn);
            controlsDiv.appendChild(duplicateBtn);
            controlsDiv.appendChild(deleteBtn);
        });
    },

    renderUserList(users, totalQuestions, socketHandler) {
        const container = this.elements.audienceListContainer;
        if (!container) return;

        // --- Lógica de Notificação Sonora ---
        try {
            // Filtra por usuários que acabaram de entrar no estado 'pending'
            const newPendingUsers = Object.values(users).filter(user => 
                user.status === 'pending' && 
                (!previousUsers[user.socketId] || previousUsers[user.socketId].status !== 'pending')
            );

            // Toca o som se houver novos usuários pendentes e a aba estiver em foco
            if (newPendingUsers.length > 0 && this.elements.notificationSound && document.hasFocus()) {
                this.elements.notificationSound.currentTime = 0; // Reinicia o áudio
                this.elements.notificationSound.play().catch(error => {
                    console.warn("Não foi possível tocar o som de notificação:", error, "O navegador pode exigir uma interação do usuário primeiro.");
                });
            }
        } catch (e) {
            console.error("Erro na lógica de notificação sonora:", e);
        } finally {
            // Atualiza o estado anterior para a próxima comparação (cópia profunda para segurança)
            previousUsers = JSON.parse(JSON.stringify(users));
        }
        // --- Fim da Lógica de Notificação ---

        container.innerHTML = '<h3>Participantes</h3>';
        this.renderHeaderRanking(users, totalQuestions);

        const userArray = Object.values(users);
        if (userArray.length === 0) {
            container.innerHTML += '<p>Nenhum participante conectado.</p>';
            return;
        }

        userArray.sort((a, b) => a.name.localeCompare(b.name)).forEach(user => {
            const userDiv = document.createElement('div');
            userDiv.className = `user-item status-${user.status}`;
            userDiv.id = `user-item-${user.socketId}`;

            let statusText = '';
            switch (user.status) {
                case 'pending': statusText = ' (Aguardando aprovação)'; break;
                case 'disconnected': statusText = ' (Desconectado)'; break;
                case 'approved': statusText = ` (${user.progress}/${totalQuestions})`; break;
            }

            userDiv.innerHTML = `
                <div class="user-info">
                    <span class="user-name">${user.name}</span>
                    <span class="user-status">${statusText}</span>
                </div>
                <div class="user-controls"></div>
            `;

            const controls = userDiv.querySelector('.user-controls');

            if (user.status === 'pending') {
                const approveBtn = document.createElement('button');
                approveBtn.innerText = 'Aprovar';
                approveBtn.className = 'approve-btn';
                approveBtn.onclick = () => socketHandler.approveUser(user.socketId);
                controls.appendChild(approveBtn);

                const rejectBtn = document.createElement('button');
                rejectBtn.innerText = 'Rejeitar';
                rejectBtn.className = 'reject-btn';
                rejectBtn.onclick = () => {
                    if (confirm(`Rejeitar a entrada de "${user.name}"?`)) {
                        socketHandler.rejectUser(user.socketId);
                    }
                };
                controls.appendChild(rejectBtn);
            } else { // approved or disconnected
                const resetBtn = document.createElement('button');
                resetBtn.innerText = 'Zerar';
                resetBtn.className = 'secondary-button';
                resetBtn.title = "Zerar progresso do participante";
                resetBtn.onclick = () => {
                    if (confirm(`Zerar o progresso de "${user.name}"? Ele voltará para a primeira pergunta.`)) {
                        socketHandler.resetUserProgress(user.socketId);
                    }
                };
                controls.appendChild(resetBtn);

                const removeBtn = document.createElement('button');
                removeBtn.innerText = 'Remover';
                removeBtn.className = 'remove-btn';
                removeBtn.onclick = () => {
                    if (confirm(`Remover "${user.name}" da sessão? Seu progresso será perdido.`)) {
                        socketHandler.removeUser(user.socketId);
                    }
                };
                controls.appendChild(removeBtn);
            }

            container.appendChild(userDiv);
        });
    },

    renderHeaderRanking(users, totalQuestions) {
        const container = this.elements.headerRankingContainer;
        if (!container) return;
        container.innerHTML = '';

        const approvedUsers = Object.values(users).filter(u => u.status === 'approved' || u.status === 'disconnected');
        if (totalQuestions === 0 || approvedUsers.length === 0) {
            container.innerHTML = '<div class="header-ranking-bar"></div>'; // Show empty bar
            return;
        }

        const sortedUsers = [...approvedUsers].sort((a, b) => b.progress - a.progress);
        const track = document.createElement('div');
        track.className = 'header-ranking-bar';

        sortedUsers.forEach((user, index) => {
            const percentage = (user.progress / totalQuestions) * 100;
            const marker = document.createElement('div');
            marker.className = 'header-ranking-marker';
            marker.style.left = `${percentage}%`;
            marker.title = `${user.name} (${user.progress}/${totalQuestions})`;

            if (index === 0) marker.classList.add('rank-first');
            if (index === sortedUsers.length - 1 && sortedUsers.length > 1) marker.classList.add('rank-last');
            
            track.appendChild(marker);
        });

        container.appendChild(track);
    },

    renderProgressModalContent() {
        const container = this.elements.progressModalBody;
        if (!container) return;

        const users = previousUsers; // Use the last known user list
        const totalQuestions = currentQuestions.length;
        const approvedUsers = Object.values(users).filter(u => u.status === 'approved' || u.status === 'disconnected');
        
        const views = ['ranking-list', 'individual', 'overall', 'list'];
        const currentView = views[this.progressModalViewIndex % views.length];

        container.innerHTML = ''; // Clear previous content

        switch(currentView) {
            case 'ranking-list':
                container.innerHTML = '<h3>Ranking Detalhado</h3>';
                const sortedUsers = [...approvedUsers].sort((a, b) => b.progress - a.progress);
                sortedUsers.forEach((user, index) => {
                    const item = document.createElement('div');
                    item.className = 'ranking-list-item';
                    item.innerHTML = `<span><strong>${index + 1}º</strong> ${user.name}</span> <span>${user.progress}/${totalQuestions}</span>`;
                    container.appendChild(item);
                });
                break;
            
            case 'individual':
                container.innerHTML = '<h3>Progresso Individual</h3>';
                const grid = document.createElement('div');
                grid.className = 'individual-charts-grid';
                approvedUsers.forEach(user => {
                    const percentage = totalQuestions > 0 ? (user.progress / totalQuestions) * 100 : 0;
                    const chartItem = document.createElement('div');
                    chartItem.className = 'chart-item';
                    chartItem.innerHTML = `
                        <div class="chart-pie" style="--p: ${percentage}">
                            <span class="chart-pie-label">${Math.round(percentage)}%</span>
                        </div>
                        <span class="user-name">${user.name}</span>
                    `;
                    grid.appendChild(chartItem);
                });
                container.appendChild(grid);
                break;

            case 'overall':
                container.innerHTML = '<h3>Progresso Geral da Turma</h3>';
                const totalProgress = approvedUsers.reduce((sum, user) => sum + user.progress, 0);
                const maxProgress = approvedUsers.length * totalQuestions;
                const averagePercentage = maxProgress > 0 ? (totalProgress / maxProgress) * 100 : 0;
                container.innerHTML += `
                    <div class="progress-track" style="height: 30px; max-width: 80%; margin: 1rem auto;">
                        <div class="progress-fill" style="width: ${averagePercentage}%;"></div>
                    </div>
                    <p>Média de conclusão da turma: <strong>${Math.round(averagePercentage)}%</strong></p>
                `;
                break;

            case 'list':
                container.innerHTML = '<h3>Lista de Progresso</h3>';
                approvedUsers.forEach(user => {
                    const percentage = totalQuestions > 0 ? (user.progress / totalQuestions) * 100 : 0;
                    const item = document.createElement('div');
                    item.className = 'user-progress-bar';
                    item.innerHTML = `<span class="user-name">${user.name}</span><div class="progress-track"><div class="progress-fill" style="width: ${percentage}%;"></div></div><span class="progress-label">${user.progress}/${totalQuestions}</span>`;
                    container.appendChild(item);
                });
                break;
        }
    },

    saveQuestionsToFile() {
        const validQuestions = currentQuestions.filter(q => q !== null);
        if (validQuestions.length === 0) {
            alert('Não há perguntas para salvar.');
            return;
        }

        if (!confirm("Atenção: O arquivo salvo incluirá as senhas de controller e presenter em texto claro, se disponíveis. Deseja continuar?")) {
            return;
        }

        const questionsToSave = validQuestions
            .filter(q => q !== null)
            // Salva a pergunta inteira, exceto por dados de estado que não devem ser persistidos
            .map(({ id, createdAt, ...rest }) => ({
                ...rest
            }));

        const sessionSettings = {
            theme: this.elements.sessionThemeSwitcher.value,
            // Inclui as senhas para facilitar a recriação da sessão
            controllerPassword: sessionStorage.getItem('eamos_session_pass') || '',
            presenterPassword: sessionStorage.getItem('eamos_presenter_pass') || ''
        };

        const exportData = {
            sessionSettings,
            questions: questionsToSave
        };

        const sessionCode = this.elements.sessionCodeDisplay.innerText;
        const filename = `eamos-session-${sessionCode}-${new Date().toISOString().slice(0, 10)}.json`;
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(dataBlob);
        downloadLink.download = filename;
        downloadLink.click();
        URL.revokeObjectURL(downloadLink.href); // Libera a memória
    },

    loadQuestionsFromFile(file, socketHandler) {
        if (!file) return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            try {
                const content = JSON.parse(e.target.result);
                // Suporta o novo formato {sessionSettings, questions} e o formato antigo [questions]
                const questions = content.questions || content;

                if (!Array.isArray(questions)) {
                    throw new Error('Formato de arquivo inválido: o arquivo não contém um array de perguntas.');
                }

                if (confirm(`Deseja adicionar ${questions.length} pergunta(s) a esta sessão?`)) {
                    questions.forEach(q => {
                        // Converte o formato das opções de volta para o que o servidor espera
                        let formattedQuestion = { ...q };
                        if (formattedQuestion.questionType === 'options' && formattedQuestion.options && Array.isArray(formattedQuestion.options)) {
                            formattedQuestion.options = formattedQuestion.options.map((optText, index) => ({ id: `opt${index}`, text: String(optText).trim() }));
                        }
                        socketHandler.createQuestion(formattedQuestion);
                    });
                }
            } catch (error) {
                alert('Erro ao carregar o arquivo: ' + error.message);
            } finally {
                // Limpa o valor do input para permitir carregar o mesmo arquivo novamente
                this.elements.loadQuestionsInput.value = '';
            }
        };
        fileReader.onerror = () => {
            alert('Não foi possível ler o arquivo.');
            this.elements.loadQuestionsInput.value = '';
        };
        fileReader.readAsText(file);
    },

    enterDuplicateMode(question) {
        if (!question) return;
        
        this.exitEditMode(); // Limpa estado anterior, garantindo editingQuestionId = null

        // Preenche o formulário com os dados da pergunta original
        this.elements.questionTextInput.value = `${question.text} (Cópia)`;
        this.elements.imageUrlInput.value = question.imageUrl || '';
        this.elements.mediaUrlInput.value = question.mediaUrl || '';
        this.elements.questionTypeSelect.value = question.questionType;
        this.toggleQuestionTypeOptions(question.questionType);

        if (['short_text', 'long_text'].includes(question.questionType) && Array.isArray(question.correctAnswer)) {
            this.elements.correctAnswerInput.value = question.correctAnswer[0] || '';
            question.correctAnswer.slice(1).forEach(ans => this.addAnswerInput(ans));
        }

        if (question.questionType === 'options') {
            question.options.forEach(opt => {
                const isCorrect = question.correctAnswer.includes(opt.id);
                this.addOptionInput(opt.text, isCorrect);
            });
            if (question.answerConfig) {
                this.elements.mcqAcceptMultipleCheckbox.checked = question.answerConfig.acceptMultiple;
                this.elements.mcqRequireAllLabel.style.display = question.answerConfig.acceptMultiple ? 'flex' : 'none';
                this.elements.mcqRequireAllCheckbox.checked = question.answerConfig.requireAll;
            }
        }
        
        if (question.questionType === 'short_text') {
            this.elements.charLimitInput.value = question.charLimit || '';
        }

        // Preenche skip logic
        if (question.skipConfig) {
            this.elements.skipOnWrongCheckbox.checked = question.skipConfig.autoSkipOnWrong !== false; // default true
            this.elements.autoSkipAttemptsMcqInput.value = question.skipConfig.autoSkipAfter || '';
            this.elements.allowSkipAttemptsInput.value = question.skipConfig.allowSkipAfter || '';
            this.elements.autoSkipAttemptsTextInput.value = question.skipConfig.autoSkipAfter || '';
        }

        if (question.timer) {
            this.elements.timerEnabledCheckbox.checked = true;
            this.toggleTimerOptions(true);
            this.elements.timerDurationInput.value = question.timer.duration / 60;
            this.elements.timerShowAudienceCheckbox.checked = question.timer.showToAudience;
        } else {
            this.elements.timerEnabledCheckbox.checked = false;
            this.toggleTimerOptions(false);
        }

        // Atualiza a UI para o modo de duplicação
        this.elements.createBtn.innerText = 'Salvar Cópia';
        this.elements.cancelEditBtn.style.display = 'block';
        this.elements.formColumn.scrollIntoView({ behavior: 'smooth' });
        this.elements.questionTextInput.focus();
    },

    enterEditMode(question) {
        if (!question) return;
        
        this.exitEditMode(); // Limpa estado anterior
        this.editingQuestionId = question.id;

        // Preenche o formulário
        this.elements.questionTextInput.value = question.text;
        this.elements.imageUrlInput.value = question.imageUrl || '';
        this.elements.mediaUrlInput.value = question.mediaUrl || '';
        this.elements.questionTypeSelect.value = question.questionType;
        this.toggleQuestionTypeOptions(question.questionType);

        if (['short_text', 'long_text'].includes(question.questionType) && Array.isArray(question.correctAnswer)) {
            this.elements.correctAnswerInput.value = question.correctAnswer[0] || '';
            question.correctAnswer.slice(1).forEach(ans => this.addAnswerInput(ans));
        }

        if (question.questionType === 'options') {
            question.options.forEach(opt => {
                const isCorrect = question.correctAnswer.includes(opt.id);
                this.addOptionInput(opt.text, isCorrect);
            });
            if (question.answerConfig) {
                this.elements.mcqAcceptMultipleCheckbox.checked = question.answerConfig.acceptMultiple;
                this.elements.mcqRequireAllLabel.style.display = question.answerConfig.acceptMultiple ? 'flex' : 'none';
                this.elements.mcqRequireAllCheckbox.checked = question.answerConfig.requireAll;
            }
        }

        if (question.questionType === 'short_text') {
            this.elements.charLimitInput.value = question.charLimit || '';
        }

        // Preenche skip logic
        if (question.skipConfig) {
            this.elements.skipOnWrongCheckbox.checked = question.skipConfig.autoSkipOnWrong !== false; // default true
            this.elements.autoSkipAttemptsMcqInput.value = question.skipConfig.autoSkipAfter || '';
            this.elements.allowSkipAttemptsInput.value = question.skipConfig.allowSkipAfter || '';
            this.elements.autoSkipAttemptsTextInput.value = question.skipConfig.autoSkipAfter || '';
        }

        if (question.timer) {
            this.elements.timerEnabledCheckbox.checked = true;
            this.toggleTimerOptions(true);
            this.elements.timerDurationInput.value = question.timer.duration / 60;
            this.elements.timerShowAudienceCheckbox.checked = question.timer.showToAudience;
        } else {
            this.elements.timerEnabledCheckbox.checked = false;
            this.toggleTimerOptions(false);
        }

        // Atualiza a UI
        this.elements.createBtn.innerText = 'Salvar Alterações';
        this.elements.cancelEditBtn.style.display = 'block';
        this.elements.formColumn.scrollIntoView({ behavior: 'smooth' });
        this.elements.questionTextInput.focus();
    },

    exportQuestionResultsToCSV(question) {
        if (!question || !question.results || Object.keys(question.results).length === 0) {
            alert('Não há resultados para exportar para esta pergunta.');
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,";
        const rows = [];

        if (question.questionType === 'options') {
            rows.push(['Opção', 'Votos']);
            question.options.forEach(opt => {
                rows.push([`"${opt.text.replace(/"/g, '""')}"`, question.results[opt.id] || 0]);
            });
        } else if (question.questionType === 'yes_no') {
            rows.push(['Opção', 'Votos']);
            rows.push(['Sim', question.results.yes || 0]);
            rows.push(['Não', question.results.no || 0]);
        } else { // Text-based answers
            rows.push(['Resposta', 'Contagem']);
            for (const [answer, count] of Object.entries(question.results)) {
                rows.push([`"${answer.replace(/"/g, '""')}"`, count]);
            }
        }

        rows.forEach(rowArray => {
            csvContent += rowArray.join(",") + "\r\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        const sanitizedText = question.text.replace(/[^a-z0-9]/gi, '_').slice(0, 20);
        link.setAttribute("download", `resultados_${sanitizedText}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    handleSessionEnded: (message) => { alert(message); window.location.href = '../index.html'; },

    handleJoinResponse(response) {
        if (!response.success) {
            alert(response.message);
            window.location.href = `admin.html?role=controller`;
            return;
        }
        if (response.users) {
            this.renderUserList(response.users, response.totalQuestions, socketHandler);
        }
        sessionDeadline = response.deadline;
        // Atualiza o texto do botão com base no estado recebido do servidor
        if (response.isAudienceUrlVisible) {
            this.elements.toggleUrlBtn.innerText = 'Ocultar Endereço';
        } else {
            this.elements.toggleUrlBtn.innerText = 'Exibir Endereço';
        }
        if (response.presenterMode) {
            this.setPresenterModeControls(response.presenterMode);
        }
        if (response.audienceView) {
            this.setAudienceViewControls(response.audienceView);
        }
        if (sessionDeadline) this.showDeadlineWarning();
    },

    updateAudienceCount(count, joined = null) {
        if (this.elements.audienceCounter) {
            this.elements.audienceCounter.innerHTML = `👥 ${count}`;
        }
        if (joined !== null) { // Apenas mostra toast em atualizações, não na carga inicial
            const message = joined ? 'Novo participante entrou!' : 'Um participante saiu.';
            this.showToast(message);
        }
    },

    showToast(message) {
        if (!this.elements.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = message;
        this.elements.toastContainer.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { 
            toast.classList.remove('show'); 
            toast.addEventListener('transitionend', () => toast.remove());
        }, 3000);
    },

    handleThemeChanged(theme) {
        // Aplica o tema visualmente na página do controller
        applyTheme(theme);

        // Atualiza o seletor para refletir o estado atual (caso outro controller mude)
        if (this.elements.sessionThemeSwitcher) {
            this.elements.sessionThemeSwitcher.value = theme;
            console.log(`INFO: Tema da sessão alterado para '${theme}'.`);
        }
    },

    showDeadlineWarning() {
        const deadlineAlertEl = document.createElement('div');
        deadlineAlertEl.id = 'deadline-alert';
        deadlineAlertEl.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; background: #d9534f; color: white; padding: 10px; text-align: center; font-weight: bold; display: none; z-index: 1000;';
        deadlineAlertEl.innerText = 'TEMPO ESGOTADO';
        document.body.insertBefore(deadlineAlertEl, document.body.firstChild);

        const remainingTime = sessionDeadline - Date.now();
        if (remainingTime <= 0) {
            // Se o prazo já passou, exibe a mensagem imediatamente.
            deadlineAlertEl.style.display = 'block';
        } else {
            // Agenda a exibição da mensagem para quando o prazo for atingido.
            setTimeout(() => {
                deadlineAlertEl.style.display = 'block';
            }, remainingTime);
        }
    }
};

// --- 3. MÓDULO DE SOCKET ---
// Gerencia toda a comunicação com o servidor via Socket.IO.
const socketHandler = {
    init() {
        socket.on('questionsUpdated', (questions) => ui.renderQuestions(questions, this));
        socket.on('userListUpdated', ({ users, totalQuestions }) => ui.renderUserList(users, totalQuestions, this));
        socket.on('sessionEnded', ({ message }) => ui.handleSessionEnded(message));
        socket.on('themeChanged', ({ theme }) => ui.handleThemeChanged(theme));
        socket.on('controllerDisplaced', ({ message }) => {
            alert(message || 'Outro controller se conectou a esta sessão. Você será desconectado.');
            // O servidor forçará a desconexão, não é necessário redirecionar aqui.
            // O evento 'disconnect' será acionado.
        });

        socket.on('connect', () => {
            console.log('✅ Conectado ao servidor. Autenticando controller...');
            this.joinSession();
        });

        socket.on('connect_error', (error) => {
            console.error('❌ Erro de conexão com o Controller:', error);
        });

        socket.on('disconnect', (reason) => {
            console.warn('⚠️ Controller desconectado do servidor:', reason);
        });
    },

    joinSession: () => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        const sessionPassword = sessionStorage.getItem('eamos_session_pass');
        if (!sessionPassword) {
            alert('Erro de autenticação. Por favor, volte e entre na sessão novamente.');
            window.location.href = `admin.html?role=controller`;
            return;
        }
        socket.emit('joinAdminSession', { sessionCode, password: sessionPassword, role: 'controller' }, (response) => {
            // Não remover a senha do sessionStorage para permitir que a re-autenticação em 'connect' funcione.
            if (response.theme) ui.handleThemeChanged(response.theme);
            ui.handleJoinResponse(response);
        });
    },
    endSession: () => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('endSession', { sessionCode });
    },
    changeTheme: (theme) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('changeTheme', { sessionCode, theme });
    },
    changePresenterMode: (mode, chartType, showRankPosition) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('changePresenterMode', { sessionCode, mode, chartType, showRankPosition });
    },
    changeAudienceView: (allowedViews) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('changeAudienceView', { sessionCode, allowedViews });
    },
    deleteQuestion: (questionId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('deleteQuestion', { sessionCode, questionId });
    },
    reorderQuestions: (newOrder) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('reorderQuestions', { sessionCode, newQuestionOrder: newOrder });
    },
    createQuestion: (questionData, callback) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('createQuestion', { sessionCode, question: questionData }, callback);
    },
    editQuestion: (questionId, questionData, callback) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('editQuestion', { sessionCode, questionId, updatedQuestion: questionData }, callback);
    },
    toggleAudienceUrl: (visible) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('toggleAudienceUrl', { sessionCode, visible });
    },
    approveUser: (userId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('approveUser', { sessionCode, userIdToApprove: userId });
    },
    rejectUser: (userId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('rejectUser', { sessionCode, userIdToReject: userId });
    },
    removeUser: (userId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('removeUser', { sessionCode, userIdToRemove: userId });
    },
    resetUserProgress: (userId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('resetUserProgress', { sessionCode, userIdToReset: userId });
    },
    resetAllUsersProgress: () => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('resetAllUsersProgress', { sessionCode });
    },
};

// --- 4. INÍCIO DA APLICAÇÃO ---
ui.init(socketHandler);
socketHandler.init();
ui.toggleQuestionTypeOptions(ui.elements.questionTypeSelect.value); // Initialize visibility