// =======================================================
// mapProhibidos.js - Gestión Espacial, Puentes, Restricciones y Señales
// =======================================================
 
window.evitarPistasVuelo = true; 
window.geojsonDataPrincipalPermitida = null;
window.directorioLugares = window.directorioLugares || [];
window.poligonosInteresBloqueo = window.poligonosInteresBloqueo || [];
window.zonaPermitidaTemporal = window.zonaPermitidaTemporal || null;
window.zonaOrigenTemporal = null;
 
let poligonosProhibidos = [];
let poligonosPistas = [];
 
window._etiquetasEdificios = window._etiquetasEdificios || [];
 
// =======================================================
// FUNCIÓN PARA EVITAR ERRORES SI EL USUARIO ESTÁ DENTRO DE UNA ZONA
// =======================================================
window.desbloquearZonaOrigen = function(lat, lng) {
    window.zonaOrigenTemporal = null;
    const pt = turf.point([lng, lat]);
    for (let feat of poligonosProhibidos) {
        if (turf.booleanPointInPolygon(pt, feat)) { window.zonaOrigenTemporal = feat; return; }
    }
    for (let feat of window.poligonosInteresBloqueo) {
        if (turf.booleanPointInPolygon(pt, feat)) { window.zonaOrigenTemporal = feat; return; }
    }
};
 
// =======================================================
// 1. SISTEMA DE PUENTES
// =======================================================
const hashSize = 0.0005; 
const puentesHash = new Map();
 
function registrarPuentesDesdeGeoJSON(geojson) {
    turf.coordEach(geojson, function (currentCoord) {
        const lng = currentCoord[0];
        const lat = currentCoord[1];
        const key = `${Math.floor(lat / hashSize)},${Math.floor(lng / hashSize)}`;
        if (!puentesHash.has(key)) puentesHash.set(key, []);
        puentesHash.get(key).push({ lat, lng });
    });
    console.log("Puentes habilitados.");
}
 
window.esZonaPuente = function(lat, lng) {
    const key = `${Math.floor(lat / hashSize)},${Math.floor(lng / hashSize)}`;
    const vecinos = puentesHash.get(key);
    if (!vecinos) return false;
    const tolerancia = 0.0002; 
    for (let v of vecinos) {
        if (Math.abs(v.lat - lat) < tolerancia && Math.abs(v.lng - lng) < tolerancia) return true;
    }
    return false;
};
 
// =======================================================
// 2. OPTIMIZACIÓN DE BÚSQUEDA (Bounding Boxes)
// =======================================================
function preprocesarPoligono(feature) {
    feature.properties = feature.properties || {};
    feature.properties.bbox = turf.bbox(feature);
    return feature;
}
 
function puntoDentroDeBBox(ptCoord, bbox) {
    return ptCoord[0] >= bbox[0] && ptCoord[0] <= bbox[2] && 
           ptCoord[1] >= bbox[1] && ptCoord[1] <= bbox[3];
}
 
// =======================================================
// 3. MOTOR GLOBAL DE VALIDACIÓN ESPACIAL
// =======================================================
window.esUbicacionValida = function(lat, lng) {
    const pt = turf.point([lng, lat]);
    const ptCoord = [lng, lat];
 
    if (window.geojsonDataPrincipalPermitida) {
        let dentroPrincipal = false;
        if (puntoDentroDeBBox(ptCoord, window.geojsonDataPrincipalPermitida.properties.bbox)) {
            if (turf.booleanPointInPolygon(pt, window.geojsonDataPrincipalPermitida)) dentroPrincipal = true;
        }
        if (!dentroPrincipal) return false; 
    }
 
    for (let feat of poligonosProhibidos) {
        if (window.zonaPermitidaTemporal === feat || window.zonaOrigenTemporal === feat) continue;
        if (puntoDentroDeBBox(ptCoord, feat.properties.bbox)) {
            if (turf.booleanPointInPolygon(pt, feat)) return false; 
        }
    }
 
    for (let feat of window.poligonosInteresBloqueo) {
        if (window.zonaPermitidaTemporal === feat || window.zonaOrigenTemporal === feat) continue;
        if (puntoDentroDeBBox(ptCoord, feat.properties.bbox)) {
            if (turf.booleanPointInPolygon(pt, feat)) return false; 
        }
    }
 
    if (window.evitarPistasVuelo) {
        if (window.esZonaPuente(lat, lng)) return true;
        for (let feat of poligonosPistas) {
            if (puntoDentroDeBBox(ptCoord, feat.properties.bbox)) {
                if (turf.booleanPointInPolygon(pt, feat)) return false; 
            }
        }
    }
 
    return true; 
};
 
function actualizarTamanoEtiqueta(entrada) {
    const bounds = entrada.bounds;
    const marcador = entrada.marcador;
 
    const sw = window.map.latLngToLayerPoint(bounds.getSouthWest());
    const ne = window.map.latLngToLayerPoint(bounds.getNorthEast());
    const ancho = Math.max(30, Math.abs(ne.x - sw.x));
    const alto  = Math.max(14, Math.abs(ne.y - sw.y));
 
    const area = ancho * alto;
    const fontSize = Math.min(13, Math.max(8, Math.sqrt(area) * 0.13));
 
    const nuevoIcono = L.divIcon({
        className: 'tipo-edificio',
        html: `<div class="etiqueta-texto-plano etiqueta-centrada" style="font-size:${fontSize}px">${entrada.nombre}</div>`,
        iconSize:   [0, 0],
        iconAnchor: [0, 0]
    });
 
    marcador.setIcon(nuevoIcono);
}
 
function recalcularTodasLasEtiquetas() {
    for (let entrada of window._etiquetasEdificios) {
        actualizarTamanoEtiqueta(entrada);
    }
}
 
function crearEtiquetaEdificio(nombre, layer, capaDestino) {
    const bounds = layer.getBounds();
    const centro = bounds.getCenter();
 
    const marcador = L.marker(centro, {
        icon: L.divIcon({ 
            className: 'tipo-edificio', 
            html: `<div class="etiqueta-texto-plano etiqueta-centrada">${nombre}</div>`, 
            iconSize: [0,0],
            iconAnchor: [0,0]
        }),
        interactive: false,
        keyboard: false
    }).addTo(capaDestino);
 
    const entrada = { nombre, bounds, marcador };
    window._etiquetasEdificios.push(entrada);
    actualizarTamanoEtiqueta(entrada);
 
    return marcador;
}
 
window.map.on('zoomend', recalcularTodasLasEtiquetas);
 
// =======================================================
// 4. CARGA DE ARCHIVOS GEOJSON Y RENDERIZADO VISUAL
// =======================================================
Promise.all([
    fetch('/resources/zona_principal.geojson').then(r => r.json()).catch(() => null),
    fetch('/resources/zonas_prohibidas.geojson').then(r => r.json()).catch(() => null),
    fetch('/resources/pistas.geojson').then(r => r.json()).catch(() => null),
    fetch('/resources/señalizaciones.geojson').then(r => r.json()).catch(() => null) // [NUEVO]
]).then(([dataPrincipal, dataProhibidas, dataPistas, dataSenalizaciones]) => {
 
    const capaParaZonas = (window.capas && window.capas.zonas) ? window.capas.zonas : window.map;
 
    if (dataPrincipal) {
        window.geojsonDataPrincipalPermitida = dataPrincipal.features ? dataPrincipal.features[0] : dataPrincipal;
        window.geojsonDataPrincipalPermitida = preprocesarPoligono(window.geojsonDataPrincipalPermitida);
        L.geoJSON(dataPrincipal, {
            style: { color: "#9b9b9b", weight: 2, fillOpacity: 0.05, dashArray: "5, 5" },
            interactive: false
        }).addTo(window.map); 
    }
 
    if (dataProhibidas) {
        L.geoJSON(dataProhibidas, {
            style: { color: "#28a745", weight: 1, fillColor: "#8d8b55", fillOpacity: 0.5 },
            onEachFeature: function(feature, layer) {
                poligonosProhibidos.push(preprocesarPoligono(feature));

                // [CORRECCIÓN] Buscando todas las variantes posibles de nombre en GeoJSON
                const props = feature.properties;
                const nombreLugar = props.nombre || props.name || props.Name || props.NAME || '';
 
                if (nombreLugar) {
                    window.directorioLugares.push({
                        nombre: nombreLugar,
                        centro: layer.getBounds().getCenter(),
                        feature: feature
                    });
                    crearEtiquetaEdificio(nombreLugar, layer, capaParaZonas);
                }
 
                layer.on('click', function(e) {
                    L.DomEvent.stopPropagation(e); 
                    const centro = layer.getBounds().getCenter();
                    window.zonaPermitidaTemporal = feature;
                    if (window.irHacia) {
                        window.irHacia(centro.lat, centro.lng, nombreLugar || 'Área verde');
                    }
                });
            }
        }).addTo(capaParaZonas); 
    }
 
    if (dataPistas) {
        registrarPuentesDesdeGeoJSON(dataPistas);
        window.capaPistasVuelo = L.geoJSON(dataPistas, {
            style: { color: "#dc3545", weight: 2, fillColor: "#dc3545", fillOpacity: 0.2 },
            onEachFeature: function(feature, layer) {
                poligonosPistas.push(preprocesarPoligono(feature));
                const nombrePista = feature.properties.nombre || feature.properties.name;
                
                if (nombrePista) {
                    const centroGeom = layer.getBounds().getCenter();
                    const latPista = feature.properties.etiqueta_lat || feature.properties.lat || centroGeom.lat;
                    const lngPista = feature.properties.etiqueta_lng || feature.properties.lng || centroGeom.lng;

                    L.marker([latPista, lngPista], {
                        icon: L.divIcon({
                            className: 'tipo-pista',
                            html: `<div class="etiqueta-texto-plano etiqueta-centrada" style="font-size: 13px;">${nombrePista}</div>`,
                            iconSize: [0, 0],
                            iconAnchor: [0, 0]
                        }),
                        interactive: false 
                    }).addTo(capaParaZonas);
                }
            }
        }).addTo(capaParaZonas); 
    }

    // [NUEVO] CARGA DE SEÑALIZACIONES VISUALES
    if (dataSenalizaciones) {
        L.geoJSON(dataSenalizaciones, {
            pointToLayer: function (feature, latlng) {

                // [CORRECCIÓN] Buscando todas las variantes posibles de nombre en GeoJSON para Señales
                const props = feature.properties;
                const nombre = props.nombre || props.name || props.Name || props.NAME || '';
                const iconoClass = props.icono || 'bi-info-circle-fill';
                const colorFondo = props.color || '#ffc107';

                const htmlSenal = `
                    <div class="senalizacion-container">
                        <div class="senalizacion-icono" style="background-color: ${colorFondo};">
                            <i class="bi ${iconoClass}"></i>
                        </div>
                        <div class="senalizacion-texto">${nombre}</div>
                    </div>
                `;

                return L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'tipo-senalizacion',
                        html: htmlSenal,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    }),
                    interactive: false // Puramente visual, el clic las atraviesa
                });
            }
        }).addTo(capaParaZonas);
    }
 
    if (window.map) {
        window.map.on('click', function() {
            window.zonaPermitidaTemporal = null;
        });
    }
 
}).catch(err => console.error("Error cargando archivos GeoJSON:", err));