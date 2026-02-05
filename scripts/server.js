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
        "https://mindpool.alexandre.pro.br",
        "http://mindpool.alexandre.pro.br",
        "https://www.mindpool.alexandre.pro.br",
        "http://www.mindpool.alexandre.pro.br",
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
    socket.on('createSession', async ({ controllerPassword, presenterPassword, deadline, theme, questions: importedQuestions }, callback) => {
        try {
            // Rate limiting
            if (!checkRateLimit(clientIp)) {
                logger.warn(`Rate limit atingido para IP: ${clientIp}`);
                return callback({ 
                    success: false, 
                    message: 'Muitas tentativas. Aguarde alguns segundos.' 
                });
            }

            // Validação básica
            if (!controllerPassword || !presenterPassword) {
                return callback({ success: false, message: 'Senhas são obrigatórias.' });
            }

            if (controllerPassword.length < 4 || presenterPassword.length < 4) {
                return callback({ 
                    success: false, 
                    message: 'Senhas devem ter pelo menos 4 caracteres.' 
                });
            }

            // Hash de senhas
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
                isHashed: ENABLE_PASSWORD_HASHING && bcrypt ? true : false,
                isAudienceUrlVisible: false, // URL da plateia oculta por padrão
                theme: theme || 'light' // Adiciona o tema à sessão
            };

            // Adiciona perguntas importadas, se houver
            if (importedQuestions && Array.isArray(importedQuestions)) {
                importedQuestions.forEach(q => {
                    let formattedOptions;
                    if (q.questionType === 'options' && q.options && Array.isArray(q.options)) {
                        // Converte array de strings para array de objetos {id, text}
                        formattedOptions = q.options.map((optText, index) => ({ id: `opt${index}`, text: String(optText).trim() }));
                    }

                    sessions[sessionCode].questions.push({
                        id: sessions[sessionCode].questions.length,
                        text: q.text,
                        imageUrl: q.imageUrl,
                        questionType: q.questionType,
                        options: formattedOptions,
                        charLimit: q.charLimit,
                        timer: q.timer,
                        results: {},
                        createdAt: Date.now()
                    });
                });
            }

            resetRateLimitAttempts(clientIp);
            logAction(sessionCode, 'CRIADA');
            
            callback({ success: true, sessionCode });
        } catch (err) {
            logger.error(`Erro ao criar sessão: ${err.message}`);
            callback({ success: false, message: 'Erro ao criar sessão. Tente novamente.' });
        }
    });

    // 2. ENTRAR EM UMA SESSÃO
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
            callback({ success: true, deadline: session.deadline, theme: session.theme, audienceCount: session.audienceCount, activeQuestion: session.activeQuestion, isAudienceUrlVisible: session.isAudienceUrlVisible });

            // Enviar estado atual
            socket.emit('questionsUpdated', session.questions);
            if (session.activeQuestion !== null) {
                socket.emit('newQuestion', session.questions[session.activeQuestion]);
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

    // 3. ENTRAR EM UMA SESSÃO (PLATEIA)
    socket.on('joinAudienceSession', ({ sessionCode }) => {
        const session = sessions[sessionCode];
        if (!session) {
            socket.emit('error', 'Sessão não encontrada.');
            return;
        }
        socket.join(sessionCode);
        logger.info(`Socket ${socket.id} (role: audience) JOINED room ${sessionCode}`);
        socket.sessionCode = sessionCode;
        socket.role = 'audience';
        session.audienceCount++;
        
        logAction(sessionCode, `PLATEIA conectada (total: ${session.audienceCount})`);

        // Notifica o controller sobre a mudança na contagem da plateia
        io.to(sessionCode).emit('audienceCountUpdated', { count: session.audienceCount, joined: true });

        // Envia o tema atual da sessão para o novo membro da plateia
        socket.emit('themeChanged', { theme: session.theme || 'light' });

        if (session.activeQuestion !== null) {
            socket.emit('newQuestion', session.questions[session.activeQuestion]);
        }
    });

    // EDITAR PERGUNTA
    socket.on('editQuestion', ({ sessionCode, questionId, updatedQuestion }) => {
        const session = sessions[sessionCode];
        if (session && socket.role === 'controller' && session.questions[questionId] != null) {
            const questionToUpdate = session.questions[questionId];
            
            if (session.activeQuestion === questionId) {
                logger.warn(`Tentativa de editar pergunta ativa ${questionId} na sessão ${sessionCode}`);
                return; // Não permite editar pergunta ativa
            }

            // Atualiza os campos, preservando ID e resultados
            Object.assign(questionToUpdate, updatedQuestion, { id: questionId, results: questionToUpdate.results });
            
            logAction(sessionCode, `PERGUNTA EDITADA (ID: ${questionId})`);
            io.to(sessionCode).emit('questionsUpdated', session.questions);
        }
    });

    // REORDENAR PERGUNTAS
    socket.on('reorderQuestions', ({ sessionCode, newQuestionOrder }) => {
        const session = sessions[sessionCode];
        if (session && socket.role === 'controller') {
            if (!Array.isArray(newQuestionOrder)) return;

            // O cliente é a fonte da verdade para a nova ordem e estado.
            // O servidor apenas re-indexa os IDs para consistência.
            session.questions = newQuestionOrder.filter(q => q !== null).map((q, index) => {
                if (q) q.id = index;
                return q;
            });
            
            logAction(sessionCode, `PERGUNTAS REORDENADAS`);
            io.to(sessionCode).emit('questionsUpdated', session.questions);
        }
    });

    // 10. RECEBER RESPOSTA DA PLATEIA
    socket.on('submitAnswer', ({ sessionCode, questionId, answer }) => {
        const session = sessions[sessionCode];
        if (!session || session.activeQuestion !== questionId) return;

        const question = session.questions[questionId];
        
        if (!question.acceptingAnswers) {
            logger.debug(`Resposta rejeitada: votação encerrada para pergunta ${questionId}`);
            return;
        }

        if (question.endTime && Date.now() > question.endTime) {
            if (question.acceptingAnswers) {
                question.acceptingAnswers = false;
                io.to(sessionCode).emit('votingEnded', { questionId });
            }
            return;
        }

        const { questionType } = question;
        if (questionType === 'options' || questionType === 'yes_no') {
            if (question.results.hasOwnProperty(answer)) {
                question.results[answer]++;
            }
        } else {
            const sanitizedAnswer = String(answer).trim().slice(0, question.charLimit || 280);
            if (sanitizedAnswer) {
                question.results[sanitizedAnswer] = (question.results[sanitizedAnswer] || 0) + 1;
            }
        }

        if (session.questions[questionId]) {
            io.to(sessionCode).emit('updateResults', { 
                results: question.results, 
                questionType: question.questionType,
                questionId: questionId
            });
        }
    });

    // 11. LOGOUT / DISCONNECT
    socket.on('logout', () => {
        const sessionCode = socket.sessionCode;
        if (sessionCode && sessions[sessionCode]) {
            const session = sessions[sessionCode];
            if (socket.role === 'controller') {
                session.controllerSocketId = null;
            } else if (socket.role === 'presenter') {
                session.presenterSocketIds = session.presenterSocketIds.filter(id => id !== socket.id);
            } else if (socket.role === 'audience') {
                session.audienceCount = Math.max(0, session.audienceCount - 1);
            }
            logAction(sessionCode, `${socket.role.toUpperCase()} desconectado (logout)`);
        }
        socket.disconnect();
    });

    // 12. ENCERRAR SESSÃO (NOVO em v1.17)
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
                session.audienceCount = Math.max(0, session.audienceCount - 1);
                // Notifica o controller sobre a mudança na contagem da plateia
                io.to(sessionCode).emit('audienceCountUpdated', { count: session.audienceCount, joined: false });
            }
            logAction(sessionCode, `${socket.role.toUpperCase()} desconectado`);
        }
        logger.info(`Usuário desconectado: ${socket.id}`);
    });
});

// ===== INICIAR SERVIDOR =====
server.listen(PORT, () => {
    logger.info(`========================================`);
    logger.info(`🚀 MindPool Server iniciado`);
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
