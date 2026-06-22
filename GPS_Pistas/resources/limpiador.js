const fs = require('fs');
const turf = require('@turf/turf');

// ============================================================================
// 1. CARGA DE ARCHIVOS GEOJSON
// ============================================================================

// Cargar la red de caminos exportada de OSM (la que tiene exceso de líneas)
console.log("Cargando archivos...");
const rawCaminos = fs.readFileSync('./lineas_sucias.geojson');
const lineas = JSON.parse(rawCaminos);

// Cargar tu archivo del perímetro del aeropuerto
const rawArea = fs.readFileSync('./zona_principal.geojson'); // <-- Pon el nombre de tu archivo aquí
const geojsonArea = JSON.parse(rawArea);

// Extraer el polígono (Soporta si es un FeatureCollection o un Polígono directo)
const zonaAeropuerto = geojsonArea.features ? geojsonArea.features[0] : geojsonArea;

// ============================================================================
// 2. CONFIGURACIÓN
// ============================================================================
let lineasLimpias = [];
let puentesNuevos = [];

// Turf.js mide las distancias en Kilómetros por defecto. 0.015 km = 15 metros.
const TOLERANCIA_KM = 0.015; 

// ============================================================================
// 3. RECORTAR LÍNEAS USANDO EL POLÍGONO EXACTO
// ============================================================================
console.log("Filtrando caminos fuera del perímetro...");

turf.featureEach(lineas, function (currentFeature) {
    // Tomamos el primer punto de cada camino
    const pt = turf.point(currentFeature.geometry.coordinates[0]);
    
    // Si el punto cae exactamente dentro del polígono de tu barda perimetral, se queda
    if (turf.booleanPointInPolygon(pt, zonaAeropuerto)) {
        lineasLimpias.push(currentFeature);
    }
});

console.log(`Líneas conservadas dentro del aeropuerto: ${lineasLimpias.length}`);

// ============================================================================
// 4. AUTOCOMPLETAR Y UNIR LÍNEAS ROTAS (SNAPPING)
// ============================================================================
console.log("Buscando caminos aislados para crear puentes...");

for (let i = 0; i < lineasLimpias.length; i++) {
    const lineaActual = lineasLimpias[i];
    const coords = lineaActual.geometry.coordinates;
    const puntaFinal = turf.point(coords[coords.length - 1]);

    let lineaMasCercana = null;
    let distanciaMinima = TOLERANCIA_KM;
    let puntoCercano = null;

    for (let j = 0; j < lineasLimpias.length; j++) {
        if (i === j) continue; // No compararse consigo misma
        
        const candidato = lineasLimpias[j];
        
        // Buscar el punto más cercano en la otra línea
        const snap = turf.nearestPointOnLine(candidato, puntaFinal);
        const distancia = turf.distance(puntaFinal, snap); // Distancia en kilómetros

        // Si la distancia es menor a la tolerancia y mayor a 0 (para no unir lo que ya está unido)
        if (distancia < distanciaMinima && distancia > 0.0001) {
            distanciaMinima = distancia;
            lineaMasCercana = candidato;
            puntoCercano = snap;
        }
    }

    // Si encontramos una línea vecina aislada, generamos un puente perfecto
    if (puntoCercano) {
        const puente = turf.lineString([
            puntaFinal.geometry.coordinates,
            puntoCercano.geometry.coordinates
        ]);
        puentesNuevos.push(puente);
    }
}

// ============================================================================
// 5. EXPORTAR EL RESULTADO FINAL
// ============================================================================
const redCompletada = turf.featureCollection([...lineasLimpias, ...puentesNuevos]);
fs.writeFileSync('./red_vascular_optimizada.geojson', JSON.stringify(redCompletada));

console.log(`¡Proceso terminado exitosamente!`);
console.log(`Se crearon ${puentesNuevos.length} puentes automáticos.`);
console.log(`Archivo guardado como: red_vascular_optimizada.geojson`);