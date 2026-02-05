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

        session.questions.push({
            id: session.questions.length,
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

        logAction(sessionCode, `PERGUNTA #${session.questions.length - 1} criada`);
        io.to(sessionCode).emit('questionsUpdated', session.questions);
        if (callback) callback({ success: true });
    });

    // EDITAR UMA PERGUNTA
    socket.on('editQuestion', ({ sessionCode, questionId, updatedQuestion }, callback) => {
        const session = sessions[sessionCode];
        if (!session || !session.questions[questionId]) return;

        const question = session.questions[questionId];
        
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
        if (!session || !session.questions[questionId]) return;

        if (session.activeQuestion === questionId) {
            socket.emit('error', 'Não pode deletar pergunta ativa');
            return;
        }

        // Em vez de setar para null, remove do array
        session.questions.splice(questionId, 1);

        // Re-indexa as perguntas subsequentes
        for (let i = questionId; i < session.questions.length; i++) {
            session.questions[i].id = i;
        }

        logAction(sessionCode, `PERGUNTA #${questionId} deletada`);
        io.to(sessionCode).emit('questionsUpdated', session.questions);
    });

    // Os eventos 'startQuestion', 'stopQuestion', 'showResults', 'duplicateQuestion'
    // não se aplicam ao modelo EAMOS de quiz individual e foram removidos.
    // O progresso é gerenciado por usuário.
}

module.exports = { registerQuestionHandlers };