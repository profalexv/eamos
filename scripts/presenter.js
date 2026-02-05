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
    let password = sessionStorage.getItem('eamos_session_pass');
    if (password) console.log('INFO: Senha encontrada no sessionStorage da aba.');

    // 2. Se não encontrar, verifica se foi passada uma senha temporária de outra aba via localStorage.
    if (!password) {
        const tempPass = localStorage.getItem('eamos_temp_pass');
        if (tempPass) {
            console.log('INFO: Senha temporária encontrada no localStorage, movendo para sessionStorage.');
            password = tempPass;
            sessionStorage.setItem('eamos_session_pass', tempPass); // Move para o sessionStorage desta aba
            // Não removemos o item do localStorage. Isso permite que a prévia no controller
            // funcione de forma consistente mesmo após recarregar a página, embora
            // deixe a senha do presenter no localStorage. É um trade-off para a funcionalidade.
            // localStorage.removeItem('mindpool_temp_pass');
        }
    }

    if (!password) console.error('ERRO CRÍTICO: Nenhuma senha encontrada para autenticação do presenter.');
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
        // Para EAMOS, o presenter precisa da lista inicial de usuários e total de perguntas.
        if (response.users) {
            renderProgress(response.users, response.totalQuestions);
        }
    });
}

function renderProgress(users, totalQuestions) {
    const container = document.getElementById('progress-bars-container');
    if (!container) return;

    container.innerHTML = ''; // Limpa o container

    const approvedUsers = Object.values(users).filter(u => u.status === 'approved');

    if (approvedUsers.length === 0) {
        container.innerHTML = '<p>Nenhum participante aprovado ainda.</p>';
        return;
    }

    approvedUsers.forEach(user => {
        const percentage = totalQuestions > 0 ? (user.progress / totalQuestions) * 100 : 0;
        const userProgressEl = document.createElement('div');
        userProgressEl.className = 'user-progress-bar';
        userProgressEl.innerHTML = `
            <span class="user-name">${user.name}</span>
            <div class="progress-track">
                <div class="progress-fill" style="width: ${percentage}%;"></div>
            </div>
            <span class="progress-label">${user.progress}/${totalQuestions}</span>
        `;
        container.appendChild(userProgressEl);
    });
}

// 2. Ouvir por atualizações na lista de usuários/progresso
socket.on('userListUpdated', ({ users, totalQuestions }) => {
    renderProgress(users, totalQuestions);
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
    window.location.href = '/';
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