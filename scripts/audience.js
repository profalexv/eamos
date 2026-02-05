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

let currentQuestionId = null;
let currentTimer = null;
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

function joinAudienceSession() {
    const sessionCode = new URLSearchParams(window.location.search).get('session');
    if (sessionCode) {
        socket.emit('joinAudienceSession', { sessionCode });
    } else {
        const questionTitle = document.getElementById('question-title');
        if (questionTitle) {
            questionTitle.innerText = "Erro: Código da sessão não encontrado na URL.";
        }
    }
}

socket.on('newQuestion', (question) => {
    // Para e limpa qualquer cronômetro anterior
    if (currentTimer) {
        currentTimer.stop();
        currentTimer = null;
    }
    if (audienceTimerEl) audienceTimerEl.style.display = 'none';

    currentQuestionId = question.id;
    const questionTitle = document.getElementById('question-title');
    if (questionTitle) questionTitle.innerText = question.text;
    
    const optionsContainer = document.getElementById('options-container');
    // Limpa o container de respostas para a nova pergunta
    if (!optionsContainer) return;
    optionsContainer.innerHTML = '';

    switch (question.questionType) {
        case 'options':
            question.options.forEach(opt => {
                const button = document.createElement('button');
                button.textContent = opt.text;
                button.addEventListener('click', () => submitAnswer(opt.id));
                optionsContainer.appendChild(button);
            });
            break;
        case 'yes_no':
            const yesButton = document.createElement('button');
            yesButton.textContent = 'Sim';
            yesButton.addEventListener('click', () => submitAnswer('yes'));
            optionsContainer.appendChild(yesButton);

            const noButton = document.createElement('button');
            noButton.textContent = 'Não';
            noButton.addEventListener('click', () => submitAnswer('no'));
            optionsContainer.appendChild(noButton);
            break;
        default: // number, integer, short_text, long_text
            const input = document.createElement('input');
            input.id = 'text-answer';
            if (question.questionType === 'number') {
                input.type = 'number';
                input.placeholder = 'Digite um número';
            } else if (question.questionType === 'integer') {
                input.type = 'number';
                input.step = '1';
                input.placeholder = 'Digite um número inteiro';
            } else { // short_text or long_text
                input.type = 'text';
                const limit = question.charLimit || 280;
                input.maxLength = limit;
                input.placeholder = `Sua resposta (max ${limit} caracteres)`;
            }
            const submitBtn = document.createElement('button');
            submitBtn.textContent = 'Enviar';
            submitBtn.addEventListener('click', () => {
                if (input.value && input.value.trim()) submitAnswer(input.value);
            });
            optionsContainer.append(input, submitBtn);
            break;
    }
    const feedback = document.getElementById('feedback');
    if (feedback) feedback.innerText = '';

    // Inicia um novo cronômetro se a pergunta tiver um e for para exibir
    // e se estiver aceitando respostas (para não reativar em 'showResults')
    if (question.acceptingAnswers && question.endTime && question.timer?.showToAudience) {
        if (audienceTimerEl) {
            audienceTimerEl.style.display = 'block';
            currentTimer = new Cronometro(question.endTime, audienceTimerEl, () => {
                // Quando o tempo acaba, bloqueia as respostas
                const optionsContainer = document.getElementById('options-container');
                if (optionsContainer) {
                    optionsContainer.innerHTML = '<p>Tempo esgotado!</p>';
                }
            });
            currentTimer.start();
        }
    }
});

socket.on('themeChanged', ({ theme }) => {
    console.log(`Recebido evento de mudança de tema: ${theme}`);
    applyTheme(theme);
});

socket.on('error', (message) => {
    console.error('Erro recebido do servidor:', message);
    alert(`Erro: ${message}\n\nVocê será redirecionado para a página inicial.`);
    window.location.href = '/index.html';
});

socket.on('connect', () => {
    console.log('✅ Conectado ao servidor. Entrando na sessão da plateia...');
    joinAudienceSession();
});

function submitAnswer(answer) {
    const sessionCode = new URLSearchParams(window.location.search).get('session');
    if (currentQuestionId === null) return;
    if (currentTimer) {
        currentTimer.stop(); // Para o cronômetro do usuário ao responder
    }
    socket.emit('submitAnswer', { sessionCode, questionId: currentQuestionId, answer });
    const feedback = document.getElementById('feedback');
    if (feedback) feedback.innerText = 'Sua resposta foi enviada! Obrigado.';
    const optionsContainer = document.getElementById('options-container');
    if (optionsContainer) optionsContainer.innerHTML = ''; // Limpa a área de resposta
}

socket.on('sessionEnded', (message) => {
    alert(message);
    window.location.href = '/';
});

socket.on('votingEnded', ({ questionId }) => {
    if (currentQuestionId === questionId) {
        const optionsContainer = document.getElementById('options-container');
        if (optionsContainer) {
            optionsContainer.innerHTML = '<p>Votação encerrada pelo apresentador.</p>';
        }
    }
});