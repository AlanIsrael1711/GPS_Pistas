// =======================================================
// mapProhibidos.js - Carga de Áreas Verdes / Zonas Prohibidas
// =======================================================

window.actualizarTamanoEtiqueta = function(entrada) {
    if (!window.map || !entrada.bounds || !entrada.marcador) return;
    const sw = window.map.latLngToLayerPoint(entrada.bounds.getSouthWest());
    const ne = window.map.latLngToLayerPoint(entrada.bounds.getNorthEast());
    const ancho = Math.max(30, Math.abs(ne.x - sw.x));
    const alto  = Math.max(14, Math.abs(ne.y - sw.y));
    const area = ancho * alto;
    const fontSize = Math.min(13, Math.max(8, Math.sqrt(area) * 0.13));
    
    entrada.marcador.setIcon(L.divIcon({
        className: 'etiqueta-pista tipo-edificio',
        html: `<span style="font-size:${fontSize}px">${entrada.nombre}</span>`,
        iconSize:   [ancho * 0.9,  alto * 0.6],
        iconAnchor: [ancho * 0.45, alto * 0.3]
    }));
};

document.addEventListener('DOMContentLoaded', () => {
    // Inicializamos la capa de zonas prohibidas en el objeto global de capas
    window.capas = window.capas || {};
    window.capas.prohibidos = window.capas.prohibidos || L.layerGroup().addTo(window.map);

    fetch('/resources/zonas_prohibidas.geojson')
        .then(r => r.json())
        .then(data => {
            L.geoJSON(data, {
                style: { 
                    color: "#28a745", 
                    weight: 2, 
                    fillColor: "#28a745", 
                    fillOpacity: 0.35 
                },
                interactive: false
            }).addTo(window.capas.prohibidos);
            console.log("Zonas prohibidas (áreas verdes) aplicadas correctamente.");
        })
        .catch(err => console.warn("Archivo zonas_prohibidas.geojson no encontrado, omitiendo capa.", err));
});