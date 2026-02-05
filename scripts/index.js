document.addEventListener('DOMContentLoaded', function () {
    const audienceJoinBtn = document.getElementById('audience-join-btn');
    const controllerLoginBtn = document.getElementById('controller-login-btn');
    const presenterLoginBtn = document.getElementById('presenter-login-btn');
    const audienceSessionCodeInput = document.getElementById('audience-session-code');

    if (audienceJoinBtn && audienceSessionCodeInput) {
        audienceJoinBtn.addEventListener('click', () => {
            const sessionCode = audienceSessionCodeInput.value.trim().toUpperCase();
            if (sessionCode) {
                window.location.href = `/pages/audience.html?session=${sessionCode}`;
            } else {
                alert('Por favor, insira o código da sessão.');
                audienceSessionCodeInput.focus();
            }
        });
    }

    if (controllerLoginBtn) {
        controllerLoginBtn.addEventListener('click', () => {
            window.location.href = '/pages/admin.html';
        });
    }

    if (presenterLoginBtn) {
        presenterLoginBtn.addEventListener('click', () => {
            window.location.href = '/pages/admin.html?role=presenter';
        });
    }
});