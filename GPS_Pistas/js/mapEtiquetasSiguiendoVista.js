// =======================================================
// mapEtiquetasSiguiendoVista.js - Etiquetas únicas que "siguen"
// la porción visible de una línea (rodaje, vialidad, etc.)
// =======================================================
//
// En vez de repetir el nombre cada N metros a lo largo de la línea,
// se mantiene UNA sola etiqueta por vía nombrada, y en cada movimiento
// del mapa se recalcula su posición para que quede centrada en la
// porción de esa línea que esté actualmente visible en pantalla.
//
// Si la vía completa sale de la vista, la etiqueta se oculta. En cuanto
// vuelve a aparecer (aunque sea parcialmente), la etiqueta reaparece
// centrada en la parte visible. Si la vía viene partida en varios
// segmentos de GeoJSON con el mismo nombre, se agrupan bajo UNA sola
// etiqueta (nunca aparecen duplicados).

window._etiquetasSiguiendoVista = window._etiquetasSiguiendoVista || [];

// -------------------------------------------------------
// Registro: agrupa segmentos por nombre + capa destino.
// Si ya existe una entrada con ese nombre, solo se le agregan los
// segmentos nuevos (no se crea un segundo marcador).
// -------------------------------------------------------
function registrarEtiquetaSiguiendoVista(nombre, segmentos, capaDestino, html, claseIcono, colorTexto) {
    if (!nombre || !segmentos || segmentos.length === 0) return;

    let entrada = window._etiquetasSiguiendoVista.find(e => e.nombre === nombre && e.capa === capaDestino);
    if (entrada) {
        entrada.segmentos.push(...segmentos);
        return;
    }

    const marcador = L.marker([0, 0], {
        icon: L.divIcon({
            className: claseIcono || 'etiqueta-siguiendo-vista',
            html: `<div class="etiqueta-texto-plano etiqueta-centrada" style="${colorTexto ? `color:${colorTexto};font-weight:800;` : ''}">${html}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        }),
        interactive: false
    });

    window._etiquetasSiguiendoVista.push({
        nombre,
        segmentos: [...segmentos],
        capa: capaDestino,
        marcador,
        visible: false
    });
}

// -------------------------------------------------------
// Recalcula la posición (o la oculta) de cada etiqueta registrada,
// según la porción de sus segmentos que esté dentro del viewport actual.
// -------------------------------------------------------
function actualizarEtiquetasSiguiendoVista() {
    if (!window.map) return;

    const bounds = window.map.getBounds();
    const bboxMapa = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];

    for (let entrada of window._etiquetasSiguiendoVista) {
        let mejorSubLinea = null;
        let mejorLongitud = 0;

        for (let segmento of entrada.segmentos) {
            let clip;
            try {
                clip = turf.bboxClip(segmento, bboxMapa);
            } catch (e) {
                continue; // geometría degenerada (p. ej. un solo punto); se ignora
            }
            if (!clip || !clip.geometry || !clip.geometry.coordinates || clip.geometry.coordinates.length === 0) continue;

            // El recorte puede devolver LineString o MultiLineString
            // (si la vía entra y sale del viewport varias veces).
            const partes = clip.geometry.type === 'MultiLineString'
                ? clip.geometry.coordinates
                : [clip.geometry.coordinates];

            for (let coords of partes) {
                if (coords.length < 2) continue;
                const subLinea = turf.lineString(coords);
                const longitud = turf.length(subLinea, { units: 'meters' });
                if (longitud > mejorLongitud) {
                    mejorLongitud = longitud;
                    mejorSubLinea = subLinea;
                }
            }
        }

        if (mejorSubLinea && mejorLongitud > 0) {
            const centro = turf.along(mejorSubLinea, mejorLongitud / 2, { units: 'meters' });
            const [lng, lat] = centro.geometry.coordinates;
            entrada.marcador.setLatLng([lat, lng]);
            if (!entrada.visible) {
                entrada.capa.addLayer(entrada.marcador);
                entrada.visible = true;
            }
        } else if (entrada.visible) {
            entrada.capa.removeLayer(entrada.marcador);
            entrada.visible = false;
        }
    }
}

// Recalcular en cada movimiento, zoom o rotación del mapa
document.addEventListener('DOMContentLoaded', () => {
    if (window.map) {
        window.map.on('moveend zoomend rotateend', actualizarEtiquetasSiguiendoVista);
    }
});