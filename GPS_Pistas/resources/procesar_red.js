const fs = require('fs');

function procesarGeoJSON() {
    // 1. Cargar ambos archivos
    const redSinPista = JSON.parse(fs.readFileSync('red_sin_pista_lateral.geojson', 'utf8'));
    const redVascular = JSON.parse(fs.readFileSync('red_vascular_unida.geojson', 'utf8'));

    // 2. Crear un Set con las coordenadas (convertidas a string) de "red sin pista lateral"
    // Esto permite una búsqueda mucho más rápida (O(1)) al comparar.
    const coordenadasSinPista = new Set(
        redSinPista.features.map(f => JSON.stringify(f.geometry.coordinates))
    );

    // 3. Evaluar los features de "red vascular unida"
    const featuresProcesados = redVascular.features.map(feature => {
        // Clonar el feature para mantener inmutabilidad
        const nuevoFeature = { ...feature };
        nuevoFeature.properties = { ...feature.properties }; // Mantener propiedades existentes

        const stringCoords = JSON.stringify(feature.geometry.coordinates);

        // 4. Asignar el peso según su existencia en la otra red
        if (coordenadasSinPista.has(stringCoords)) {
            // Está en ambos archivos
            nuevoFeature.properties.peso = 1;
        } else {
            // Falta en "red sin pista lateral" pero está en "red vascular unida"
            nuevoFeature.properties.peso = 2;
        }

        return nuevoFeature;
    });

    // 5. Construir el nuevo FeatureCollection
    const redResultado = {
        type: "FeatureCollection",
        features: featuresProcesados
    };

    // 6. Guardar el archivo resultante
    fs.writeFileSync('red_final_con_pesos.geojson', JSON.stringify(redResultado, null, 2), 'utf8');
    console.log("Proceso terminado. Archivo 'red_final_con_pesos.geojson' generado con éxito.");
}

procesarGeoJSON();