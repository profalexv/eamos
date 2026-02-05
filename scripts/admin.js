// ===== CONFIGURAÇÃO DE SOCKET.IO =====
// Detecta ambiente (local ou produção)
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

const params = new URLSearchParams(window.location.search);
const role = params.get('role');
let questionsToImport = []; // Armazena perguntas carregadas de um arquivo

// ===== SELEÇÃO DE ELEMENTOS DO DOM =====
const pageTitle = document.getElementById('page-title');
const errorMsg = document.getElementById('error-message');

// Seções
const actionButtonsDiv = document.getElementById('action-buttons');
const newSessionForm = document.getElementById('new-session-form');
const joinSessionForm = document.getElementById('join-session-form');

// Botões de ação principal
const createSessionMainBtn = document.getElementById('create-session-main-btn');
const joinSessionMainBtn = document.getElementById('join-session-main-btn');
const backToIndexBtn = document.getElementById('back-to-index-btn');

// Formulário de Nova Sessão
const loadFromFileBtn = document.getElementById('load-session-from-file-btn');
const loadSessionInput = document.getElementById('load-session-input');
const createSessionBtn = document.getElementById('create-session-btn');
const newControllerPassInput = document.getElementById('new-controller-pass');
const newPresenterPassInput = document.getElementById('new-presenter-pass');
const deadlineInput = document.getElementById('session-deadline');
const sessionThemeInput = document.getElementById('session-theme');

// Formulário de Entrar em Sessão
const joinSessionBtn = document.getElementById('join-session-btn');
const joinSessionCodeInput = document.getElementById('join-session-code');
const joinSessionPassInput = document.getElementById('join-session-pass');

// Botões de "Voltar"
const backToMenuBtns = document.querySelectorAll('.back-to-menu-btn');

// ===== FUNÇÃO PARA LIMPAR MENSAGENS DE ERRO =====
function clearError() {
    errorMsg.innerText = '';
    errorMsg.style.display = 'none';
}

// ===== FUNÇÃO PARA MOSTRAR ERRO =====
function showError(message) {
    errorMsg.innerText = message;
    errorMsg.style.display = 'block';
}

function showMainMenu() {
    actionButtonsDiv.classList.add('active');
    newSessionForm.classList.remove('active');
    joinSessionForm.classList.remove('active');
    clearError();
    // Limpar campos
    newControllerPassInput.value = '';
    newPresenterPassInput.value = '';
    deadlineInput.value = '';
    if (sessionThemeInput) sessionThemeInput.value = 'light';
    joinSessionCodeInput.value = '';
    joinSessionPassInput.value = '';
    questionsToImport = []; // Limpa perguntas importadas
}

// ===== VALIDAÇÃO E CONFIGURAÇÃO INICIAL DA UI =====
if (!role || role === 'controller') {
    pageTitle.innerText = 'Acesso Administrativo';
    actionButtonsDiv.classList.add('active');
} else if (role === 'presenter') {
    pageTitle.innerText = `Acesso: ${role.charAt(0).toUpperCase() + role.slice(1)}`;
    actionButtonsDiv.style.display = 'none';
    newSessionForm.style.display = 'none';
    joinSessionForm.classList.add('active');
    // Para o presenter, o botão "voltar" do formulário de join deve ir para o início
    const presenterBackBtn = joinSessionForm.querySelector('.back-to-menu-btn');
    if (presenterBackBtn) {
        presenterBackBtn.innerText = 'Cancelar';
        presenterBackBtn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevenir que o outro listener de 'back-to-menu' seja acionado
            e.stopPropagation();
            window.location.href = '/index.html';
        });
    }
} else {
    pageTitle.innerText = 'Erro de Acesso';
    showError(`Função (role) "${role}" é inválida.`);
    actionButtonsDiv.style.display = 'none';
    newSessionForm.style.display = 'none';
    joinSessionForm.style.display = 'none';
}

// ===== EVENT LISTENERS =====

// Botões do menu principal
createSessionMainBtn?.addEventListener('click', () => {
    actionButtonsDiv.classList.remove('active');
    newSessionForm.classList.add('active');
    clearError();
    newControllerPassInput.focus();
});

joinSessionMainBtn?.addEventListener('click', () => {
    actionButtonsDiv.classList.remove('active');
    joinSessionForm.classList.add('active');
    clearError();
    joinSessionCodeInput.focus();
});

backToIndexBtn.addEventListener('click', () => {
    window.location.href = '/index.html';
});

// Botões de "Voltar" dentro dos formulários
backToMenuBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        showMainMenu();
    });
});

loadFromFileBtn?.addEventListener('click', () => {
    loadSessionInput.click();
});

loadSessionInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (data.sessionSettings) {
                const { theme, controllerPassword, presenterPassword } = data.sessionSettings;
                if (theme) sessionThemeInput.value = theme;
                if (controllerPassword) newControllerPassInput.value = controllerPassword;
                if (presenterPassword) newPresenterPassInput.value = presenterPassword;
            }
            if (data.questions && Array.isArray(data.questions)) {
                questionsToImport = data.questions;
                alert(`${questionsToImport.length} pergunta(s) carregada(s) e prontas para serem incluídas na nova sessão.`);
            } else {
                questionsToImport = [];
            }
        } catch (error) {
            showError('Erro ao processar o arquivo. Verifique se é um JSON válido.');
            questionsToImport = [];
        } finally {
            // Limpa o input para permitir carregar o mesmo arquivo novamente
            loadSessionInput.value = '';
        }
    };
    reader.onerror = () => {
        showError('Não foi possível ler o arquivo.');
        loadSessionInput.value = '';
    };
    reader.readAsText(file);
});

// Lógica de criação de sessão
createSessionBtn?.addEventListener('click', () => {
    const controllerPassword = newControllerPassInput.value.trim();
    const presenterPassword = newPresenterPassInput.value.trim();
    const theme = sessionThemeInput ? sessionThemeInput.value : 'light';
    const deadlineValue = deadlineInput.value;
    const deadline = deadlineValue ? new Date(new Date().toDateString() + ' ' + deadlineValue).getTime() : null;

    clearError();

    if (!controllerPassword || !presenterPassword) {
        showError('Por favor, preencha ambas as senhas.');
        return;
    }
    if (controllerPassword.length < 4 || presenterPassword.length < 4) {
        showError('As senhas devem ter pelo menos 4 caracteres.');
        return;
    }

    createSessionBtn.disabled = true;
    createSessionBtn.innerText = 'Criando...';

    const payload = { controllerPassword, presenterPassword, deadline, theme, questions: questionsToImport };

    socket.emit('createSession', payload, (response) => {
        createSessionBtn.disabled = false;
        createSessionBtn.innerText = 'Criar e Entrar';
        
        if (response.success) {
            questionsToImport = []; // Limpa após o uso
            sessionStorage.setItem('mindpool_session_code', response.sessionCode);
            sessionStorage.setItem('mindpool_session_pass', controllerPassword);
            sessionStorage.setItem('mindpool_presenter_pass', presenterPassword);

            window.location.href = `/pages/controller.html?session=${response.sessionCode}`;
        } else {
            showError(response.message || 'Ocorreu um erro ao criar a sessão.');
        }
    });
});

// Lógica para entrar em sessão
joinSessionBtn?.addEventListener('click', () => {
    const sessionCode = joinSessionCodeInput.value.toUpperCase().trim();
    const password = joinSessionPassInput.value.trim();

    clearError();

    if (!sessionCode || !password) {
        showError('Código e senha são obrigatórios.');
        return;
    }

    const roleToJoin = role || 'controller';
    // Armazena temporariamente a senha para a próxima página e redireciona
    sessionStorage.setItem('mindpool_session_code', sessionCode);
    sessionStorage.setItem('mindpool_session_pass', password);
    const targetPage = roleToJoin === 'controller' ? 'controller' : roleToJoin;
    window.location.href = `/pages/${targetPage}.html?session=${sessionCode}`;
});

// ===== EVENTOS DE CONEXÃO =====
socket.on('connect', () => {
    console.log('✅ Conectado ao servidor');
    clearError();
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão:', error);
    showError('Não foi possível conectar ao servidor. Verifique a internet e tente novamente.');
});

socket.on('disconnect', (reason) => {
    console.warn('⚠️  Desconectado do servidor:', reason);
});
