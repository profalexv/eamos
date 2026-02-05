class Cronometro {
    constructor(endTime, element, onEndCallback) {
        this.endTime = endTime; // Um timestamp futuro em milissegundos
        this.element = element;
        this.onEndCallback = onEndCallback;
        this.intervalId = null;
    }

    start() {
        if (!this.element) return;
        this.intervalId = setInterval(() => this.update(), 1000);
        this.update(); // Chamada inicial para exibir imediatamente
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    update() {
        const remaining = this.endTime - Date.now();

        if (remaining <= 0) {
            this.element.textContent = "00:00";
            this.stop();
            if (this.onEndCallback) this.onEndCallback();
            return;
        }

        const totalSeconds = Math.floor(remaining / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        this.element.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
}