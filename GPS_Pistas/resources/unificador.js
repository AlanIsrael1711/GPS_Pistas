const fs = require('fs');
const turf = require('@turf/turf');

// 1. Cargamos tu red actual (la que se queda atascada)
const archivoOriginal = './red_vascular_optimizada.geojson';
console.log("Cargando red actual...");
const rawData = fs.readFileSync(archivoOriginal);
const geojson = JSON.parse(rawData);

// Extraer solo las líneas válidas
let lineas = [];
turf.featureEach(geojson, f => {
    if (f.geometry.type === 'LineString') lineas.push(f);
});

console.log(`Analizando ${lineas.length} caminos en busca de puntas rotas...`);

let puentesNuevos = [];

// 2. Buscar callejones sin salida y conectarlos
for (let i = 0; i < lineas.length; i++) {
    let linea = lineas[i];
    let coords = linea.geometry.coordinates;
    
    // Extraemos las dos puntas de la línea
    let pInicio = turf.point(coords[0]);
    let pFin = turf.point(coords[coords.length - 1]);

    // Función para ver si la punta ya está tocando otra línea a menos de 1 metro
    function tocaOtraLinea(punto, indexIgnorar) {
        for (let j = 0; j < lineas.length; j++) {
            if (j === indexIgnorar) continue;
            let snap = turf.nearestPointOnLine(lineas[j], punto);
            if (snap.properties.dist <= 0.001) return true; // 0.001 km = 1 metro
        }
        return false;
    }

    let puntasSueltas = [];
    if (!tocaOtraLinea(pInicio, i)) puntasSueltas.push(pInicio);
    if (!tocaOtraLinea(pFin, i)) puntasSueltas.push(pFin);

    // 3. Por cada punta suelta, buscamos la calle más cercana y la unimos
    puntasSueltas.forEach(punta => {
        let minDist = Infinity;
        let mejorSnap = null;

        for (let j = 0; j < lineas.length; j++) {
            if (i === j) continue;
            let snap = turf.nearestPointOnLine(lineas[j], punta);
            if (snap.properties.dist < minDist) {
                minDist = snap.properties.dist;
                mejorSnap = snap;
            }
        }

        // Si hay otra calle a menos de 150 metros (0.150 km), creamos el puente
        if (mejorSnap && minDist < 0.150) { 
            let puente = turf.lineString([punta.geometry.coordinates, mejorSnap.geometry.coordinates]);
            puentesNuevos.push(puente);
        }
    });
}

// 4. Juntamos la red original con los nuevos puentes
const redFinal = turf.featureCollection([...lineas, ...puentesNuevos]);
fs.writeFileSync('./red_vascular_unida.geojson', JSON.stringify(redFinal));

console.log(`¡Éxito! Se soldaron ${puentesNuevos.length} callejones sin salida a la red principal.`);
console.log(`Archivo guardado como: red_vascular_unida.geojson`);