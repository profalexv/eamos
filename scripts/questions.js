/**
 * questions.js
 * 
 * Módulo responsável por registrar e gerenciar todos os eventos
 * de Socket.IO relacionados a perguntas (criar, editar, deletar, etc.).
 */

function registerQuestionHandlers(io, socket, sessions, logger) {

    const logAction = (sessionCode, action, details = '') => {
        logger.info(`[SESSION: ${sessionCode}] ${action} ${details}`);
    };

    // CRIAR UMA NOVA PERGUNTA
    socket.on('createQuestion', ({ sessionCode, question }, callback) => {
        const session = sessions[sessionCode];
        if (!session) return;

        // Garante que cada pergunta tenha um ID único e estável, não baseado no índice.
        const newQuestionId = (session.nextQuestionId || session.questions.length);
        session.nextQuestionId = newQuestionId + 1;

        // Cria o objeto da nova pergunta, incluindo todas as propriedades enviadas pelo cliente
        const newQuestion = {
            ...question,
            id: newQuestionId,
            createdAt: Date.now()
        };

        session.questions.push(newQuestion);
        logAction(sessionCode, `PERGUNTA #${newQuestionId} criada`);
        io.to(sessionCode).emit('questionsUpdated', session.questions);
        if (callback) callback({ success: true });
    });

    // EDITAR UMA PERGUNTA
    socket.on('editQuestion', ({ sessionCode, questionId, updatedQuestion }, callback) => {
        const session = sessions[sessionCode];
        if (!session) return;

        const questionIndex = session.questions.findIndex(q => q && q.id === questionId);
        if (questionIndex === -1) return;

        // No modelo EAMOS, a edição pode ser mais flexível, mas ainda é prudente
        // não editar perguntas enquanto usuários podem estar respondendo.
        // Por simplicidade, vamos permitir a edição a qualquer momento.
        const questionToUpdate = session.questions[questionIndex];
        Object.assign(questionToUpdate, updatedQuestion); // Atualiza a pergunta existente com os novos dados

        logAction(sessionCode, `PERGUNTA #${questionId} editada`);
        io.to(sessionCode).emit('questionsUpdated', session.questions);
        if (callback) callback({ success: true });
    });

    // DELETAR UMA PERGUNTA
    socket.on('deleteQuestion', ({ sessionCode, questionId }) => {
        const session = sessions[sessionCode];
        if (!session) return;

        const initialLength = session.questions.length;
        // Filtra a pergunta pelo seu ID único, em vez de depender do índice.
        session.questions = session.questions.filter(q => q && q.id !== questionId);

        if (session.questions.length < initialLength) {
            logAction(sessionCode, `PERGUNTA #${questionId} deletada`);
            // A reordenação no cliente já lida com a atualização da UI.
            // Apenas emitimos a lista atualizada.
            io.to(sessionCode).emit('questionsUpdated', session.questions);
        }
    });

    // Os eventos 'startQuestion', 'stopQuestion', 'showResults', 'duplicateQuestion'
    // não se aplicam ao modelo EAMOS de quiz individual e foram removidos.
    // O progresso é gerenciado por usuário.
}

module.exports = { registerQuestionHandlers };