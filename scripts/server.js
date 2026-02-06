const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
require('dotenv').config();

// ===== CONFIGURAÇÃO DE AMBIENTE =====
const NODE_ENV = process.env.NODE_ENV || 'local';
const PORT = process.env.PORT || 3000;
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';
const ENABLE_PASSWORD_HASHING = process.env.ENABLE_PASSWORD_HASHING === 'true';
const ENABLE_RATE_LIMITING = process.env.ENABLE_RATE_LIMITING === 'true';
const SESSION_TIMEOUT = (process.env.SESSION_TIMEOUT || 1440) * 60 * 1000; // converter minutos para ms
const RATE_LIMIT_MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || '5');
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

// ===== DEPENDÊNCIAS =====
let bcrypt;
if (ENABLE_PASSWORD_HASHING) {
    try {
        bcrypt = require('bcryptjs');
    } catch (e) {
        console.warn('bcryptjs não instalado. Instale com: npm install bcryptjs');
        console.warn('Continuando sem hash de senhas...');
    }
}

// ===== HANDLERS DE LÓGICA DE NEGÓCIO =====
const { registerQuestionHandlers } = require('./questions');

// ===== LOGGER CUSTOMIZADO =====
const loggerLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLogLevel = loggerLevels[LOG_LEVEL] || 1;

const logger = {
    levels: loggerLevels,
    level: currentLogLevel,
    
    debug: (msg) => logger.level <= 0 && console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`),
    info: (msg) => logger.level <= 1 && console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
    warn: (msg) => logger.level <= 2 && console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
    error: (msg) => logger.level <= 3 && console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`)
};

// ===== RATE LIMITING =====
const loginAttempts = new Map(); // { ip: { count, resetTime } }

function checkRateLimit(ip) {
    if (!ENABLE_RATE_LIMITING) return true;
    
    const now = Date.now();
    const attempts = loginAttempts.get(ip);
    
    if (!attempts || now > attempts.resetTime) {
        loginAttempts.set(ip, { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }
    
    attempts.count++;
    if (attempts.count > RATE_LIMIT_MAX_ATTEMPTS) {
        return false;
    }
    return true;
}

function resetRateLimitAttempts(ip) {
    loginAttempts.delete(ip);
}

// ===== BCRYPT ALTERNATIVO (sem dependência externa) =====
const simpleHash = {
    hash: async (password) => {
        if (bcrypt) {
            return await bcrypt.hash(password, 10);
        }
        // Hash simples se bcryptjs não estiver disponível (apenas para dev)
        return Buffer.from(password).toString('base64');
    },
    compare: async (password, hash) => {
        if (bcrypt) {
            return await bcrypt.compare(password, hash);
        }
        return Buffer.from(password).toString('base64') === hash;
    }
};

// ===== EXPRESS E SOCKET.IO =====
const app = express();
const server = http.createServer(app);

// Configuração de CORS dinâmica
const getOrigins = () => {
    const origins = [
        "https://eamos.alexandre.pro.br",
        "http://eamos.alexandre.pro.br",
        "https://www.eamos.alexandre.pro.br",
        "http://www.eamos.alexandre.pro.br",
        "http://localhost:3000", // Local
        "http://localhost:*" // Qualquer porta local
    ];
    return origins;
};

const io = new Server(server, {
    cors: {
        origin: getOrigins(),
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true
});

// Middleware para logar conexões
io.use((socket, next) => {
    const clientIp = socket.handshake.address;
    logger.info(`Novo cliente conectando: ${clientIp}`);
    next();
});

// ===== ARMAZENAMENTO DE SESSÕES =====
const sessions = {}; // { sessionCode: { ... } }
const sessionHistories = new Map(); // { controllerSocketId: [...] }

// ===== FUNÇÕES AUXILIARES =====
function generateSessionCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (sessions[code]);
    return code;
}

function logAction(sessionCode, action, details = '') {
    logger.info(`[SESSION: ${sessionCode}] ${action} ${details}`);
}

// Limpeza automática de sessões expiradas
setInterval(() => {
    const now = Date.now();
    const expiredSessions = [];
    
    for (const [code, session] of Object.entries(sessions)) {
        if (SESSION_TIMEOUT > 0 && now - session.createdAt > SESSION_TIMEOUT) {
            expiredSessions.push(code);
        }
    }
    
    expiredSessions.forEach(code => {
        logAction(code, 'EXPIRADA', '(limpeza automática)');
        delete sessions[code];
    });
    
    if (expiredSessions.length > 0) {
        logger.warn(`${expiredSessions.length} sessão(ões) expirada(s) removida(s)`);
    }
}, parseInt(process.env.SESSION_CLEANUP_INTERVAL || '300000'));

// ===== SERVIR ARQUIVOS ESTÁTICOS =====
app.use(express.static(path.join(__dirname, '..')));

// ===== ROTA PARA HEALTH CHECK =====
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        environment: NODE_ENV,
        timestamp: new Date().toISOString(),
        activeSessions: Object.keys(sessions).length
    });
});

// ===== ROTA PARA EXPORT DE RESULTADOS =====
app.get('/api/export/:sessionCode/:format', (req, res) => {
    const { sessionCode, format } = req.params;
    const session = sessions[sessionCode];
    
    if (!session) {
        return res.status(404).json({ error: 'Sessão não encontrada' });
    }
    
    let content, filename, contentType;
    
    if (format === 'json') {
        content = JSON.stringify(session, null, 2);
        filename = `sessao-${sessionCode}.json`;
        contentType = 'application/json';
    } else if (format === 'csv') {
        // Gera CSV com resultados das perguntas
        let csv = 'ID,Pergunta,Tipo,Total Respostas,Resultados\n';
        session.questions.forEach((q, idx) => {
            const results = JSON.stringify(q.results).replace(/"/g, '""');
            csv += `${idx},${q.text.replace(/"/g, '""')},${q.questionType},${Object.values(q.results).reduce((a, b) => a + b, 0)},${results}\n`;
        });
        content = csv;
        filename = `sessao-${sessionCode}.csv`;
        contentType = 'text/csv';
    } else {
        return res.status(400).json({ error: 'Formato inválido (use json ou csv)' });
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
});

// ===== SOCKET.IO EVENTS =====
io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;
    logger.info(`Usuário conectado: ${socket.id}`);

    // Registra os handlers de eventos de perguntas
    registerQuestionHandlers(io, socket, sessions, logger);

    // 1. CRIAR UMA NOVA SESSÃO
    socket.on('createSession', async ({ controllerPassword, presenterPassword, deadline, theme }, callback) => {
        try {
            // Rate limiting
            if (!checkRateLimit(clientIp)) {
                logger.warn(`Rate limit atingido para IP: ${clientIp}`);
                return callback({ success: false, message: 'Muitas tentativas. Aguarde um momento.' });
            }

            // Validação básica
            if (!controllerPassword || !presenterPassword) {
                return callback({ success: false, message: 'As senhas de Controller e Presenter são obrigatórias.' });
            }

            if (controllerPassword.length < 4 || presenterPassword.length < 4) {
                return callback({ 
                    success: false, 
                    message: 'As senhas devem ter pelo menos 4 caracteres.' 
                });
            }

            // Hash de senhas (se habilitado)
            let hashController = controllerPassword;
            let hashPresenter = presenterPassword;
            
            if (ENABLE_PASSWORD_HASHING && bcrypt) {
                try {
                    hashController = await simpleHash.hash(controllerPassword);
                    hashPresenter = await simpleHash.hash(presenterPassword);
                } catch (e) {
                    logger.error(`Erro ao fazer hash das senhas: ${e.message}`);
                }
            }

            const sessionCode = generateSessionCode();
            sessions[sessionCode] = {
                code: sessionCode,
                controllerPassword: hashController,
                presenterPassword: hashPresenter,
                controllerSocketId: null,
                presenterSocketIds: [], // Múltiplos presenters
                deadline: deadline || null,
                questions: [],
                activeQuestion: null,
                audienceCount: 0,
                createdAt: Date.now(),
                createdByIp: clientIp,
                nextQuestionId: 0, // Contador para IDs de perguntas estáveis
                isHashed: ENABLE_PASSWORD_HASHING && bcrypt ? true : false,
                isAudienceUrlVisible: false, // URL da plateia oculta por padrão
                theme: theme || 'light', // Adiciona o tema à sessão
                users: {} // Objeto para armazenar usuários da plateia
            };

            resetRateLimitAttempts(clientIp);
            logAction(sessionCode, 'CRIADA');
            
            callback({ success: true, sessionCode });
        } catch (err) {
            logger.error(`Erro ao criar sessão: ${err.message}`);
            callback({ success: false, message: 'Erro ao criar sessão. Tente novamente.' });
        }
    });

    // 2. ENTRAR EM UMA SESSÃO (CONTROLLER / PRESENTER)
    socket.on('joinAdminSession', async ({ sessionCode, password, role }, callback) => {
        try {
            if (!sessions[sessionCode]) {
                return callback({ success: false, message: 'Sessão não encontrada.' });
            }

            const session = sessions[sessionCode];
            const expectedPassword = role === 'controller' 
                ? session.controllerPassword 
                : session.presenterPassword;

            // Comparar senha (com ou sem hash)
            let passwordMatch = false;
            if (session.isHashed && bcrypt) {
                try {
                    passwordMatch = await simpleHash.compare(password, expectedPassword);
                } catch (e) {
                    passwordMatch = false;
                }
            } else {
                passwordMatch = password === expectedPassword;
            }

            if (!passwordMatch) {
                logger.warn(`Senha incorreta para sessão ${sessionCode} (role: ${role})`);
                return callback({ success: false, message: 'Senha incorreta.' });
            }

            // Verificar se já existe um controller
            if (role === 'controller' && session.controllerSocketId && session.controllerSocketId !== socket.id) {
                // Permitir múltiplos controllers (novo na v1.17)
                logger.warn(`Múltiplos controllers tentando acessar ${sessionCode}`);
                // Desconectar o antigo e conectar o novo
                const oldSocket = io.sockets.sockets.get(session.controllerSocketId);
                if (oldSocket) {
                    oldSocket.emit('controllerDisplaced', { message: 'Novo controller conectado à sessão' });
                    oldSocket.disconnect();
                }
            }

            socket.join(sessionCode);
            logger.info(`Socket ${socket.id} (role: ${role}) JOINED room ${sessionCode}`);
            socket.sessionCode = sessionCode;
            socket.role = role;

            if (role === 'controller') {
                session.controllerSocketId = socket.id;
            } else if (role === 'presenter') {
                if (!session.presenterSocketIds.includes(socket.id)) {
                    session.presenterSocketIds.push(socket.id);
                }
            }

            logAction(sessionCode, `${role.toUpperCase()} conectado`);
            
            // Para EAMOS, o controller precisa da lista de usuários para aprovação.
            const pendingUsers = Object.values(session.users).filter(u => u.status === 'pending');

            callback({ success: true, deadline: session.deadline, theme: session.theme, 
                users: session.users, 
                totalQuestions: session.questions.length,
                isAudienceUrlVisible: session.isAudienceUrlVisible 
            });

            // Enviar estado atual
            socket.emit('questionsUpdated', session.questions);
            if (session.activeQuestion !== null) {
                socket.emit('newQuestion', session.questions.find(q => q.id === session.activeQuestion));
            }
        } catch (err) {
            logger.error(`Erro ao entrar em sessão: ${err.message}`);
            callback({ success: false, message: 'Erro ao conectar. Tente novamente.' });
        }
    });

    // MUDAR O TEMA DA SESSÃO (NOVO)
    socket.on('changeTheme', ({ sessionCode, theme }) => {
        const session = sessions[sessionCode];
        // Apenas o controller pode mudar o tema
        if (session && socket.role === 'controller') {
            session.theme = theme;
            logAction(sessionCode, `TEMA alterado para '${theme}'`);
            // Notifica todos na sala (presenters, outros controllers) sobre a mudança
            io.to(sessionCode).emit('themeChanged', { theme }); // This already notifies audience
        }
    });

    // MOSTRAR/OCULTAR URL DA PLATEIA
    socket.on('toggleAudienceUrl', ({ sessionCode, visible }) => {
        const session = sessions[sessionCode];
        if (session && socket.role === 'controller') {
            session.isAudienceUrlVisible = visible;
            logAction(sessionCode, `Visibilidade da URL da plateia alterada para: ${visible}`);
            io.to(sessionCode).emit('audienceUrlVisibilityChanged', { visible });
        }
    });

    // 3. ENTRAR EM UMA SESSÃO (PARTICIPANTE - EAMOS)
    socket.on('requestJoin', async ({ sessionCode, password, name }, callback) => {
        const session = sessions[sessionCode];
        if (!session) {
            return callback({ success: false, message: 'Sessão não encontrada.' });
        }
        if (!name || name.trim().length < 2) {
            return callback({ success: false, message: 'Por favor, insira um nome válido (mínimo 2 caracteres).' });
        }
        if (!password || password.length < 4) {
            return callback({ success: false, message: 'A senha deve ter pelo menos 4 caracteres.' });
        }

        const trimmedName = name.trim();
        // Procura por um usuário com o mesmo nome, ignorando maiúsculas/minúsculas
        const existingUserEntry = Object.entries(session.users).find(([id, user]) => user.name.toLowerCase() === trimmedName.toLowerCase());

        // Caso 1: Usuário com mesmo nome já existe (tentativa de reconexão)
        if (existingUserEntry) {
            const [oldSocketId, existingUser] = existingUserEntry;
            
            const passwordMatch = await simpleHash.compare(password, existingUser.password);

            if (!passwordMatch) {
                return callback({ success: false, message: 'Um usuário com este nome já existe com uma senha diferente.' });
            }

            // Reconexão bem-sucedida: atualiza o socket ID do usuário
            const userData = { ...existingUser, socketId: socket.id };
            delete session.users[oldSocketId];
            session.users[socket.id] = userData;
            
            socket.sessionCode = sessionCode;
            socket.role = 'audience';
            socket.join(sessionCode);

            logAction(sessionCode, `RECONEXÃO de '${trimmedName}'`);
            io.to(session.controllerSocketId).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
            io.to(session.presenterSocketIds).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });

            if (existingUser.status === 'approved') {
                const currentQuestion = session.questions[existingUser.progress] || null;
                // Notifica o cliente que a reconexão foi bem-sucedida e envia o estado atual
                socket.emit('joinApproved', {
                    firstQuestion: currentQuestion,
                    totalQuestions: session.questions.length
                });
                return callback({ success: true, message: 'Reconectado com sucesso! Carregando seu progresso...' });

            } else { // Se estava pendente, continua aguardando.
                return callback({ success: true, message: 'Aguardando aprovação do controller...' });
            }
        }

        // Caso 2: Novo usuário
        let hashedPassword = password;
        if (ENABLE_PASSWORD_HASHING && bcrypt) {
            hashedPassword = await simpleHash.hash(password);
        }

        session.users[socket.id] = {
            name: trimmedName,
            password: hashedPassword, // Armazena a senha do usuário
            status: 'pending',
            progress: 0,
            socketId: socket.id
        };
        
        socket.sessionCode = sessionCode;
        socket.role = 'audience';
        socket.join(sessionCode);

        logAction(sessionCode, `PEDIDO DE ENTRADA de '${trimmedName}'`);

        if (session.controllerSocketId) {
            io.to(session.controllerSocketId).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
        }

        callback({ success: true, message: 'Aguardando aprovação do controller...' });
    });

    // 4. APROVAR PARTICIPANTE (EAMOS)
    socket.on('approveUser', ({ sessionCode, userIdToApprove }) => {
        const session = sessions[sessionCode];
        if (session && socket.role === 'controller' && session.users[userIdToApprove]) {
            const user = session.users[userIdToApprove];
            user.status = 'approved';
            logAction(sessionCode, `Usuário '${user.name}' APROVADO`);

            // Notifica o controller para atualizar a UI
            io.to(session.controllerSocketId).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
            // Notifica o presenter para atualizar a UI de progresso
            io.to(session.presenterSocketIds).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });

            // Notifica o usuário aprovado para que ele possa começar a responder
            const userSocket = io.sockets.sockets.get(userIdToApprove);
            if (userSocket) {
                userSocket.emit('joinApproved', {
                    firstQuestion: session.questions.length > 0 ? session.questions[0] : null,
                    totalQuestions: session.questions.length
                });
            }
        }
    });

    // 5. REJEITAR PARTICIPANTE (EAMOS)
    socket.on('rejectUser', ({ sessionCode, userIdToReject }) => {
        const session = sessions[sessionCode];
        if (session && socket.role === 'controller' && session.users[userIdToReject]) {
            const user = session.users[userIdToReject];
            if (user.status === 'pending') {
                logAction(sessionCode, `Usuário '${user.name}' REJEITADO`);

                // Notifica o usuário rejeitado
                const userSocket = io.sockets.sockets.get(userIdToReject);
                if (userSocket) {
                    userSocket.emit('error', 'Seu pedido para entrar na sessão foi rejeitado.');
                    userSocket.disconnect(true);
                }

                delete session.users[userIdToReject];

                // Notifica controller e presenter para atualizar as listas
                io.to(session.controllerSocketId).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
                io.to(session.presenterSocketIds).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
            }
        }
    });

    // 6. REMOVER/KICKAR PARTICIPANTE (EAMOS)
    socket.on('removeUser', ({ sessionCode, userIdToRemove }) => {
        const session = sessions[sessionCode];
        if (session && socket.role === 'controller' && session.users[userIdToRemove]) {
            const user = session.users[userIdToRemove];
            logAction(sessionCode, `Usuário '${user.name}' REMOVIDO`);

            const userSocket = io.sockets.sockets.get(userIdToRemove);
            if (userSocket) {
                userSocket.emit('sessionEnded', { message: 'Você foi removido da sessão pelo controller.' });
                userSocket.disconnect(true);
            }

            delete session.users[userIdToRemove];
            io.to(session.controllerSocketId).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
            io.to(session.presenterSocketIds).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
        }
    });

    // REORDENAR PERGUNTAS
    socket.on('reorderQuestions', ({ sessionCode, newQuestionOrder }) => {
        const session = sessions[sessionCode];
        if (session && socket.role === 'controller') {
            if (!Array.isArray(newQuestionOrder)) return;

            // A nova ordem vem do cliente. Apenas atualizamos a lista no servidor.
            // É CRUCIAL não reatribuir os IDs aqui para manter a estabilidade.
            // Apenas garantimos que a ordem corresponde à enviada pelo controller.
            session.questions = newQuestionOrder.filter(q => q !== null);

            logAction(sessionCode, `PERGUNTAS REORDENADAS`);
            // Emitimos a lista reordenada para todos os clientes para garantir consistência.
            io.to(sessionCode).emit('questionsUpdated', session.questions);
        }
    });

    // 10. RECEBER RESPOSTA DO PARTICIPANTE (EAMOS)
    socket.on('submitAnswer', ({ sessionCode, questionId, answer }) => {
        const session = sessions[sessionCode];
        const user = session?.users[socket.id];

        // Valida se o usuário está respondendo a pergunta correta na sequência.
        const expectedQuestion = session?.questions[user?.progress];
        if (!user || !expectedQuestion || expectedQuestion.id !== questionId) {
            return;
        }
        
        const question = expectedQuestion;
        let isCorrect = false;

        // Lógica de pular
        if (answer === '__SKIP__') {
            if (question.skippable) {
                isCorrect = true; // Trata o pulo como uma resposta "correta" para avançar
                logAction(sessionCode, `Usuário '${user.name}' pulou a pergunta #${questionId}`);
            } else {
                return; // Tentativa de pular pergunta não pulável
            }
        } else {
            // Lógica de verificação da resposta
            // A resposta correta pode ser um array ou um valor único.
            const correctAnswers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
            isCorrect = correctAnswers.includes(answer);
        }

        if (isCorrect) {
            user.progress++;
            const nextQuestion = user.progress < session.questions.length ? session.questions[user.progress] : null;
            
            // Envia o resultado e a próxima pergunta para o usuário
            socket.emit('answerResult', { correct: true, nextQuestion });

            // Notifica controller e presenter sobre a atualização de progresso
            io.to(session.controllerSocketId).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
            io.to(session.presenterSocketIds).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
            logAction(sessionCode, `Progresso de '${user.name}' atualizado para ${user.progress}`);
        } else {
            // Envia o resultado incorreto para o usuário
            socket.emit('answerResult', { correct: false });
        }
    });

    // 11. ENCERRAR SESSÃO
    socket.on('endSession', ({ sessionCode }) => {
        if (sessions[sessionCode]) {
            logAction(sessionCode, 'ENCERRADA pelo controller');
            io.to(sessionCode).emit('sessionEnded', { message: 'Sessão encerrada pelo controller' });
            delete sessions[sessionCode];
        }
    });

    // Disconnect automático
    socket.on('disconnect', () => {
        const sessionCode = socket.sessionCode;
        if (sessionCode && sessions[sessionCode]) {
            const session = sessions[sessionCode];
            if (socket.role === 'controller' && session.controllerSocketId === socket.id) {
                session.controllerSocketId = null;
            } else if (socket.role === 'presenter') {
                session.presenterSocketIds = session.presenterSocketIds.filter(id => id !== socket.id);
            } else if (socket.role === 'audience') {
                // NÃO DELETA o usuário, apenas marca como desconectado para permitir reconexão.
                const userEntry = Object.entries(session.users).find(([id, user]) => id === socket.id);
                if (userEntry) {
                    const user = userEntry[1];
                    logAction(sessionCode, `Participante '${user.name}' desconectado (socket: ${socket.id})`);
                    user.status = 'disconnected'; // Adiciona um status para a UI
                    io.to(session.controllerSocketId).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
                    io.to(session.presenterSocketIds).emit('userListUpdated', { users: session.users, totalQuestions: session.questions.length });
                }
            }
        }
        logger.info(`Usuário desconectado: ${socket.id}`);
    });
});

// ===== INICIAR SERVIDOR =====
server.listen(PORT, () => {
    logger.info(`========================================`);
    logger.info(`🚀 EAMOS Server iniciado`);
    logger.info(`📌 Ambiente: ${NODE_ENV}`);
    logger.info(`🌐 URL: http://localhost:${PORT}`);
    logger.info(`🔐 Hashing de senhas: ${ENABLE_PASSWORD_HASHING && bcrypt ? 'ATIVO' : 'INATIVO'}`);
    logger.info(`⚔️  Rate limiting: ${ENABLE_RATE_LIMITING ? 'ATIVO' : 'INATIVO'}`);
    logger.info(`⏱️  Timeout de sessão: ${SESSION_TIMEOUT > 0 ? SESSION_TIMEOUT / 1000 + 's' : 'Nunca'}`);
    logger.info(`========================================`);
});

// ===== TRATAMENTO DE ERROS =====
process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled Promise Rejection: ${err.message}`);
});

process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.message}`);
    process.exit(1);
});
