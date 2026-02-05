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

/**
 * Aplica um tema visual ao body, trocando a classe de tema.
 * @param {string} theme - O nome do tema (ex: 'light', 'dark', 'corporate').
 */
function applyTheme(theme = 'light') {
    console.log(`Aplicando tema: ${theme}`);
    const body = document.body;
    // Remove temas antigos para garantir que apenas um esteja ativo
    body.classList.remove('theme-light', 'theme-dark', 'theme-corporate', 'theme-fun', 'theme-sublime');
    body.classList.add(`theme-${theme}`);
}

function getSessionPassword() {
    // 1. Tenta obter a senha do sessionStorage da aba atual.
    let password = sessionStorage.getItem('mindpool_session_pass');
    if (password) console.log('INFO: Senha encontrada no sessionStorage da aba.');

    // 2. Se não encontrar, verifica se foi passada uma senha temporária de outra aba via localStorage.
    if (!password) {
        const tempPass = localStorage.getItem('mindpool_temp_pass');
        if (tempPass) {
            console.log('INFO: Senha temporária encontrada no localStorage, movendo para sessionStorage.');
            password = tempPass;
            sessionStorage.setItem('mindpool_session_pass', tempPass); // Move para o sessionStorage desta aba
            // Não removemos o item do localStorage. Isso permite que a prévia no controller
            // funcione de forma consistente mesmo após recarregar a página, embora
            // deixe a senha do presenter no localStorage. É um trade-off para a funcionalidade.
            // localStorage.removeItem('mindpool_temp_pass');
        }
    }

    if (!password) console.error('ERRO CRÍTICO: Nenhuma senha encontrada para autenticação do presenter.');
    return password;
}

const sessionInfoContainer = document.getElementById('session-info-container');
const questionScreen = document.getElementById('question-screen');
const resultsContainer = document.getElementById('results-container');
const wordCloudContainer = document.getElementById('word-cloud-container');
const presenterTimerEl = document.getElementById('presenter-timer');
let currentTimer = null;
let currentQuestion = null; // Armazena a pergunta atual completa
let sessionDeadline = null;

// 1. Configuração Inicial
const sessionCodeForDisplay = new URLSearchParams(window.location.search).get('session');
const sessionCodeDisplay = document.getElementById('session-code-display');
if (sessionCodeDisplay) sessionCodeDisplay.innerText = sessionCodeForDisplay;

const audienceUrl = `${window.location.origin}/pages/audience.html?session=${sessionCodeForDisplay}`;
const qrcodeContainer = document.getElementById("qrcode");
if (qrcodeContainer) {
    new QRCode(qrcodeContainer, {
        text: audienceUrl,
        width: 256,
        height: 256,
    });

    const audienceUrlDisplay = document.getElementById('audience-url-display');
    if (audienceUrlDisplay) {
        audienceUrlDisplay.innerText = audienceUrl.replace(/^https?:\/\//, '');
        audienceUrlDisplay.title = 'Clique para copiar o link';
        audienceUrlDisplay.addEventListener('click', () => {
            navigator.clipboard.writeText(audienceUrl).then(() => {
                const originalText = audienceUrlDisplay.innerText;
                audienceUrlDisplay.innerText = 'Copiado!';
                audienceUrlDisplay.style.cursor = 'default';
                setTimeout(() => {
                    audienceUrlDisplay.innerText = originalText;
                    audienceUrlDisplay.style.cursor = 'pointer';
                }, 2000);
            }).catch(err => console.error('Falha ao copiar o link: ', err));
        });
    }
}

function joinPresenterSession() {
    const sessionCode = new URLSearchParams(window.location.search).get('session');
    const sessionPassword = getSessionPassword();

    if (!sessionPassword) {
        console.error('Falha na autenticação: senha não encontrada no sessionStorage ou localStorage.');
        alert('Erro de autenticação. A sessão pode ter expirado ou a senha não foi fornecida. Por favor, tente entrar novamente.');
        window.location.href = `/pages/admin.html?role=presenter`;
        return;
    }
    socket.emit('joinAdminSession', { sessionCode, password: sessionPassword, role: 'presenter' }, (response) => {        
        // Não remover a senha do sessionStorage para permitir que a re-autenticação em 'connect' funcione.

        if (!response.success) {
            alert(response.message);
            window.location.href = `/pages/admin.html?role=presenter`;
            return;
        }

        applyTheme(response.theme);
        // Ao entrar, verifica se a URL já deve estar visível
        if (response.isAudienceUrlVisible) {
            const audienceUrlDisplay = document.getElementById('audience-url-display');
            if (audienceUrlDisplay) {
                audienceUrlDisplay.style.display = 'block';
            }
        }
        // A lógica de deadline da sessão foi removida da tela do presenter para evitar confusão com o timer da pergunta.
    });
}

// 2. Ouvir por novas perguntas
socket.on('newQuestion', (question) => {
    currentQuestion = question; // Armazena a pergunta para uso posterior (ex: renderBarResults)
    // Para e limpa qualquer cronômetro anterior
    if (currentTimer) {
        currentTimer.stop();
        currentTimer = null;
    }
    if (presenterTimerEl) presenterTimerEl.style.display = 'none';

    if (sessionInfoContainer) sessionInfoContainer.className = 'state-question';
    if (questionScreen) questionScreen.style.display = 'block';
    
    // Limpa os containers de resultado e prepara para a nova pergunta
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
        resultsContainer.className = ''; // Reseta a classe para o padrão
    }
    if (wordCloudContainer) wordCloudContainer.innerHTML = '';

    const questionText = document.getElementById('question-text');
    if (questionText) questionText.innerText = question.text;

    const img = document.getElementById('question-image');
    if (img) {
        if (question.imageUrl) {
            img.src = question.imageUrl;
            img.style.display = 'block';
        } else {
            img.style.display = 'none';
        }
    }

    // Pre-renderiza as barras para perguntas de múltipla escolha
    if (question.questionType === 'options') {
        renderInitialBarResults(question.options);
    }

    // Inicia um novo cronômetro se a pergunta tiver um horário de término
    // e se estiver aceitando respostas (para não reativar em 'showResults')
    if (question.acceptingAnswers && question.endTime) {
        if (presenterTimerEl) {
            presenterTimerEl.style.display = 'block';
            currentTimer = new Cronometro(question.endTime, presenterTimerEl, () => {
                console.log('Cronômetro do presenter terminou.');
            });
            currentTimer.start();
        }
    }
});

// 3. Ouvir por atualização de resultados
socket.on('updateResults', ({ results, questionType }) => {
    switch (questionType) {
        case 'options':
            updateBarResults(results);
            break;
        case 'yes_no':
            renderYesNoResults(results);
            break;
        default: // Word cloud
            renderTextResults(results);
            break;
    }
});

function renderInitialBarResults(options) {
    if (!resultsContainer) return;
    let html = '';
    options.forEach(option => {
        html += `
            <div class="result-bar-container" data-option-id="${option.id}">
                <span>${option.text}</span>
                <div class="result-bar-background">
                    <div class="result-bar" style="width: 0%;">
                        <span class="result-bar-label">0 (0%)</span>
                    </div>
                </div>
            </div>`;
    });
    resultsContainer.innerHTML = html;
}

function updateBarResults(results) {
    if (!resultsContainer) return;

    const totalVotes = Object.values(results).reduce((sum, count) => sum + count, 0);

    const barContainers = resultsContainer.querySelectorAll('.result-bar-container');

    barContainers.forEach((container, index) => {
        const optionId = container.dataset.optionId;
        if (!optionId) return;

        const count = results[optionId] || 0;
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

        const bar = container.querySelector('.result-bar');
        const label = container.querySelector('.result-bar-label');

        if (bar) {
            // Adiciona um atraso escalonado para um efeito de animação mais agradável
            bar.style.transitionDelay = `${index * 50}ms`;
            bar.style.width = `${percentage}%`;
        }
        if (label) {
            label.innerText = `${count} (${percentage}%)`;
        }
    });
}

function renderTextResults(results) {
    if (!resultsContainer) return;
    resultsContainer.className = 'text-results-container';
    resultsContainer.innerHTML = ''; // Clear previous content

    // Converte o objeto de resultados em um array, ordena por contagem (decrescente)
    const sortedAnswers = Object.entries(results)
        .sort(([, countA], [, countB]) => countB - countA);

    const list = document.createElement('ul');
    list.className = 'text-results-list';

    sortedAnswers.forEach(([answer, count], index) => {
        const listItem = document.createElement('li');
        listItem.className = 'text-results-item';
        listItem.style.animationDelay = `${index * 100}ms`;
        
        const answerText = document.createElement('span');
        answerText.className = 'text-results-answer';
        answerText.innerText = answer;
        listItem.appendChild(answerText);

        if (count > 1) {
            const answerCount = document.createElement('span');
            answerCount.className = 'text-results-count';
            answerCount.innerText = `x${count}`;
            listItem.appendChild(answerCount);
        }
        list.appendChild(listItem);
    });

    resultsContainer.appendChild(list);
}

function renderYesNoResults(results) {
    if (!resultsContainer) return;
    resultsContainer.innerHTML = `
        <div class="yes-no-results">
            <div class="result-option"><span class="label">Sim</span>👍<span class="count">${results.yes || 0}</span></div>
            <div class="result-option"><span class="label">Não</span>👎<span class="count">${results.no || 0}</span></div>
        </div>
    `;
}

socket.on('themeChanged', ({ theme }) => {
    console.log(`Recebido evento de mudança de tema: ${theme}`);
    applyTheme(theme);
});

// Ouve por mudanças na visibilidade da URL
socket.on('audienceUrlVisibilityChanged', ({ visible }) => {
    const audienceUrlDisplay = document.getElementById('audience-url-display');
    if (audienceUrlDisplay) {
        audienceUrlDisplay.style.display = visible ? 'block' : 'none';
    }
});

socket.on('error', (message) => alert(message));
socket.on('sessionEnded', (message) => {
    alert(message);
    window.location.href = '/';
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão com o Presenter:', error);
});

socket.on('disconnect', (reason) => {
    console.warn('⚠️ Presenter desconectado do servidor:', reason);
});

socket.on('connect', () => {
    console.log('✅ Conectado ao servidor. Autenticando presenter...');
    joinPresenterSession();
});