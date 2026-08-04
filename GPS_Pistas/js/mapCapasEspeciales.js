// =======================================================
// mapCapasEspeciales.js - Zonas de Peligro, Vialidades Destacadas,
// Plataformas y Posiciones (con filtros independientes)
// =======================================================

// -------------------------------------------------------
// 0. PANES PERSONALIZADOS (garantizan el orden de apilamiento
//    SIN importar en qué orden se cargan o se activan los filtros)
// -------------------------------------------------------
// [CORRECCIÓN CRÍTICA] El plugin leaflet-rotate reorganiza los panes al
// iniciar el mapa: mueve tilePane/overlayPane/shadowPane/markerPane dentro
// de un contenedor especial que SÍ recibe la transformación de pan+rotación,
// y deja tooltipPane/popupPane en un contenedor aparte que nunca rota.
//
// Si creamos un pane nuevo con map.createPane('nombre') a secas, Leaflet lo
// cuelga directamente del contenedor raíz del mapa, FUERA de ese grupo
// sincronizado. Resultado: durante el zoom se ve bien (Leaflet recalcula
// posiciones absolutas en ese instante), pero en cuanto el mapa se detiene
// el pane queda desfasado de la transformación real y el contenido
// "desaparece" (se dibuja fuera de posición).
//
// La solución es crear los panes nuevos como HERMANOS directos de
// 'overlayPane' (que sabemos que sí está bien sincronizado, porque tus
// zonas prohibidas originales lo usan y siempre se ven bien). Así heredan
// automáticamente la misma transformación en todo momento, sin excepción.
const contenedorPanesRotables = window.map.getPane('overlayPane').parentNode;

function crearPaneSincronizado(nombre, zIndex) {
    const pane = window.map.createPane(nombre, contenedorPanesRotables);
    pane.style.zIndex = zIndex;
    return pane;
}

// Orden de abajo hacia arriba: zonas de peligro -> plataformas -> posiciones -> vialidades destacadas
// Las etiquetas (divIcon markers) siempre van en el markerPane por defecto (z=600),
// así que quedan por encima de todo esto automáticamente.
crearPaneSincronizado('paneZonasPeligro', 396);
crearPaneSincronizado('paneZonasHS', 397);
crearPaneSincronizado('panePlataformas', 398);
crearPaneSincronizado('panePosiciones', 399); // [CLAVE] por encima de plataformas siempre
crearPaneSincronizado('paneVialidadesDestacadas', 400);

// -------------------------------------------------------
// 1. COLORES POR CATEGORÍA (según la señalética de referencia)
// -------------------------------------------------------
const COLORES_VIALIDADES_DESTACADAS = {
    'VIALIDAD PERIMETRAL NORTE': '#12777d', // teal, límite 40
    'VIALIDAD PERIMETRAL SUR':   '#f4820d', // naranja, límite 30
    'VIALIDAD EXTERNA':          '#3cb54a', // verde, límite 20
    'VIALIDAD INTERNA T1 Y T2':  '#29b6f6'  // celeste, límite 10
};
const COLOR_VIALIDAD_DEFAULT = '#6c757d'; // por si aparece un nombre no contemplado

// -------------------------------------------------------
// 2. Auto-tamaño de etiquetas (igual criterio que edificios/interés,
//    pero independiente para no interferir con ese sistema)
// -------------------------------------------------------
window._etiquetasEspeciales = window._etiquetasEspeciales || [];

function actualizarTamanoEtiquetaEspecial(entrada) {
    const bounds = entrada.bounds;
    const marcador = entrada.marcador;

    const sw = window.map.latLngToLayerPoint(bounds.getSouthWest());
    const ne = window.map.latLngToLayerPoint(bounds.getNorthEast());
    const ancho = Math.max(30, Math.abs(ne.x - sw.x));
    const alto  = Math.max(14, Math.abs(ne.y - sw.y));

    const area = ancho * alto;
    const fontSize = Math.min(13, Math.max(7, Math.sqrt(area) * 0.12));

    marcador.setIcon(L.divIcon({
        className: entrada.claseIcono || 'etiqueta-capa-especial',
        html: `<div class="etiqueta-texto-plano etiqueta-centrada" style="font-size:${fontSize}px;${entrada.colorTexto ? `color:${entrada.colorTexto};font-weight:800;` : ''}">${entrada.html}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
    }));
}

function recalcularEtiquetasEspeciales() {
    for (let entrada of window._etiquetasEspeciales) {
        actualizarTamanoEtiquetaEspecial(entrada);
    }
}
window.map.on('zoomend', recalcularEtiquetasEspeciales);

// Crea una etiqueta centrada sobre un polígono (zonas de peligro, plataformas, posiciones)
function crearEtiquetaSobrePoligono(layer, grupoDestino, html, claseIcono, colorTexto) {
    const bounds = layer.getBounds();
    const centro = bounds.getCenter();

    const marcador = L.marker(centro, {
        icon: L.divIcon({ className: claseIcono, html: `<div class="etiqueta-texto-plano etiqueta-centrada">${html}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] }),
        interactive: false,
        keyboard: false
    });
    grupoDestino.addLayer(marcador);

    const entrada = { bounds, marcador, html, claseIcono, colorTexto };
    window._etiquetasEspeciales.push(entrada);
    actualizarTamanoEtiquetaEspecial(entrada);
}

// -------------------------------------------------------
// 4. GRUPOS DE CAPAS (uno por dataset, para el toggle de filtros)
// -------------------------------------------------------
window.capasEspeciales = {
    zonasPeligro: L.layerGroup(),
    vialidadesDestacadas: L.layerGroup(),
    plataformas: L.layerGroup(),
    posiciones: L.layerGroup(),
    zonasHS: L.layerGroup() // [NUEVO]
};

// -------------------------------------------------------
// 5. CARGA DE LOS 4 ARCHIVOS
// -------------------------------------------------------
Promise.all([
    fetch('/resources/zonas_peligro.geojson').then(r => r.json()).catch(() => null),
    fetch('/resources/vialidades_destacadas.geojson').then(r => r.json()).catch(() => null),
    fetch('/resources/plataformas.geojson').then(r => r.json()).catch(() => null),
    fetch('/resources/posiciones.geojson').then(r => r.json()).catch(() => null),
    fetch('/resources/host_spot.geojson').then(r => r.json()).catch(() => null)
]).then(([dataZonasPeligro, dataVialidadesDestacadas, dataPlataformas, dataPosiciones, dataZonasHS]) => {

    // --- ZONAS HS (Borde rojo, relleno rojo traslúcido, excluidas del buscador) ---
    if (dataZonasHS) {
        L.geoJSON(dataZonasHS, {
            pane: 'paneZonasHS',
            style: { color: '#dc3545', weight: 2, fillColor: '#dc3545', fillOpacity: 0.35 },
            onEachFeature: function(feature, layer) {
                const nombre = feature.properties && feature.properties.name;
                if (nombre) {
                    // Creamos la etiqueta visual en el mapa usando el mismo estilo de peligro
                    crearEtiquetaSobrePoligono(layer, window.capasEspeciales.zonasHS, nombre, 'etiqueta-zona-peligro');
                    
                    // Es puramente visual: no es una estructura seleccionable.
                }
            }
        }).eachLayer(l => window.capasEspeciales.zonasHS.addLayer(l));
    }

    // --- ZONAS DE PELIGRO (borde azul fuerte, relleno azul translúcido) ---
    // Excluidas del buscador y de la navegación a propósito.
    if (dataZonasPeligro) {
        L.geoJSON(dataZonasPeligro, {
            pane: 'paneZonasPeligro',
            style: { color: '#0d47a1', weight: 3, fillColor: '#2196f3', fillOpacity: 0.35 },
            onEachFeature: function(feature, layer) {
                const nombre = feature.properties && feature.properties.name;
                if (nombre) {
                    crearEtiquetaSobrePoligono(layer, window.capasEspeciales.zonasPeligro, nombre, 'etiqueta-zona-peligro');
                }
            }
        }).eachLayer(l => window.capasEspeciales.zonasPeligro.addLayer(l));
    }

    // --- VIALIDADES DESTACADAS (color por categoría + nombre y velocidad repetidos) ---
    if (dataVialidadesDestacadas) {
        window.viasNombradas = window.viasNombradas || [];
        window.viasConLimite = window.viasConLimite || [];

        turf.featureEach(dataVialidadesDestacadas, function(feature) {
            if (!feature.geometry || feature.geometry.type !== 'LineString') return;

            const props = feature.properties || {};
            const nombre = props.name || '';
            // [NUEVO] Extraemos la propiedad ref (ej. VPE) para la vista
            const abreviatura = props.ref || nombre; 
            
            const velocidadRaw = props.velocidad;
            const velocidadNum = velocidadRaw !== undefined && velocidadRaw !== null ? parseInt(velocidadRaw, 10) : null;
            const velocidadValida = velocidadNum !== null && !isNaN(velocidadNum);

            // Respetamos el color usando el nombre completo, ya que así está declarado en tu constante de colores
            const color = COLORES_VIALIDADES_DESTACADAS[nombre] || COLOR_VIALIDAD_DEFAULT;

            // Línea coloreada
            const coordsLatLng = feature.geometry.coordinates.map(c => [c[1], c[0]]);
            const linea = L.polyline(coordsLatLng, {
                pane: 'paneVialidadesDestacadas',
                color: color,
                weight: 5,
                opacity: 0.85
            });
            window.capasEspeciales.vialidadesDestacadas.addLayer(linea);

            if (nombre) {
                // [NUEVO] También se integran al sistema de navegación existente:
                // el letrero de km/h y el "vas por..." las reconocerán igual que
                // las vialidades del grafo principal.
                window.viasNombradas.push({ linea: feature, nombre: nombre });
                if (velocidadValida) {
                    window.viasConLimite.push({ linea: feature, maxspeed: velocidadNum });
                }

                // [MODIFICADO] Una sola etiqueta por nombre (agrupando los
                // segmentos que compartan nombre, ej. las 14 partes de
                // "VIALIDAD EXTERNA"), que sigue la porción visible en pantalla.
                // [MODIFICADO] Usamos 'abreviatura' para mostrar la propiedad ref visualmente en el mapa
                const textoEtiqueta = velocidadValida ? `${abreviatura}<br>${velocidadNum} km/h` : abreviatura;
                registrarEtiquetaSiguiendoVista(nombre, [feature], window.capasEspeciales.vialidadesDestacadas, textoEtiqueta, 'etiqueta-vialidad-destacada', color);
            }
        });
    }

    // --- PLATAFORMAS (borde rojo, relleno amarillo translúcido) ---
    if (dataPlataformas) {
        L.geoJSON(dataPlataformas, {
            pane: 'panePlataformas',
            style: { color: '#dc3545', weight: 2, fillColor: '#ffc107', fillOpacity: 0.18 },
            onEachFeature: function(feature, layer) {
                const nombre = feature.properties && feature.properties.name;
                if (nombre) {
                    const centro = layer.getBounds().getCenter();
                    crearEtiquetaSobrePoligono(layer, window.capasEspeciales.plataformas, nombre, 'etiqueta-plataforma');
                }
            }
        }).eachLayer(l => window.capasEspeciales.plataformas.addLayer(l));
    }

    // --- POSICIONES (solo contorno, sin relleno; siempre visibles sobre plataformas) ---
    if (dataPosiciones) {
        L.geoJSON(dataPosiciones, {
            pane: 'panePosiciones',
            style: { color: '#1e293b', weight: 1.5, fillOpacity: 0 },
            onEachFeature: function(feature, layer) {
                const nombre = feature.properties && feature.properties.name;
                if (nombre) {
                    const centro = layer.getBounds().getCenter();
                    crearEtiquetaSobrePoligono(layer, window.capasEspeciales.posiciones, nombre, 'etiqueta-posicion');
                }
            }
        }).eachLayer(l => window.capasEspeciales.posiciones.addLayer(l));
    }

    // Todas visibles por defecto, igual que el resto de filtros del panel
    //window.capasEspeciales.zonasPeligro.addTo(window.map);
   // window.capasEspeciales.vialidadesDestacadas.addTo(window.map);
    //window.capasEspeciales.plataformas.addTo(window.map);
    //window.capasEspeciales.posiciones.addTo(window.map);

    actualizarEtiquetasSiguiendoVista(); // [NUEVO] posiciona las etiquetas para la vista inicial

    console.log("Capas especiales (zonas de peligro, vialidades destacadas, plataformas, posiciones) cargadas.");

}).catch(err => console.error("Error cargando capas especiales:", err))
  .finally(() => {
      if (typeof window.notificarModuloMapaListo === 'function') {
          window.notificarModuloMapaListo('especiales');
      }
  });

// -------------------------------------------------------
// 6. FILTROS (checkboxes del panel de control)
// -------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const conectarFiltro = (idCheckbox, grupo) => {
        const chk = document.getElementById(idCheckbox);
        if (!chk) return;
        chk.addEventListener('change', function(e) {
            if (e.target.checked) grupo.addTo(window.map);
            else window.map.removeLayer(grupo);
        });
    };

    conectarFiltro('chkZonasPeligro', window.capasEspeciales.zonasPeligro);
    conectarFiltro('chkVialidadesDestacadas', window.capasEspeciales.vialidadesDestacadas);
    conectarFiltro('chkPlataformas', window.capasEspeciales.plataformas);
    conectarFiltro('chkPosiciones', window.capasEspeciales.posiciones);
    conectarFiltro('chkZonasHS', window.capasEspeciales.zonasHS);
});
