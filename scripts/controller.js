// --- 1. CONFIGURAÇÃO E INICIALIZAÇÃO ---
// Detecta ambiente (local ou produção) para conectar ao backend correto
const getBackendUrl = () => {
    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isDevelopment ? 'http://localhost:3000' : 'https://mindpool-backend.onrender.com';
};

const socket = io(getBackendUrl(), {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
});
let sessionDeadline = null;
let currentQuestions = []; // Armazena a lista de perguntas atual

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
    activeQuestionId: null, // To track which question is currently active
    sortableInstance: null,
    elements: {
        sessionCodeDisplay: document.getElementById('session-code'),
        questionTypeSelect: document.getElementById('question-type'),
        optionsConfig: document.getElementById('options-config'),
        textConfig: document.getElementById('text-config'),
        timerEnabledCheckbox: document.getElementById('timer-enabled'),
        timerOptionsDiv: document.getElementById('timer-options'),
        createBtn: document.getElementById('create-question-btn'),
        cancelEditBtn: document.getElementById('cancel-edit-btn'),
        openPresenterBtn: document.getElementById('open-presenter-btn'),
        toggleUrlBtn: document.getElementById('toggle-url-btn'),
        endSessionBtn: document.getElementById('end-session-btn'),
        questionsContainer: document.getElementById('questions-container'),
        saveQuestionsBtn: document.getElementById('save-questions-btn'),
        loadQuestionsBtn: document.getElementById('load-questions-btn'),
        loadQuestionsInput: document.getElementById('load-questions-input'),
        sessionThemeSwitcher: document.getElementById('session-theme-switcher'),
        audienceCounter: document.getElementById('audience-counter'),
        toastContainer: document.getElementById('toast-container'),
        formColumn: document.querySelector('.form-column'),
        presenterPreviewBox: document.getElementById('presenter-preview-box'),
        previewModalOverlay: document.getElementById('preview-modal-overlay'),
        // Inputs do formulário
        questionTextInput: document.getElementById('question-text'),
        imageUrlInput: document.getElementById('question-image'),
        optionsTextInput: document.getElementById('question-options'),
        charLimitInput: document.getElementById('char-limit'),
        timerDurationInput: document.getElementById('timer-duration'),
        timerShowAudienceCheckbox: document.getElementById('timer-show-audience'),
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
        const presenterPassword = sessionStorage.getItem('mindpool_presenter_pass');

        if (this.elements.sessionCodeDisplay) {
            this.elements.sessionCodeDisplay.innerText = sessionCode;
        }

        this.elements.timerEnabledCheckbox?.addEventListener('change', (e) => this.toggleTimerOptions(e.target.checked));
        this.elements.questionTypeSelect?.addEventListener('change', (e) => this.toggleQuestionTypeOptions(e.target.value));

        this.setupPresenterPreview();

        // Add listeners to remove validation error on input
        this.elements.questionTextInput.addEventListener('input', () => this.elements.questionTextInput.classList.remove('invalid'));
        this.elements.optionsTextInput.addEventListener('input', () => this.elements.optionsTextInput.classList.remove('invalid'));

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

        if (this.elements.openPresenterBtn) {
            if (presenterPassword) {
                this.elements.openPresenterBtn.addEventListener('click', () => {
                    // Usa localStorage para passar a senha para a nova aba de forma segura
                    localStorage.setItem('mindpool_temp_pass', presenterPassword);
                    window.open(`/pages/presenter.html?session=${sessionCode}`, '_blank');
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
                // Reordena o array local
                const [movedItem] = currentQuestions.splice(evt.oldIndex, 1);
                currentQuestions.splice(evt.newIndex, 0, movedItem);

                const activeQuestionIndex = currentQuestions.findIndex(q => q && q.id === ui.activeQuestionId);

                // Se uma pergunta concluída for movida para depois da ativa (ou se não houver ativa),
                // ela é reativada, limpando seus resultados.
                if (movedItem.isConcluded && (activeQuestionIndex === -1 || evt.newIndex > activeQuestionIndex)) {
                    movedItem.isConcluded = false;
                    movedItem.results = {};
                }

                socketHandler.reorderQuestions(currentQuestions);
            },
            // Previne o movimento da pergunta ativa
            onMove: (evt) => !evt.dragged.classList.contains('active'),
        });
    },

    setupPresenterPreview() {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        const presenterPassword = sessionStorage.getItem('mindpool_presenter_pass');
        const previewContainer = document.getElementById('presenter-preview-container');

        if (!presenterPassword || !this.elements.presenterPreviewBox || !previewContainer) {
            if (previewContainer) previewContainer.style.display = 'none';
            return;
        }

        // Limpa qualquer prévia anterior para evitar duplicatas em cenários de recarregamento
        this.elements.presenterPreviewBox.innerHTML = '';

        // --- Criação do Iframe ---
        const iframe = document.createElement('iframe');
        iframe.id = 'presenter-preview-iframe';
        localStorage.setItem('mindpool_temp_pass', presenterPassword);
        iframe.src = `/pages/presenter.html?session=${sessionCode}`;

        // --- Lógica de Escala ---
        const iframeWidth = 1280;
        const iframeHeight = 720;
        
        const setThumbnailScale = () => {
            if (!this.elements.presenterPreviewBox.isConnected) return;
            const previewBoxWidth = this.elements.presenterPreviewBox.offsetWidth;
            const scale = previewBoxWidth / iframeWidth;
            iframe.style.transform = `scale(${scale})`;
            // Ajusta a altura do container para manter o aspect ratio
            this.elements.presenterPreviewBox.style.height = `${iframeHeight * scale}px`;
        };

        iframe.onload = () => {
            setThumbnailScale();
            this.elements.presenterPreviewBox.appendChild(iframe);
        };
        window.addEventListener('resize', setThumbnailScale);

        // --- Lógica do Modal ---
        const openModal = () => {
            const modalWidth = window.innerWidth * 0.9;
            const modalHeight = window.innerHeight * 0.9;
            const scale = Math.min(modalWidth / iframeWidth, modalHeight / iframeHeight);
            iframe.style.transform = `scale(${scale})`;
            this.elements.previewModalOverlay.appendChild(iframe);
            this.elements.previewModalOverlay.style.display = 'flex';
        };

        const closeModal = () => {
            this.elements.presenterPreviewBox.appendChild(iframe);
            this.elements.previewModalOverlay.style.display = 'none';
            setThumbnailScale(); // Recalcula a escala da miniatura
        };

        this.elements.presenterPreviewBox.addEventListener('click', openModal);
        this.elements.previewModalOverlay.addEventListener('click', closeModal);
    },

    getQuestionData() {
        // Clear previous validation errors
        this.elements.questionTextInput.classList.remove('invalid');
        this.elements.optionsTextInput.classList.remove('invalid');

        let isValid = true;

        const questionText = this.elements.questionTextInput.value.trim();
        if (!questionText) {
            this.elements.questionTextInput.classList.add('invalid');
            this.elements.questionTextInput.focus();
            isValid = false;
        }

        const questionType = this.elements.questionTypeSelect.value;
        if (questionType === 'options') {
            const optionsText = this.elements.optionsTextInput.value.trim();
            if (!optionsText) {
                this.elements.optionsTextInput.classList.add('invalid');
                if (isValid) this.elements.optionsTextInput.focus(); // Focus only if it's the first error
                isValid = false;
            }
        }
        
        if (!isValid) {
            return null;
        }

        const question = {
            text: questionText,
            imageUrl: this.elements.imageUrlInput.value || null,
            questionType: questionType,
            options: null,
            charLimit: null,
            timer: null
        };

        if (question.questionType === 'options') {
            question.options = this.elements.optionsTextInput.value.split(',').map((opt, index) => ({ id: `opt${index}`, text: opt.trim() }));
        } else if (['short_text', 'long_text'].includes(question.questionType)) {
            question.charLimit = parseInt(this.elements.charLimitInput.value) || (question.questionType === 'short_text' ? 50 : 280);
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
        return question;
    },

    clearForm() {
        this.elements.questionTextInput.value = '';
        this.elements.optionsTextInput.value = '';
        this.elements.imageUrlInput.value = '';
        this.elements.charLimitInput.value = '';
        this.elements.timerEnabledCheckbox.checked = false;
        this.elements.timerDurationInput.value = '';
        this.elements.timerShowAudienceCheckbox.checked = false;
        this.toggleTimerOptions(false);
    },

    exitEditMode() {
        this.clearForm();
        this.editingQuestionId = null;
        this.elements.createBtn.innerText = 'Criar Pergunta';
        this.elements.cancelEditBtn.style.display = 'none';
    },

    toggleTimerOptions: (isEnabled) => ui.elements.timerOptionsDiv && (ui.elements.timerOptionsDiv.style.display = isEnabled ? 'block' : 'none'),

    toggleQuestionTypeOptions(type) {
        if (this.elements.optionsConfig) this.elements.optionsConfig.style.display = type === 'options' ? 'block' : 'none';
        if (this.elements.textConfig) this.elements.textConfig.style.display = ['short_text', 'long_text'].includes(type) ? 'block' : 'none';
    },

    renderQuestions(questions, socketHandler) {
        currentQuestions = questions; // Atualiza a lista de perguntas local
        const container = this.elements.questionsContainer;
        if (!container) return;
        container.innerHTML = '';

        const validQuestions = questions.filter(q => q !== null);
        if (validQuestions.length === 0) {
            container.innerHTML = '<p>Nenhuma pergunta criada ainda.</p>';
            return;
        }

        // After rendering, always reset the create button state
        this.setCreateButtonState(false);

        validQuestions.forEach((q, index) => {
            const isConcluded = q.isConcluded;
            const isActive = q.id === ui.activeQuestionId;

            let isWarning = false;
            if (sessionDeadline && q.timer && q.timer.duration) {
                if ((Date.now() + q.timer.duration * 1000) > sessionDeadline) isWarning = true;
            }
            
            const div = document.createElement('div');
            div.className = `question-item ${isWarning ? 'warning' : ''}`;
            div.id = `question-item-${q.id}`;
            div.innerHTML = `
                <span class="drag-handle" title="Arraste para reordenar">↕️</span>
                <div class="question-main">
                    <p><strong>${q.text}</strong></p>
                    <span class="vote-counter" id="vote-counter-${q.id}" title="Total de votos"></span>
                </div>
                <div class="question-item-controls" id="question-controls-${q.id}"></div>
            `;
            container.appendChild(div);

            // Atualiza a contagem de votos inicial
            const totalVotes = Object.values(q.results || {}).reduce((sum, count) => sum + count, 0);
            const counterEl = div.querySelector(`#vote-counter-${q.id}`);
            if (counterEl) {
                if (totalVotes > 0) {
                    counterEl.innerText = `🗳️ ${totalVotes}`;
                    counterEl.style.display = 'inline-block';
                } else {
                    counterEl.style.display = 'none';
                }
            }

            const controlsDiv = div.querySelector(`#question-controls-${q.id}`);

            // Botão de Editar
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '✏️ <span class="btn-text">Editar</span>';
            editBtn.className = 'icon-button edit-btn';
            editBtn.title = 'Editar Pergunta';
            editBtn.onclick = () => this.enterEditMode(q);
            if (isConcluded || isActive) {
                editBtn.disabled = true;
                editBtn.title = 'Não é possível editar uma pergunta ativa ou já encerrada.';
            }

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

            // Botão de Iniciar
            const startBtn = document.createElement('button');
            startBtn.innerText = isConcluded ? 'Re-abrir Votação' : 'Iniciar Pergunta';
            startBtn.className = 'start-btn';
            startBtn.onclick = () => socketHandler.startQuestion(q.id);

            // Botão de Parar
            const stopBtn = document.createElement('button');
            stopBtn.innerText = 'Parar Respostas';
            stopBtn.className = 'stop-btn';
            stopBtn.style.backgroundColor = '#f0ad4e';
            stopBtn.style.display = 'none'; // Oculto por padrão
            stopBtn.onclick = () => socketHandler.stopVoting(q.id);

            // Botão para Exibir Resultados (se concluída)
            let showResultsBtn = null;
            if (isConcluded) {
                showResultsBtn = document.createElement('button');
                showResultsBtn.innerText = 'Exibir Resultados';
                showResultsBtn.className = 'show-results-btn';
                showResultsBtn.style.backgroundColor = '#16a085';
                showResultsBtn.onclick = () => socketHandler.showResults(q.id);
            }

            controlsDiv.appendChild(editBtn);
            controlsDiv.appendChild(duplicateBtn);
            controlsDiv.appendChild(deleteBtn);
            if (showResultsBtn) {
                controlsDiv.appendChild(showResultsBtn);

                const exportCsvBtn = document.createElement('button');
                exportCsvBtn.innerHTML = '📊 <span class="btn-text">Exportar</span>';
                exportCsvBtn.className = 'icon-button export-csv-btn';
                exportCsvBtn.title = 'Exportar Resultados para CSV';
                exportCsvBtn.onclick = () => this.exportQuestionResultsToCSV(q);
                controlsDiv.appendChild(exportCsvBtn);
            }
            controlsDiv.appendChild(startBtn);
            controlsDiv.appendChild(stopBtn);
        });
    },

    setActiveQuestion(question, socketHandler) {
        const questionId = question.id;
        this.activeQuestionId = questionId; // Armazena o ID da pergunta ativa
        document.querySelectorAll('.question-item').forEach(item => {
            const isThisActive = item.id === `question-item-${questionId}`;
            item.classList.toggle('active', isThisActive);

            const startBtn = item.querySelector('.start-btn');
            const stopBtn = item.querySelector('.stop-btn');
            const deleteBtn = item.querySelector('.delete-btn');
            const showResultsBtn = item.querySelector('.show-results-btn');

            if (isThisActive) {
                // This is the active question: hide most action buttons
                if (startBtn) startBtn.style.display = 'none';
                if (deleteBtn) deleteBtn.style.display = 'none';
                if (showResultsBtn) showResultsBtn.style.display = 'none';
                
                // Only show the 'Stop' button if voting is actually open
                if (stopBtn) {
                    stopBtn.style.display = question.acceptingAnswers ? 'inline-block' : 'none';
                }
            } else {
                // This is not an active question: restore default visibility
                if (startBtn) startBtn.style.display = 'inline-block';
                if (deleteBtn) deleteBtn.style.display = 'inline-block';
                if (stopBtn) stopBtn.style.display = 'none';
            }
        });
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
            .map(({ text, imageUrl, questionType, options, charLimit, timer, results, isConcluded, ...rest }) => ({
                text,
                imageUrl: imageUrl || undefined,
                questionType,
                options: (questionType === 'options' && options) ? options.map(opt => opt.text) : undefined,
                charLimit: charLimit || undefined,
                timer: timer || undefined,
                // Omitindo explicitamente 'results' e 'isConcluded' do arquivo salvo
            }));

        const sessionSettings = {
            theme: this.elements.sessionThemeSwitcher.value,
            controllerPassword: sessionStorage.getItem('mindpool_session_pass') || '',
            presenterPassword: sessionStorage.getItem('mindpool_presenter_pass') || ''
        };

        const exportData = {
            sessionSettings,
            questions: questionsToSave
        };

        const sessionCode = this.elements.sessionCodeDisplay.innerText;
        const filename = `mindpool-session-${sessionCode}-${new Date().toISOString().slice(0, 10)}.json`;
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
        this.elements.questionTypeSelect.value = question.questionType;
        this.toggleQuestionTypeOptions(question.questionType);

        if (question.questionType === 'options' && question.options) {
            this.elements.optionsTextInput.value = question.options.map(o => o.text).join(', ');
        } else if (['short_text', 'long_text'].includes(question.questionType)) {
            this.elements.charLimitInput.value = question.charLimit || '';
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
        this.elements.questionTypeSelect.value = question.questionType;
        this.toggleQuestionTypeOptions(question.questionType);

        if (question.questionType === 'options' && question.options) {
            this.elements.optionsTextInput.value = question.options.map(o => o.text).join(', ');
        } else if (['short_text', 'long_text'].includes(question.questionType)) {
            this.elements.charLimitInput.value = question.charLimit || '';
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

    handleSessionEnded: (message) => { alert(message); window.location.href = '/'; },

    handleJoinResponse(response) {
        if (!response.success) {
            alert(response.message);
            window.location.href = `/pages/admin.html?role=controller`;
            return;
        }
        sessionDeadline = response.deadline;
        if (response.audienceCount !== undefined) {
            this.updateAudienceCount(response.audienceCount);
        }
        if (response.activeQuestion !== null) {
            // FIX: Don't call setActiveQuestion with an ID, which causes an error.
            // Just store the ID. The UI will be correctly updated by the 
            // 'newQuestion' event that follows shortly after joining.
            this.activeQuestionId = response.activeQuestion;
        }
        // Atualiza o texto do botão com base no estado recebido do servidor
        if (response.isAudienceUrlVisible) {
            this.elements.toggleUrlBtn.innerText = 'Ocultar Endereço';
        } else {
            this.elements.toggleUrlBtn.innerText = 'Exibir Endereço';
        }
        if (sessionDeadline) this.showDeadlineWarning();
    },

    updateVoteCount(questionId, results) {
        const counterEl = document.getElementById(`vote-counter-${questionId}`);
        if (!counterEl) return;

        const totalVotes = Object.values(results).reduce((sum, count) => sum + count, 0);

        if (totalVotes > 0) {
            counterEl.innerText = `🗳️ ${totalVotes}`;
            counterEl.style.display = 'inline-block';
        } else {
            // Se os votos forem zerados (ex: reabrir votação), esconde o contador
            counterEl.style.display = 'none';
        }
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
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); }, 3000);
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
        socket.on('newQuestion', (question) => ui.setActiveQuestion(question, this));
        socket.on('sessionEnded', ({ message }) => ui.handleSessionEnded(message));
        socket.on('themeChanged', ({ theme }) => ui.handleThemeChanged(theme));
        socket.on('audienceCountUpdated', ({ count, joined }) => ui.updateAudienceCount(count, joined));
        socket.on('updateResults', ({ questionId, results }) => ui.updateVoteCount(questionId, results));

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
        const sessionPassword = sessionStorage.getItem('mindpool_session_pass');
        if (!sessionPassword) {
            alert('Erro de autenticação. Por favor, volte e entre na sessão novamente.');
            window.location.href = `/pages/admin.html?role=controller`;
            return;
        }
        socket.emit('joinAdminSession', { sessionCode, password: sessionPassword, role: 'controller' }, (response) => {
            // Não remover a senha do sessionStorage para permitir que a re-autenticação em 'connect' funcione.
            if (response.theme) ui.handleThemeChanged(response.theme);
            ui.handleJoinResponse(response);
        });
    },
    createQuestion: (questionData) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('createQuestion', { sessionCode, question: questionData });
    },
    startQuestion: (questionId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('startQuestion', { sessionCode, questionId });
    },
    stopVoting: (questionId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('stopQuestion', { sessionCode, questionId });
    },
    endSession: () => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('endSession', { sessionCode });
    },
    changeTheme: (theme) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('changeTheme', { sessionCode, theme });
    },
    deleteQuestion: (questionId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('deleteQuestion', { sessionCode, questionId });
    },
    reorderQuestions: (newOrder) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('reorderQuestions', { sessionCode, newQuestionOrder: newOrder });
    },
    showResults: (questionId) => {
        const sessionCode = new URLSearchParams(window.location.search).get('session');
        socket.emit('showResults', { sessionCode, questionId });
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
};

// --- 4. INÍCIO DA APLICAÇÃO ---
ui.init(socketHandler);
socketHandler.init();