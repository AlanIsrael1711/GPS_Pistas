// =======================================================
// CARGA DE ETIQUETAS DE RODAJES (TAXIWAYS) DESDE GEOJSON
// =======================================================

const DISTANCIA_REPETICION_RODAJE_M = 450;
const LONGITUD_MINIMA_REPETICION_M = 400;

window.viasNombradas = window.viasNombradas || [];
window.directorioLugares = window.directorioLugares || []; // [NUEVO] por si este archivo carga antes que los demás

fetch('/resources/vialidades_final_completo.geojson')
    .then(r => r.json())
    .then(dataRodajes => {
        turf.featureEach(dataRodajes, function(feature) {
            if (!feature.geometry || feature.geometry.type !== 'LineString') return;

            const props = feature.properties || {};
            const textoEtiqueta = props.ref || '';       // Abreviado: para la etiqueta visual en el mapa
            const nombreLargo = props.name || props.ref; // Largo: para navegación y para mostrar en el buscador

            if (nombreLargo) {
                window.viasNombradas.push({ linea: feature, nombre: nombreLargo });
            }

            // [NUEVO] Registro en el buscador: se puede encontrar tecleando el
            // nombre completo ("Bravo 7") O el abreviado ("B7"). Evitamos
            // duplicados cuando el mismo rodaje viene partido en varios
            // segmentos de GeoJSON (comparamos por nombre completo).
            if (nombreLargo) {
                const yaExiste = window.directorioLugares.some(l => l.nombre === nombreLargo);
                if (!yaExiste) {
                    const centroPunto = turf.along(feature, turf.length(feature, { units: 'meters' }) / 2, { units: 'meters' });
                    const [lng, lat] = centroPunto.geometry.coordinates;
                    window.directorioLugares.push({
                        nombre: nombreLargo,
                        alias: props.ref || null, // Búsqueda también por el nombre corto
                        centro: { lat, lng },
                        feature: feature
                    });
                }
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