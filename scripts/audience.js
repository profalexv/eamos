const getBackendUrl = () => {
    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isDevelopment ? 'http://localhost:3000' : 'https://eamos-backend.onrender.com';
};

const socket = io(getBackendUrl(), {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
});

const sessionCode = new URLSearchParams(window.location.search).get('session');
let currentQuestionId = null;
let currentTimer = null;
let totalQuestions = 0;

// Elementos da UI
const loginScreen = document.getElementById('login-screen');
const quizScreen = document.getElementById('quiz-screen');
const nameInput = document.getElementById('audience-name');
const passwordInput = document.getElementById('audience-password');
const joinBtn = document.getElementById('join-btn');
const loginFeedback = document.getElementById('login-feedback');
const questionTitle = document.getElementById('question-title');
const optionsContainer = document.getElementById('options-container');
const answerFeedback = document.getElementById('answer-feedback');
const audienceTimerEl = document.getElementById('audience-timer');


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
}

function renderQuestion(question) {
    if (!question) {
        questionTitle.innerText = "Parabéns, você concluiu todas as perguntas!";
        optionsContainer.innerHTML = '';
        answerFeedback.innerText = '';
        return;
    }

    // Para e limpa qualquer cronômetro anterior
    if (currentTimer) {
        currentTimer.stop();
        currentTimer = null;
    }
    if (audienceTimerEl) audienceTimerEl.style.display = 'none';
    
    currentQuestionId = question.id;
    questionTitle.innerText = question.text;
    optionsContainer.innerHTML = '';
    answerFeedback.innerText = '';

    switch (question.questionType) {
        case 'options':
            question.options.forEach(opt => {
                const button = document.createElement('button');
                button.textContent = opt.text;
                button.onclick = () => submitAnswer(opt.id);
                optionsContainer.appendChild(button);
            });
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
            audienceTimerEl.style.display = 'block';
            currentTimer = new Cronometro(question.endTime, audienceTimerEl, () => {
                answerFeedback.innerText = 'Tempo esgotado! Tente novamente.';
                // A lógica de EAMOS não bloqueia, apenas avisa.
            });
            currentTimer.start();
        }
    }
}

function submitAnswer(answer) {
    socket.emit('submitAnswer', { sessionCode, questionId: currentQuestionId, answer });
    optionsContainer.querySelectorAll('button, input').forEach(el => el.disabled = true);
    answerFeedback.innerText = 'Verificando...';
}

// ===== EVENT LISTENERS DO SOCKET =====

socket.on('connect', () => {
    console.log('✅ Conectado ao servidor.');
    if (!sessionCode) {
        loginFeedback.innerText = "Erro: Código da sessão não encontrado na URL.";
        joinBtn.disabled = true;
    }
});

socket.on('joinApproved', ({ firstQuestion, totalQuestions: count }) => {
    loginFeedback.innerText = 'Aprovado! Carregando perguntas...';
    totalQuestions = count;
    setTimeout(() => {
        showScreen('quiz');
        renderQuestion(firstQuestion);
    }, 1000);
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