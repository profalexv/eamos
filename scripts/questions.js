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

        session.questions.push({
            id: newQuestionId,
            text: question.text,
            imageUrl: question.imageUrl,
            questionType: question.questionType,
            options: question.options, // [{id, text}, ...]
            correctAnswer: question.correctAnswer, // e.g., 'opt1' or ['opt1', 'opt3']
            skippable: question.skippable || false,
            charLimit: question.charLimit,
            timer: question.timer,
            // 'results' e 'isConcluded' não são mais necessários no modelo EAMOS
            createdAt: Date.now()
        });

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

        const question = session.questions[questionIndex];

        // No modelo EAMOS, a edição pode ser mais flexível, mas ainda é prudente
        // não editar perguntas enquanto usuários podem estar respondendo.
        // Por simplicidade, vamos permitir a edição a qualquer momento.

        question.text = updatedQuestion.text || question.text;
        question.imageUrl = updatedQuestion.imageUrl || question.imageUrl;
        question.options = updatedQuestion.options || question.options;
        question.correctAnswer = updatedQuestion.correctAnswer; // Pode ser undefined se não for alterado
        question.skippable = updatedQuestion.skippable;
        question.charLimit = updatedQuestion.charLimit || question.charLimit;
        question.timer = updatedQuestion.timer || question.timer;

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