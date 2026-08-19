// =======================================================
// mapIconos.js - Íconos Vectoriales Puros (Cero peticiones HTTP)
// =======================================================

// SVG para tu ubicación, construido como dos piezas independientes:
// - usuario-rumbo: cono y punta que sí giran;
// - usuario-punto: posición GPS que permanece centrada.
// main.js sólo transforma usuario-rumbo, igual que el marcador de Google Maps.
const svgMiUbicacion = `
<svg class="usuario-svg" width="64" height="64" viewBox="-32 -32 64 64" xmlns="http://www.w3.org/2000/svg" overflow="visible" aria-hidden="true">
  <defs>
    <linearGradient id="usuarioConoGradiente" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2563eb" stop-opacity="0.36"/>
      <stop offset="1" stop-color="#60a5fa" stop-opacity="0.08"/>
    </linearGradient>
  </defs>
  <g class="usuario-rumbo">
    <path class="usuario-cono" d="M 0 -31 L -22 16 A 29 29 0 0 0 22 16 Z" fill="url(#usuarioConoGradiente)"/>
    <path class="usuario-punta" d="M -5 -11 L 0 -19 L 5 -11 Z" fill="#2563eb"/>
  </g>
  <g class="usuario-punto">
    <circle cx="0" cy="1" r="14" fill="rgba(15,23,42,0.18)"/>
    <circle cx="0" cy="0" r="13" fill="#ffffff"/>
    <circle cx="0" cy="0" r="9.5" fill="#2563eb"/>
    <circle cx="-3" cy="-3" r="2.2" fill="rgba(255,255,255,0.55)"/>
  </g>
</svg>`;

// SVG para el destino (Pin rojo)
const svgDestino = `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#dc3545" stroke="#ffffff" stroke-width="2">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
</svg>`;

// SVG para el destino temporal (Pin naranja)
const svgDestinoTemporal = `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#fd7e14" stroke="#ffffff" stroke-width="2">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
</svg>`;

window.iconos = {
    miUbicacion: L.divIcon({
        className: 'icono-vectorial gps-marcador marcador-usuario-direccion',
        html: svgMiUbicacion,
        iconSize: [64, 64],
        iconAnchor: [32, 32]  // El punto GPS coincide con el centro del círculo azul
    }),
    destinoTemporal: L.divIcon({
        className: 'icono-vectorial',
        html: svgDestinoTemporal,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36]
    }),
    destino: L.divIcon({
        className: 'icono-vectorial',
        html: svgDestino,
        iconSize: [36, 36],
        iconAnchor: [18, 36],  // La punta del pin toca el suelo
        popupAnchor: [0, -36]
    })
};
