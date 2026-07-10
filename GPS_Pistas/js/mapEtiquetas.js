// =======================================================
// CARGA DE ETIQUETAS DE RODAJES (TAXIWAYS) DESDE GEOJSON
// =======================================================

const DISTANCIA_REPETICION_RODAJE_M = 150;
const LONGITUD_MINIMA_REPETICION_M = 200;

// [NUEVO] Lista global de vialidades/rodajes CON NOMBRE LARGO, usada por
// main.js para saber "por dónde vas" durante la navegación.
window.viasNombradas = window.viasNombradas || [];

fetch('/resources/mapa_conecado_completo.geojson')
    .then(r => r.json())
    .then(dataRodajes => {
        turf.featureEach(dataRodajes, function(feature) {
            if (!feature.geometry || feature.geometry.type !== 'LineString') return;

            const props = feature.properties || {};
            const textoEtiqueta = props.ref || '';       // Abreviado, para la etiqueta visual
            const nombreLargo = props.name || props.ref; // Largo, para la navegación

            // [NUEVO] Registramos el tramo con nombre para búsqueda por cercanía,
            // sin importar si tiene "ref" o no, siempre que tenga algún nombre.
            if (nombreLargo) {
                window.viasNombradas.push({
                    linea: feature,
                    nombre: nombreLargo
                });
            }

            if (!textoEtiqueta) return; // Sin ref, no se dibuja etiqueta visual

            const longitudM = turf.length(feature, { units: 'meters' });
            const puntosEtiqueta = [turf.along(feature, longitudM / 2, { units: 'meters' })];

            if (longitudM > LONGITUD_MINIMA_REPETICION_M) {
                let distanciaAcumulada = DISTANCIA_REPETICION_RODAJE_M / 2;
                while (distanciaAcumulada < longitudM) {
                    if (Math.abs(distanciaAcumulada - longitudM / 2) > DISTANCIA_REPETICION_RODAJE_M / 2) {
                        puntosEtiqueta.push(turf.along(feature, distanciaAcumulada, { units: 'meters' }));
                    }
                    distanciaAcumulada += DISTANCIA_REPETICION_RODAJE_M;
                }
            }

            puntosEtiqueta.forEach(punto => {
                const [lng, lat] = punto.geometry.coordinates;
                L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: 'etiqueta-pista',
                        html: textoEtiqueta,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    }),
                    interactive: false
                }).addTo(window.map);
            });
        });
        console.log(`Etiquetas de rodajes cargadas. ${window.viasNombradas.length} vías registradas para navegación.`);
    })
    .catch(err => console.warn("No se encontró archivo de rodajes:", err));