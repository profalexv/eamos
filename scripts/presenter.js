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

let currentPresenterState = {
    mode: 'ranking',
    chartType: 'bar',
    showRankPosition: false
};

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

function getPresenterPassword() {
    // 1. Verifica se uma senha temporária foi passada pela aba do Controller via localStorage.
    const tempPass = localStorage.getItem('eamos_temp_pass');
    if (tempPass) {
        console.log('INFO: Senha temporária do controller encontrada, movendo para sessionStorage.');
        sessionStorage.setItem('eamos_presenter_pass', tempPass);
        // Não removemos o item do localStorage para permitir que a prévia no controller
        // funcione de forma consistente mesmo após recarregar a página.
    }

    // 2. Retorna a senha do presenter do sessionStorage.
    // Ela foi definida pelo passo 1 ou por um login direto na página de admin.
    const password = sessionStorage.getItem('eamos_presenter_pass');
    if (!password) {
        console.error('ERRO CRÍTICO: Nenhuma senha de presenter encontrada para autenticação.');
    }
    return password;
}

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
    const sessionPassword = getPresenterPassword();

    if (!sessionPassword) {
        console.error('Falha na autenticação: senha não encontrada no sessionStorage ou localStorage.');
        alert('Erro de autenticação. A sessão pode ter expirado ou a senha não foi fornecida. Por favor, tente entrar novamente.');
        window.location.href = `admin.html?role=presenter`;
        return;
    }
    socket.emit('joinAdminSession', { sessionCode, password: sessionPassword, role: 'presenter' }, (response) => {        
        // Não remover a senha do sessionStorage para permitir que a re-autenticação em 'connect' funcione.

        if (!response.success) {
            alert(response.message);
            window.location.href = `admin.html?role=presenter`;
            return;
        }

        applyTheme(response.theme);

        // NOVO: Define o modo de visualização inicial
        if (response.presenterMode) {
            currentPresenterState = response.presenterMode;
        }

        // Ao entrar, verifica se a URL já deve estar visível
        if (response.isAudienceUrlVisible) {
            const audienceUrlDisplay = document.getElementById('audience-url-display');
            if (audienceUrlDisplay) {
                audienceUrlDisplay.style.display = 'block';
            }
        }
        
        // Renderiza a tela inicial com base no modo e nos dados recebidos
        if (response.users) {
            renderPresenterScreen(response.users, response.totalQuestions);
        }
    });
}

// FUNÇÃO PRINCIPAL DE RENDERIZAÇÃO
function renderPresenterScreen(users, totalQuestions) {
    const { mode, chartType } = currentPresenterState;
    const progressScreen = document.getElementById('progress-screen');
    if (!progressScreen) return;

    if (mode === 'none') {
        progressScreen.style.display = 'none';
        return;
    }

    // Garante que a tela de progresso esteja visível para os outros modos
    progressScreen.style.display = 'block';

    const titleEl = document.getElementById('presenter-view-title');
    const container = document.getElementById('progress-content-container');
    if (!container || !titleEl) return;

    container.innerHTML = ''; // Limpa o conteúdo anterior

    const approvedUsers = Object.values(users).filter(u => u.status === 'approved' || u.status === 'disconnected');

    if (approvedUsers.length === 0) {
        titleEl.innerText = 'Progresso dos Participantes';
        container.innerHTML = '<p>Nenhum participante aprovado ainda.</p>';
        return;
    }

    switch (mode) {
        case 'individual':
            titleEl.innerText = 'Progresso Individual';
            renderIndividualCharts(container, approvedUsers, totalQuestions, chartType);
            break;
        case 'overall':
            titleEl.innerText = 'Progresso Geral da Turma';
            renderOverallChart(container, approvedUsers, totalQuestions, chartType);
            break;
        case 'ranking':
            titleEl.innerText = 'Ranking Comparativo';
            renderRankingView(container, approvedUsers, totalQuestions);
            break;
        case 'list':
        default:
            titleEl.innerText = 'Progresso dos Participantes';
            renderProgressList(container, approvedUsers, totalQuestions);
            break;
    }
}

// Renomeada de renderProgress para renderProgressList
function renderProgressList(container, approvedUsers, totalQuestions) {
    approvedUsers.forEach(user => {
        const percentage = totalQuestions > 0 ? (user.progress / totalQuestions) * 100 : 0;
        const userProgressEl = document.createElement('div');
        userProgressEl.className = 'user-progress-bar';
        userProgressEl.innerHTML = `
            <span class="user-name">${user.name}${user.status === 'disconnected' ? ' (Offline)' : ''}</span>
            <div class="progress-track">
                <div class="progress-fill" style="width: ${percentage}%;"></div>
            </div>
            <span class="progress-label">${user.progress}/${totalQuestions}</span>
        `;
        container.appendChild(userProgressEl);
    });
}

// NOVA: Renderiza gráficos individuais
function renderIndividualCharts(container, approvedUsers, totalQuestions, chartType) {
    container.className = 'individual-charts-grid'; // Usa a classe de grid

    approvedUsers.forEach(user => {
        const percentage = totalQuestions > 0 ? (user.progress / totalQuestions) * 100 : 0;
        const chartItem = document.createElement('div');
        chartItem.className = 'chart-item';

        if (chartType === 'pie') {
            chartItem.innerHTML = `
                <div class="chart-pie" style="--p: ${percentage}">
                    <span class="chart-pie-label">${Math.round(percentage)}%</span>
                </div>
                <span class="user-name">${user.name}${user.status === 'disconnected' ? ' (Offline)' : ''}</span>
            `;
        } else { // 'bar'
            chartItem.innerHTML = `
                <span class="user-name">${user.name}${user.status === 'disconnected' ? ' (Offline)' : ''}</span>
                <div class="progress-track" style="width: 100%; height: 25px;">
                    <div class="progress-fill" style="width: ${percentage}%;"></div>
                </div>
                <span class="progress-label">${user.progress}/${totalQuestions}</span>
            `;
        }
        container.appendChild(chartItem);
    });
}

// NOVA: Renderiza gráfico geral
function renderOverallChart(container, approvedUsers, totalQuestions, chartType) {
    container.className = 'overall-chart-container';

    const totalProgress = approvedUsers.reduce((sum, user) => sum + user.progress, 0);
    const maxProgress = approvedUsers.length * totalQuestions;
    const averagePercentage = maxProgress > 0 ? (totalProgress / maxProgress) * 100 : 0;

    if (chartType === 'pie') {
        container.innerHTML = `
            <div class="chart-pie" style="--p: ${averagePercentage}">
                <span class="chart-pie-label">${Math.round(averagePercentage)}%</span>
            </div>
            <p>Média de conclusão da turma.</p>
        `;
    } else { // 'bar'
        container.innerHTML = `
            <div class="progress-track">
                <div class="progress-fill" style="width: ${averagePercentage}%;"></div>
            </div>
            <p>Média de conclusão da turma: <strong>${Math.round(averagePercentage)}%</strong></p>
        `;
    }
}

// NOVA: Renderiza visão de ranking
function renderRankingView(container, approvedUsers, totalQuestions) {
    container.className = 'ranking-container';

    if (totalQuestions === 0) {
        container.innerHTML = '<p>Crie perguntas para ver o ranking.</p>';
        return;
    }

    const sortedUsers = [...approvedUsers].sort((a, b) => b.progress - a.progress);
    
    const track = document.createElement('div');
    track.className = 'ranking-bar-track';

    sortedUsers.forEach((user, index) => {
        const percentage = (user.progress / totalQuestions) * 100;
        const marker = document.createElement('div');
        marker.className = 'ranking-marker';
        marker.style.left = `${percentage}%`;

        if (index === 0) marker.classList.add('rank-first');
        if (index === sortedUsers.length - 1 && sortedUsers.length > 1) marker.classList.add('rank-last');

        if (currentPresenterState.showRankPosition) {
            const rankLabel = document.createElement('span');
            rankLabel.className = 'ranking-position-label';
            rankLabel.innerText = index + 1;
            rankLabel.style.position = 'absolute';
            rankLabel.style.transform = 'translateY(15px)'; // Position below marker
            marker.appendChild(rankLabel);
        }
        marker.innerHTML = `<div class="ranking-tooltip">${user.name} (${user.progress}/${totalQuestions})</div>`;
        track.appendChild(marker);
    });

    container.appendChild(track);
}

// 2. Ouvir por atualizações na lista de usuários/progresso
socket.on('userListUpdated', ({ users, totalQuestions }) => {
    // Agora chama a função principal de renderização
    renderPresenterScreen(users, totalQuestions);
});

// NOVO: Ouve por mudanças no modo de visualização do presenter
socket.on('presenterModeChanged', ({ presenterMode, users, totalQuestions }) => {
    console.log(`Recebido evento de mudança de modo do presenter:`, presenterMode);
    currentPresenterState = presenterMode;
    renderPresenterScreen(users, totalQuestions);
});

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
    window.location.href = '../index.html';
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão com o Presenter:', error);
});

socket.on('disconnect', (reason) => {
    console.warn('⚠️ Presenter desconectado do servidor:', reason);
});

socket.on('connect', () => {
    console.log('✅ Conectado ao servidor. Autenticando EAMOS presenter...');
    joinPresenterSession();
});