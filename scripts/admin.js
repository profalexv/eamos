// ===== CONFIGURAÇÃO DE SOCKET.IO =====
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

const params = new URLSearchParams(window.location.search);
const role = params.get('role');
let questionsToImport = []; // Armazena perguntas carregadas de um arquivo

// ===== SELEÇÃO DE ELEMENTOS DO DOM =====
const pageTitle = document.getElementById('page-title');
const errorMsg = document.getElementById('error-message');
const connectionStatusBanner = document.getElementById('connection-status-banner');
const connectionStatusText = document.getElementById('connection-status-text');

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
const repeatControllerPassCheckbox = document.getElementById('repeat-controller-pass');
const noPresenterPassCheckbox = document.getElementById('no-presenter-pass');
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

function setConnectionStatus(status, message) {
    if (!connectionStatusBanner || !connectionStatusText) return;

    const buttonsToDisable = [createSessionMainBtn, joinSessionMainBtn];

    switch (status) {
        case 'connecting':
            connectionStatusBanner.classList.remove('error');
            connectionStatusBanner.classList.add('visible');
            connectionStatusText.innerText = message || 'Conectando ao servidor...';
            buttonsToDisable.forEach(btn => btn && (btn.disabled = true));
            break;
        case 'connected':
            connectionStatusBanner.classList.remove('visible');
            buttonsToDisable.forEach(btn => btn && (btn.disabled = false));
            break;
        case 'error':
            connectionStatusBanner.classList.add('error');
            connectionStatusBanner.classList.add('visible');
            connectionStatusText.innerText = message || 'Falha na conexão.';
            buttonsToDisable.forEach(btn => btn && (btn.disabled = true));
            break;
    }
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
            window.location.href = '../index.html';
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
    window.location.href = '../index.html';
});

// Lógica para os checkboxes de senha do apresentador
function handlePresenterPassCheckboxes() {
    const presenterInputGroup = newPresenterPassInput.closest('.form-group');
    if (!presenterInputGroup) return;

    if (repeatControllerPassCheckbox.checked || noPresenterPassCheckbox.checked) {
        newPresenterPassInput.disabled = true;
        newPresenterPassInput.required = false;
        presenterInputGroup.style.display = 'none';
    } else {
        newPresenterPassInput.disabled = false;
        newPresenterPassInput.required = true;
        presenterInputGroup.style.display = 'block';
    }
}

repeatControllerPassCheckbox?.addEventListener('change', () => {
    if (repeatControllerPassCheckbox.checked) noPresenterPassCheckbox.checked = false;
    handlePresenterPassCheckboxes();
});

noPresenterPassCheckbox?.addEventListener('change', () => {
    if (noPresenterPassCheckbox.checked) repeatControllerPassCheckbox.checked = false;
    handlePresenterPassCheckboxes();
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
            // Suporta o novo formato {sessionSettings, questions} e o formato antigo [questions]
            const loadedQuestions = data.questions || data;

            if (Array.isArray(loadedQuestions)) {
                questionsToImport = loadedQuestions;
                alert(`${questionsToImport.length} pergunta(s) carregada(s) e prontas para serem incluídas na nova sessão.`);
            } else {
                questionsToImport = [];
                throw new Error('O arquivo não contém um array de perguntas válido.');
            }

            // Opcional: carregar configurações da sessão
            if (data.sessionSettings && data.sessionSettings.theme && sessionThemeInput) {
                sessionThemeInput.value = data.sessionSettings.theme;
            }

        } catch (error) {
            showError('Erro ao processar o arquivo: ' + error.message);
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

// Botões de "Voltar" dentro dos formulários
backToMenuBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        showMainMenu();
    });
});

// Lógica de criação de sessão
createSessionBtn?.addEventListener('click', () => {
    const controllerPassword = newControllerPassInput.value.trim();
    const presenterPassword = newPresenterPassInput.value.trim(); // Pode estar vazio
    const repeatControllerPass = repeatControllerPassCheckbox.checked;
    const noPresenterPass = noPresenterPassCheckbox.checked;
    const theme = sessionThemeInput ? sessionThemeInput.value : 'light';
    const deadlineValue = deadlineInput.value;
    const deadline = deadlineValue ? new Date(new Date().toDateString() + ' ' + deadlineValue).getTime() : null;

    clearError();

    // Validação da senha do Controller
    if (!controllerPassword) {
        showError('A senha de Controller é obrigatória.');
        return;
    }
    if (controllerPassword.length < 4) {
        showError('A senha de Controller deve ter pelo menos 4 caracteres.');
        return;
    }

    // Validação da senha do Presenter (apenas se nenhuma caixa estiver marcada)
    if (!repeatControllerPass && !noPresenterPass) {
        if (!presenterPassword) {
            showError('A senha de Presenter é obrigatória ou marque uma das opções.');
            return;
        }
        if (presenterPassword.length < 4) {
            showError('A senha de Presenter deve ter pelo menos 4 caracteres.');
            return;
        }
    }

    createSessionBtn.disabled = true;
    createSessionBtn.innerText = 'Criando...';

    const payload = { controllerPassword, presenterPassword, deadline, theme, repeatControllerPass, noPresenterPass, questions: questionsToImport };

    socket.emit('createSession', payload, (response) => {
        createSessionBtn.disabled = false;
        createSessionBtn.innerText = 'Criar e Entrar';
        
        if (response.success) {
            questionsToImport = []; // Limpa após o uso
            sessionStorage.setItem('eamos_session_code', response.sessionCode);
            sessionStorage.setItem('eamos_session_pass', controllerPassword);

            // Define a senha correta do presenter para a próxima página
            let presenterPassForStorage = '';
            if (repeatControllerPass) {
                presenterPassForStorage = controllerPassword;
            } else if (!noPresenterPass) {
                presenterPassForStorage = presenterPassword;
            }
            sessionStorage.setItem('eamos_presenter_pass', presenterPassForStorage);

            window.location.href = `controller.html?session=${response.sessionCode}`;
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

    if (!sessionCode) {
        showError('O código da sessão é obrigatório.');
        return;
    }
    // A senha pode ser vazia para presenters de sessões sem senha
    if (role !== 'presenter' && !password) {
        showError('A senha é obrigatória.');
        return;
    }

    const roleToJoin = role || 'controller';
    // Armazena a senha na chave correta para a role que está entrando
    sessionStorage.setItem('eamos_session_code', sessionCode);
    if (roleToJoin === 'presenter') {
        sessionStorage.setItem('eamos_presenter_pass', password);
    } else {
        sessionStorage.setItem('eamos_session_pass', password);
    }

    const targetPage = roleToJoin === 'controller' ? 'controller' : roleToJoin;
    window.location.href = `${targetPage}.html?session=${sessionCode}`;
});

// ===== EVENTOS DE CONEXÃO =====
socket.on('connect', () => {
    console.log('✅ Conectado ao servidor');
    clearError();
    setConnectionStatus('connected');
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão:', error);
    showError('Não foi possível conectar ao servidor. Verifique a internet e tente novamente.');
    setConnectionStatus('error', 'Falha na conexão. Tentando reconectar...');
});

socket.on('disconnect', (reason) => {
    console.warn('⚠️  Desconectado do servidor:', reason);
    // Só mostra o banner se não for uma desconexão manual (ex: navegação)
    if (reason !== 'io client disconnect') {
        setConnectionStatus('connecting', 'Conexão perdida. Reconectando...');
    }
});

// Inicializa o estado dos checkboxes ao carregar a página
document.addEventListener('DOMContentLoaded', handlePresenterPassCheckboxes);

// Inicia a UI no estado de "conectando"
setConnectionStatus('connecting');
