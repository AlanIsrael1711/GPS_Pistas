(function configurarModoOffline() {
    'use strict';

    function conectarControlMapaBase() {
        const control = document.getElementById('chkMapaBase');
        if (!control) return;
        control.checked = localStorage.getItem('gpsPistasMapaBase') === '1' && navigator.onLine;
        control.addEventListener('change', event => {
            const activado = window.establecerMapaBase(Boolean(event.target.checked));
            if (!activado && event.target.checked) {
                event.target.checked = false;
                localStorage.setItem('gpsPistasMapaBase', '0');
            }
        });
        window.addEventListener('offline', () => { control.checked = false; });
    }

    document.addEventListener('DOMContentLoaded', conectarControlMapaBase);

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js').catch(error => {
                console.warn('No fue posible preparar el modo sin conexión:', error.message);
            });
        });
    }
})();
