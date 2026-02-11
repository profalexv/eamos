const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Em produção, `io()` sem URL conecta ao mesmo host da página.
// Um proxy reverso no Render.com deve ser configurado para rotear
// as requisições de /socket.io/ para o serviço de backend unificado.
// Isso elimina URLs fixas no código e simplifica a configuração de CORS.
const socket = io(isDevelopment ? 'http://localhost:3000' : undefined, {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
});

const sessionCode = new URLSearchParams(window.location.search).get('session');
let currentQuestionId = null;

// NOVO: Estado da UI e progresso do participante
const audienceState = {
    allowedViews: [],
    currentViewIndex: -1, // -1 significa que a visualização da pergunta está ativa
    users: {},
    totalQuestions: 0,
    myProgress: 0,
    currentTimer: null,
};

// Elementos da UI
const loginScreen = document.getElementById('login-screen');
const quizScreen = document.getElementById('quiz-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const questionWrapper = document.getElementById('question-wrapper'); // Wrapper para a pergunta
const nameInput = document.getElementById('audience-name');
const passwordInput = document.getElementById('audience-password');
const joinBtn = document.getElementById('join-btn');
const loginFeedback = document.getElementById('login-feedback');
const questionTitle = document.getElementById('question-title');
const optionsContainer = document.getElementById('options-container');
const answerFeedback = document.getElementById('answer-feedback');
const audienceTimerEl = document.getElementById('audience-timer');
// NOVO: Elementos para visualização de progresso
const progressContainer = document.getElementById('audience-progress-container');
const viewSwitcher = document.getElementById('view-switcher');
const viewSwitcherText = document.getElementById('view-switcher-text');
const finalScoreEl = document.getElementById('final-score');
const finalRankEl = document.getElementById('final-rank');
const exitBtn = document.getElementById('exit-btn');


/**
 * Aplica um tema visual ao body, trocando a classe de tema.
 * @param {string} theme - O nome do tema (ex: 'light', 'dark', 'corporate').
 */
function applyTheme(theme = 'light') {
    console.log(`Aplicando tema de plateia: ${theme}`);
    const body = document.body;
    // Remove temas antigos para garantir que apenas um esteja ativo
    body.classList.remove('theme-light', 'theme-dark', 'theme-corporate', 'theme-fun', 'theme-sublime');
    body.classList.add(`theme-${theme}`);
}

function showScreen(screenName) {
    loginScreen.style.display = screenName === 'login' ? 'block' : 'none';
    quizScreen.style.display = screenName === 'quiz' ? 'block' : 'none';
    gameOverScreen.style.display = screenName === 'game-over' ? 'block' : 'none';

    if (viewSwitcher) {
        const show = screenName === 'quiz' && audienceState.allowedViews.length > 0;
        viewSwitcher.style.display = show ? 'flex' : 'none';
    }
}

function renderMedia(question) {
    let mediaHTML = '';
    // Limpa mídia anterior
    const existingMedia = document.getElementById('media-wrapper');
    if (existingMedia) existingMedia.remove();

    if (question.imageUrl) {
        mediaHTML += `<img src="${question.imageUrl}" alt="Imagem da pergunta" style="max-width: 100%; border-radius: 8px; margin-bottom: 1rem;">`;
    }
    if (question.mediaUrl) {
        const url = question.mediaUrl;
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
                const videoId = urlObj.hostname.includes('youtu.be') 
                    ? urlObj.pathname.slice(1) 
                    : urlObj.searchParams.get('v');
                if (videoId) {
                    mediaHTML += `<div class="video-container"><iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
                }
            } else if (url.match(/\.(mp4|webm)$/)) {
                mediaHTML += `<video controls src="${url}" style="max-width: 100%; border-radius: 8px;"></video>`;
            } else if (url.match(/\.(mp3|ogg|wav)$/)) {
                mediaHTML += `<audio controls src="${url}" style="width: 100%;"></audio>`;
            }
        } catch (e) {
            console.warn("URL de mídia inválida:", url);
        }
    }
    const mediaWrapper = document.createElement('div');
    mediaWrapper.id = 'media-wrapper';
    mediaWrapper.innerHTML = mediaHTML;
    return mediaWrapper;
}

function renderQuestion(question) {
    if (!question) {
        showScreen('game-over');
        renderGameOverScreen();
        return;
    }

    // Para e limpa qualquer cronômetro anterior
    if (audienceState.currentTimer) {
        audienceState.currentTimer.stop();
        audienceState.currentTimer = null;
    }
    if (audienceTimerEl) audienceTimerEl.style.display = 'none';
    
    currentQuestionId = question.id;
    questionTitle.innerText = question.text;
    optionsContainer.innerHTML = '';
    answerFeedback.innerText = '';

    // Render media (image, video, audio) and insert it before the question title
    questionTitle.before(renderMedia(question));

    switch (question.questionType) {
        case 'options':
            if (question.answerConfig && question.answerConfig.acceptMultiple) {
                // Renderiza checkboxes para múltiplas respostas
                question.options.forEach(opt => {
                    const label = document.createElement('label');
                    label.className = 'mcq-option-label';
                    label.innerHTML = `<input type="checkbox" name="mcq-option" value="${opt.id}"><span>${opt.text}</span>`;
                    optionsContainer.appendChild(label);
                });
                const submitBtn = document.createElement('button');
                submitBtn.textContent = 'Enviar Resposta';
                submitBtn.onclick = () => {
                    const selectedOptions = Array.from(optionsContainer.querySelectorAll('input[name="mcq-option"]:checked')).map(cb => cb.value);
                    if (selectedOptions.length > 0) {
                        submitAnswer(selectedOptions);
                    } else {
                        answerFeedback.innerText = 'Selecione pelo menos uma opção.';
                    }
                };
                optionsContainer.appendChild(submitBtn);
            } else {
                // Renderiza botões para resposta única (comportamento antigo)
                question.options.forEach(opt => {
                    const button = document.createElement('button');
                    button.textContent = opt.text;
                    button.onclick = () => submitAnswer(opt.id);
                    optionsContainer.appendChild(button);
                });
            }
            break;
        case 'yes_no':
            const yesButton = document.createElement('button');
            yesButton.textContent = 'Sim';
            yesButton.onclick = () => submitAnswer('yes');
            optionsContainer.appendChild(yesButton);

            const noButton = document.createElement('button');
            noButton.textContent = 'Não';
            noButton.onclick = () => submitAnswer('no');
            optionsContainer.appendChild(noButton);
            break;
        default: // text, number
            const input = document.createElement('input');
            input.id = 'text-answer';
            input.type = (question.questionType === 'number' || question.questionType === 'integer') ? 'number' : 'text';
            input.placeholder = 'Sua resposta';
            if (question.charLimit) input.maxLength = question.charLimit;

            const submitBtn = document.createElement('button');
            submitBtn.textContent = 'Enviar';
            submitBtn.onclick = () => {
                if (input.value && input.value.trim()) submitAnswer(input.value);
            };
            optionsContainer.append(input, submitBtn);
            break;
    }

    // Adiciona botão de pular se aplicável
    if (question.skippable) {
        const skipButton = document.createElement('button');
        skipButton.textContent = 'Pular Pergunta';
        skipButton.className = 'secondary-button';
        skipButton.onclick = () => submitAnswer('__SKIP__');
        optionsContainer.appendChild(skipButton);
    }

    // Lógica do cronômetro (se houver)
    if (question.endTime && question.timer?.showToAudience) {
        if (audienceTimerEl) {
            audienceTimerEl.style.display = 'flex';
            audienceState.currentTimer = new Cronometro(question.endTime, audienceTimerEl, () => {
                answerFeedback.innerText = 'Tempo esgotado! Tente novamente.';
                // A lógica de EAMOS não bloqueia, apenas avisa.
            });
            audienceState.currentTimer.start();
        }
    }
}

function submitAnswer(answer) {
    socket.emit('submitAnswer', { sessionCode, questionId: currentQuestionId, answer });
    optionsContainer.querySelectorAll('button, input').forEach(el => el.disabled = true);
    answerFeedback.innerText = 'Verificando...';
}

function renderGameOverScreen() {
    if (!finalScoreEl || !finalRankEl) return;

    const scoreText = `${audienceState.myProgress}/${audienceState.totalQuestions}`;
    finalScoreEl.innerText = scoreText;

    const approvedUsers = Object.values(audienceState.users).filter(u => u.status === 'approved' || u.status === 'disconnected');
    approvedUsers.sort((a, b) => b.progress - a.progress);
    const myRank = approvedUsers.findIndex(u => u.socketId === socket.id);
    
    let rankText = 'N/A';
    if (myRank !== -1) {
        rankText = `${myRank + 1}º de ${approvedUsers.length}`;
    }
    finalRankEl.innerText = rankText;
}

// ===== NOVAS FUNÇÕES PARA VISUALIZAÇÃO DE PROGRESSO =====

function renderCurrentView() {
    if (!questionWrapper || !progressContainer) return;

    if (audienceState.currentViewIndex === -1) {
        // Mostra a pergunta, esconde o progresso
        questionWrapper.style.display = 'block';
        progressContainer.style.display = 'none';
    } else {
        // Mostra o progresso, esconde a pergunta
        questionWrapper.style.display = 'none';
        progressContainer.style.display = 'block';
        
        const viewMode = audienceState.allowedViews[audienceState.currentViewIndex];
        renderProgressView(progressContainer, viewMode);
    }
}

function updateViewSwitcherText() {
    console.log('[AUDIENCE-DEBUG] updateViewSwitcherText called.');
    console.log('[AUDIENCE-DEBUG] Views permitidas:', audienceState.allowedViews);

    if (!viewSwitcherText || !viewSwitcher) return;
    
    // A visibilidade do botão é controlada pela função showScreen()
    // para centralizar a lógica.
    console.log('[AUDIENCE-DEBUG] Atualizando texto do botão de progresso.');

    const showPosition = audienceState.allowedViews.includes('position');
    let positionText = '';

    if (showPosition && audienceState.users && Object.keys(audienceState.users).length > 0) {
        const approvedUsers = Object.values(audienceState.users).filter(u => u.status === 'approved' || u.status === 'disconnected');
        approvedUsers.sort((a, b) => b.progress - a.progress);
        const myRank = approvedUsers.findIndex(u => u.socketId === socket.id);
        if (myRank !== -1) {
            positionText = ` (${myRank + 1}/${approvedUsers.length})`;
        }
    }
    
    viewSwitcherText.innerText = `${audienceState.myProgress}/${audienceState.totalQuestions}${positionText}`;
}

function renderProgressView(container, mode) {
    container.innerHTML = ''; // Limpa a visualização anterior
    const approvedUsers = Object.values(audienceState.users).filter(u => u.status === 'approved' || u.status === 'disconnected');

    if (approvedUsers.length === 0) {
        container.innerHTML = '<h2>Progresso</h2><p>Aguardando participantes...</p>';
        return;
    }

    switch(mode) {
        case 'individual':
            renderMyProgress(container, approvedUsers, audienceState.totalQuestions);
            break;
        case 'overall':
            renderOverallChart(container, approvedUsers, audienceState.totalQuestions);
            break;
        case 'ranking':
            renderRankingView(container, approvedUsers, audienceState.totalQuestions);
            break;
    }
}

function renderMyProgress(container, allUsers, totalQuestions) {
    const me = allUsers.find(u => u.socketId === socket.id);
    if (!me) return;
    
    const percentage = totalQuestions > 0 ? (me.progress / totalQuestions) * 100 : 0;
    container.innerHTML = `
        <h2>Seu Progresso</h2>
        <div class="user-progress-bar" style="grid-template-columns: 1fr 80px; max-width: 600px; margin: 2rem auto;">
            <div class="progress-track">
                <div class="progress-fill" style="width: ${percentage}%;"></div>
            </div>
            <span class="progress-label">${me.progress}/${totalQuestions}</span>
        </div>
    `;
}

function renderOverallChart(container, approvedUsers, totalQuestions) {
    const totalProgress = approvedUsers.reduce((sum, user) => sum + user.progress, 0);
    const maxProgress = approvedUsers.length * totalQuestions;
    const averagePercentage = maxProgress > 0 ? (totalProgress / maxProgress) * 100 : 0;

    container.innerHTML = `
        <h2>Progresso Geral da Turma</h2>
        <div class="progress-track" style="max-width: 600px; margin: 2rem auto;">
            <div class="progress-fill" style="width: ${averagePercentage}%;"></div>
        </div>
        <p>Média de conclusão: <strong>${Math.round(averagePercentage)}%</strong></p>
    `;
}

function renderRankingView(container, approvedUsers, totalQuestions) {
    container.className = 'ranking-container';
    if (totalQuestions === 0) {
        container.innerHTML = '<h2>Ranking</h2><p>O ranking aparecerá quando as perguntas forem criadas.</p>';
        return;
    }
    const sortedUsers = [...approvedUsers].sort((a, b) => b.progress - a.progress);
    const trackHTML = sortedUsers.map((user, index) => {
        const percentage = (user.progress / totalQuestions) * 100;
        const isMe = user.socketId === socket.id;
        const isFirst = index === 0;
        const isLast = index === sortedUsers.length - 1 && sortedUsers.length > 1;
        
        let classes = 'ranking-marker';
        if (isMe) classes += ' me';
        if (isFirst) classes += ' rank-first';
        if (isLast) classes += ' rank-last';

        return `<div class="${classes}" style="left: ${percentage}%;" title="${user.name}">
                    <div class="ranking-tooltip">${user.name} (${user.progress}/${totalQuestions})</div>
                </div>`;
    }).join('');

    container.innerHTML = `<h2>Ranking Comparativo</h2><div class="ranking-bar-track">${trackHTML}</div>`;
}


// ===== EVENT LISTENERS DO SOCKET =====

socket.on('connect', () => {
    console.log('✅ Conectado ao servidor.');
    if (!sessionCode) {
        loginFeedback.innerText = "Erro: Código da sessão não encontrado na URL.";
        joinBtn.disabled = true;
    }
});

socket.on('joinApproved', (data) => {
    console.log('[AUDIENCE-DEBUG] Evento "joinApproved" recebido:', data);
    loginFeedback.innerText = 'Aprovado! Carregando perguntas...';
    audienceState.totalQuestions = data.totalQuestions;
    audienceState.allowedViews = data.audienceView || [];
    updateViewSwitcherText();
    showScreen('quiz'); // Garante que o view-switcher seja exibido se necessário

    setTimeout(() => {
        showScreen('quiz');
        renderQuestion(data.firstQuestion);
    }, 1000);
});

socket.on('audienceViewChanged', ({ allowedViews }) => {
    console.log('[AUDIENCE-DEBUG] Evento "audienceViewChanged" recebido:', allowedViews);
    audienceState.allowedViews = allowedViews;
    // Se a visualização atual não for mais permitida, volta para a pergunta
    if (audienceState.currentViewIndex >= audienceState.allowedViews.length) {
        audienceState.currentViewIndex = -1;
        renderCurrentView();
    }
    // Reavalia a visibilidade do switcher
    if (quizScreen.style.display === 'block') {
        showScreen('quiz');
    }
    updateViewSwitcherText(); // Atualiza o texto para mostrar/esconder a posição
});

socket.on('answerResult', ({ correct, nextQuestion }) => {
    if (correct) {
        answerFeedback.innerText = 'Resposta correta! Carregando próxima pergunta...';
        setTimeout(() => {
            renderQuestion(nextQuestion);
        }, 1500);
    } else {
        answerFeedback.innerText = 'Resposta incorreta. Tente novamente!';
        optionsContainer.querySelectorAll('button, input').forEach(el => el.disabled = false);
    }
});

socket.on('userListUpdated', ({ users, totalQuestions }) => {
    audienceState.users = users;
    audienceState.totalQuestions = totalQuestions;
    
    const me = users[socket.id];
    if (me) {
        audienceState.myProgress = me.progress;
    }

    // Se uma tela de progresso estiver ativa, re-renderiza
    if (audienceState.currentViewIndex > -1) {
        renderCurrentView();
    }
    updateViewSwitcherText();
});

socket.on('error', (message) => {
    console.error('Erro recebido do servidor:', message);
    alert(`Erro: ${message}\n\nVocê será redirecionado para a página inicial.`);
    window.location.href = '/index.html';
});

socket.on('sessionEnded', (message) => {
    alert(message);
    window.location.href = '/';
});

socket.on('themeChanged', ({ theme }) => applyTheme(theme));

// ===== EVENT LISTENERS DA UI =====

joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!name || !password) {
        loginFeedback.innerText = 'Por favor, preencha seu nome e a senha.';
        return;
    }

    joinBtn.disabled = true;
    loginFeedback.innerText = 'Enviando pedido para entrar...';

    socket.emit('requestJoin', { sessionCode, name, password }, (response) => {
        if (response.success) {
            loginFeedback.innerText = response.message; // "Aguardando aprovação..."
        } else {
            loginFeedback.innerText = `Erro: ${response.message}`;
            joinBtn.disabled = false;
        }
    });
});

viewSwitcher?.addEventListener('click', () => {
    if (audienceState.allowedViews.length === 0) return;

    audienceState.currentViewIndex++;
    if (audienceState.currentViewIndex >= audienceState.allowedViews.length) {
        audienceState.currentViewIndex = -1; // Volta para a visualização da pergunta
    }
    renderCurrentView();
});

exitBtn?.addEventListener('click', () => {
    window.location.href = '/index.html';
});