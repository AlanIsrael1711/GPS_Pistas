// =======================================================
// mapIconos.js - Íconos Vectoriales Puros (Cero peticiones HTTP)
// =======================================================

// SVG para tu ubicación: cono de visión frontal + círculo con punta direccional.
// El cono semitransparente indica el campo visual hacia adelante.
// El triángulo en la parte superior del círculo marca el frente exacto.
// actualizarRotacionIcono() en main.js rota el SVG según el giroscopio.
const svgMiUbicacion = `
<svg width="35" height="35" viewBox="-24 -24 48 48" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
  <path d="M 0 -20 L -20 16 A 24 24 0 0 0 20 16 Z" fill="rgba(37,99,235,0.22)"/>
  <circle cx="0" cy="0" r="13" fill="white" stroke="#2563eb" stroke-width="2"/>
  <circle cx="0" cy="0" r="10" fill="#2563eb"/>
  <path d="M -5 -9 L 0 -16 L 5 -9 Z" fill="#2563eb"/>
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
        className: 'icono-vectorial marcador-usuario-direccion',
        html: svgMiUbicacion,
        iconSize: [48, 48],
        iconAnchor: [24, 24]  // Centro exacto: el punto GPS cae en el centro del círculo
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