// =======================================================
// CARGA DE ETIQUETAS INDEPENDIENTES DESDE GEOJSON
// =======================================================

// Cambia la ruta por el nombre exacto de tu archivo
fetch('/resources/rodajes.geojson') 
    .then(r => r.json())
    .then(dataEtiquetas => {
        L.geoJSON(dataEtiquetas, {
            // pointToLayer se usa para transformar Puntos GeoJSON en algo personalizado
            pointToLayer: function(feature, latlng) {
                // Lee la propiedad 'nombre', 'name' o 'texto' de tu archivo
                const textoEtiqueta = feature.properties.nombre || feature.properties.name || feature.properties.texto || '';

                if (!textoEtiqueta) return null; // Si el punto no tiene texto, lo ignoramos

                // Retornamos un marcador invisible que SOLO contiene el texto
                return L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'etiqueta-pista', // Reutilizamos tu clase CSS sin fondo
                        html: textoEtiqueta,
                        iconSize: [0, 0], // Evita que Leaflet le ponga una caja invisible gigante
                        iconAnchor: [0, 0] // Puedes ajustar esto si quieres centrar el texto ej: [20, 10]
                    }),
                    interactive: false // CRÍTICO: Evita que el texto bloquee tus clics en el mapa
                });
            }
        }).addTo(window.map); // Lo añadimos directo al mapa
        console.log("Etiquetas independientes cargadas con éxito.");
    })
    .catch(err => console.warn("No se encontró archivo de etiquetas:", err));