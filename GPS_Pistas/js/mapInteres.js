const archivosInteres = [
    '/resources/zonas_interes.geojson',
    '/resources/Terminal1.geojson',
    '/resources/Terminal2.geojson'
];

window.zonaPermitidaTemporal = null; 

Promise.all(
    archivosInteres.map(url => fetch(url).then(r => r.json()).then(data => ({ url, data })).catch(err => {
        console.warn(`No se pudo cargar ${url}`, err);
        return { url, data: null }; 
    }))
).then(resultados => {
    const capaDestino = (window.capas && window.capas.interes) ? window.capas.interes : window.map;

    resultados.forEach(({ url, data }) => {
        if (!data) return; 
        const esTerminal = url.includes('Terminal');
        const colorEstructura = esTerminal ? "#dc3545" : "#0d6efd";

        L.geoJSON(data, {
            style: { 
                color: colorEstructura, 
                weight: 2, 
                fillColor: colorEstructura, 
                fillOpacity: 0.75
            },
            onEachFeature: function(feature, layer) {
                const nombreLugar = feature.properties.nombre || feature.properties.name || '';

                window.poligonosInteresBloqueo = window.poligonosInteresBloqueo || [];
                feature.properties = feature.properties || {};
                feature.properties.bbox = turf.bbox(feature); 
                window.poligonosInteresBloqueo.push(feature);

                if (nombreLugar) {
                    const bounds = layer.getBounds();
                    const centro = bounds.getCenter();

                    const marcador = L.marker(centro, {
                        icon: L.divIcon({ className: 'etiqueta-pista tipo-edificio', html: nombreLugar, iconSize: [0,0] }),
                        interactive: false,
                        keyboard: false
                    }).addTo(capaDestino);

                    window._etiquetasEdificios = window._etiquetasEdificios || [];
                    const entrada = { nombre: nombreLugar, bounds, marcador };
                    window._etiquetasEdificios.push(entrada);

                    if (typeof window.actualizarTamanoEtiqueta === 'function') {
                        window.actualizarTamanoEtiqueta(entrada);
                    } else {
                        const sw = window.map.latLngToLayerPoint(bounds.getSouthWest());
                        const ne = window.map.latLngToLayerPoint(bounds.getNorthEast());
                        const ancho = Math.max(30, Math.abs(ne.x - sw.x));
                        const alto  = Math.max(14, Math.abs(ne.y - sw.y));
                        const area = ancho * alto;
                        const fontSize = Math.min(13, Math.max(8, Math.sqrt(area) * 0.13));
                        marcador.setIcon(L.divIcon({
                            className: 'etiqueta-pista tipo-edificio',
                            html: `<span style="font-size:${fontSize}px">${nombreLugar}</span>`,
                            iconSize:   [ancho * 0.9,  alto * 0.6],
                            iconAnchor: [ancho * 0.45, alto * 0.3]
                        }));
                    }

                    window.directorioLugares = window.directorioLugares || [];
                    const yaExiste = window.directorioLugares.some(l => l.nombre === nombreLugar);
                    if (!yaExiste) window.directorioLugares.push({ nombre: nombreLugar, centro, feature });
                }

                layer.on('click', function(e) {
                    L.DomEvent.stopPropagation(e); 
                    const centro = layer.getBounds().getCenter();
                    window.zonaPermitidaTemporal = feature;
                    if (window.irHacia) window.irHacia(centro.lat, centro.lng, nombreLugar || 'Edificio-Hangar-Estructura');
                });
            }
        }).addTo(capaDestino);
    });

    if (window.map) {
        window.map.on('click', () => window.zonaPermitidaTemporal = null);
    }
    console.log(`${archivosInteres.length} categorías de estructuras cargadas.`);
}).catch(err => console.error("Error crítico cargando edificios de interés:", err));