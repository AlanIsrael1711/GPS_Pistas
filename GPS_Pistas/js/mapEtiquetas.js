// =======================================================
// CARGA DE ETIQUETAS DE RODAJES (TAXIWAYS) DESDE GEOJSON
// =======================================================

window.viasNombradas = window.viasNombradas || [];
window.directorioLugares = window.directorioLugares || [];

fetch('/resources/vialidades_final_completo.geojson')
    .then(r => r.json())
    .then(dataRodajes => {
        turf.featureEach(dataRodajes, function(feature) {
            if (!feature.geometry || feature.geometry.type !== 'LineString') return;

            const props = feature.properties || {};
            
            // [MODIFICADO] Toma 'ref' para visualizar (abreviado), si no existe usa 'name'
            const textoEtiqueta = props.ref || props.name || '';       
            // [MODIFICADO] El nombre largo siempre prioriza 'name' para el buscador interno
            const nombreLargo = props.name || props.ref || ''; 

            if (nombreLargo) {
                window.viasNombradas.push({ linea: feature, nombre: nombreLargo });
            }

            if (nombreLargo) {
                const yaExiste = window.directorioLugares.some(l => l.nombre === nombreLargo);
                if (!yaExiste) {
                    const centroPunto = turf.along(feature, turf.length(feature, { units: 'meters' }) / 2, { units: 'meters' });
                    const [lng, lat] = centroPunto.geometry.coordinates;
                    window.directorioLugares.push({
                        nombre: nombreLargo,
                        alias: props.ref || null, 
                        centro: { lat, lng },
                        feature: feature
                    });
                }
            }

            if (!textoEtiqueta) return; 

            // Se registra la etiqueta agrupando los segmentos por su nombre real, 
            // pero imprimiendo en pantalla la variable textoEtiqueta (el 'ref' abreviado).
            registrarEtiquetaSiguiendoVista(nombreLargo, [feature], window.map, textoEtiqueta, 'etiqueta-pista');
            
            // NOTA: Se eliminó todo el bloque de "longitudM" y el bucle "while" que causaba un error crítico (crash) en la aplicación.
        });
        
        actualizarEtiquetasSiguiendoVista(); 
        console.log(`Etiquetas de rodajes cargadas. ${window.viasNombradas.length} vías registradas para navegación.`);
    })
    .catch(err => console.warn("No se encontró archivo de rodajes:", err));