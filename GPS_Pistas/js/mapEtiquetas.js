// =======================================================
// CARGA DE ETIQUETAS INDEPENDIENTES DESDE GEOJSON
// =======================================================

fetch('/resources/rodajes.geojson') 
    .then(r => r.json())
    .then(dataEtiquetas => {
        L.geoJSON(dataEtiquetas, {
            pointToLayer: function(feature, latlng) {
                const textoEtiqueta = feature.properties.nombre || feature.properties.name || feature.properties.texto || '';
                if (!textoEtiqueta) return null;

                return L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'etiqueta-pista',
                        html: textoEtiqueta,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    }),
                    interactive: false
                });
            }
        }).addTo(window.map);
        console.log("Etiquetas independientes cargadas con éxito.");
    })
    .catch(err => console.warn("No se encontró archivo de etiquetas de rodaje:", err));