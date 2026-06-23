// =======================================================
// mapSenalizaciones.js - Señalizaciones del aeropuerto
// Carga puntos desde senalizaciones.geojson y los dibuja
// como marcadores con icono de color + texto.
// La clase CSS 'tipo-senalizacion' los conecta al filtro
// "Ver Señalizaciones" del panel de control.
// =======================================================

document.addEventListener('DOMContentLoaded', () => {

    fetch('/resources/señalizaciones.geojson')
        .then(r => r.json())
        .then(data => {
            L.geoJSON(data, {
                pointToLayer: function(feature, latlng) {
                    const props  = feature.properties || {};
                    const texto  = props.nombre || props.name || props.texto || '';
                    const color  = props.color  || '#e67e22';   // naranja por defecto
                    const icono  = props.icono  || 'i';         // letra si no hay símbolo

                    const html = `
                        <div class="senalizacion-container tipo-senalizacion">
                            <div class="senalizacion-icono" style="background-color:${color};">
                                ${icono}
                            </div>
                            ${texto ? `<span class="senalizacion-texto">${texto}</span>` : ''}
                        </div>`;

                    return L.marker(latlng, {
                        icon: L.divIcon({
                            className: 'tipo-senalizacion',
                            html: html,
                            iconSize:   [20, texto ? 36 : 20],
                            iconAnchor: [10, texto ? 36 : 10]
                        }),
                        interactive: false
                    });
                }
            }).addTo(window.map);

            console.log('Señalizaciones cargadas.');
        })
        .catch(err => console.warn('senalizaciones.geojson no encontrado, omitiendo capa.', err));

});