// Modelo común de orientación para el usuario, las aeronaves y la brújula.
// Mantiene separados el rumbo real (mundo) y el bearing de la cámara (mapa).
(function crearModeloOrientacion(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GPSOrientationModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function orientationFactory() {
    'use strict';

    function normalizarAngulo(angulo) {
        const numero = Number(angulo);
        if (!Number.isFinite(numero)) return null;
        return ((numero % 360) + 360) % 360;
    }

    function diferenciaCircular(destino, actual) {
        const destinoNormalizado = normalizarAngulo(destino);
        const actualNormalizado = normalizarAngulo(actual);
        if (destinoNormalizado === null || actualNormalizado === null) return 0;

        let diferencia = destinoNormalizado - actualNormalizado;
        if (diferencia > 180) diferencia -= 360;
        if (diferencia < -180) diferencia += 360;
        return diferencia;
    }

    // Dirección que debe verse en la pantalla. Si el mapa gira a la derecha,
    // un rumbo real que no cambió debe verse girar a la izquierda.
    function rumboEnPantalla(rumboMundo, bearingMapa) {
        const rumbo = normalizarAngulo(rumboMundo);
        const bearing = normalizarAngulo(bearingMapa);
        if (rumbo === null) return null;
        return normalizarAngulo(rumbo - (bearing === null ? 0 : bearing));
    }

    function suavizarCircular(actual, destino, factor) {
        const destinoNormalizado = normalizarAngulo(destino);
        if (destinoNormalizado === null) return normalizarAngulo(actual);

        const actualNormalizado = normalizarAngulo(actual);
        if (actualNormalizado === null) return destinoNormalizado;

        const alpha = Math.min(1, Math.max(0, Number(factor) || 0));
        return normalizarAngulo(
            actualNormalizado + diferenciaCircular(destinoNormalizado, actualNormalizado) * alpha
        );
    }

    // Convierte los ángulos Euler del Device Orientation API en el rumbo de la
    // parte superior de la pantalla, incluso con el teléfono inclinado.
    function rumboDesdeEuler(alpha, beta, gamma, anguloPantalla = 0) {
        const aNumero = Number(alpha);
        const bNumero = Number(beta);
        const gNumero = Number(gamma);
        if (![aNumero, bNumero, gNumero].every(Number.isFinite)) return null;

        const a = aNumero * Math.PI / 180;
        const b = bNumero * Math.PI / 180;
        const g = gNumero * Math.PI / 180;
        const vx = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
        const vy = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);

        const rumboBase = Math.abs(vx) + Math.abs(vy) < 0.000001
            ? 360 - aNumero
            : Math.atan2(vx, vy) * 180 / Math.PI;

        return normalizarAngulo(rumboBase + (Number(anguloPantalla) || 0));
    }

    function rumboDesdeEvento(event, anguloPantalla = 0) {
        if (!event) return null;

        const rumboIOS = Number(event.webkitCompassHeading);
        if (event.webkitCompassHeading !== null &&
            event.webkitCompassHeading !== undefined &&
            Number.isFinite(rumboIOS)) {
            return normalizarAngulo(rumboIOS);
        }

        if (event.alpha === null || event.alpha === undefined) return null;
        const alpha = Number(event.alpha);
        const beta = event.beta === null || event.beta === undefined ? 0 : Number(event.beta);
        const gamma = event.gamma === null || event.gamma === undefined ? 0 : Number(event.gamma);
        return rumboDesdeEuler(alpha, beta, gamma, anguloPantalla);
    }

    return {
        normalizarAngulo,
        diferenciaCircular,
        rumboEnPantalla,
        suavizarCircular,
        rumboDesdeEuler,
        rumboDesdeEvento
    };
});
