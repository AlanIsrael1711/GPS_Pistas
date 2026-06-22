// =======================================================
// mapIconos.js - Íconos Vectoriales Puros (Cero peticiones HTTP)
// =======================================================

// SVG para tu ubicación (Círculo azul con pulso)
const svgMiUbicacion = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="40" fill="#0d6efd" opacity="0.3" />
  <circle cx="50" cy="50" r="25" fill="#0d6efd" stroke="#ffffff" stroke-width="5" />
</svg>`;

// SVG para el destino (Pin rojo)
const svgDestino = `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#dc3545" stroke="#ffffff" stroke-width="2">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
</svg>`;

// Agrega este SVG arriba junto a los otros
const svgDestinoTemporal = `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#fd7e14" stroke="#ffffff" stroke-width="2">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
</svg>`;

window.iconos = {
    miUbicacion: L.divIcon({
        className: 'icono-vectorial',
        html: svgMiUbicacion,
        iconSize: [30, 30],
        iconAnchor: [15, 15] // Centrado perfecto
    }),
    destinoTemporal: L.divIcon({
      className: 'icono-vectorial',
      html: svgDestinoTemporal,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36]
  })
    ,
    destino: L.divIcon({
        className: 'icono-vectorial',
        html: svgDestino,
        iconSize: [36, 36],
        iconAnchor: [18, 36], // La punta del pin toca el suelo
        popupAnchor: [0, -36]
    })
};

