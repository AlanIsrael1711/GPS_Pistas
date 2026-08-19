// =======================================================
// main.js - GPS, Sockets, Motor VECTORIAL y Brújula de Rotación
// =======================================================

// Un único marcador local: solo tú existes en el mapa.
// Se elimina el Map de marcadores múltiples y el sistema multijugador.
let miMarcadorLocal = null;
let circuloPrecisionLocal = null;
let primerAjuste = true;
let trayectoria = null;
let marcador = null;
let siguiendoUsuario = false;

// =======================================================
// 1. CONSTRUCCIÓN DEL GRAFO VIAL
// =======================================================
let grafoRutas = new Map();
let nodosCaminos = null;
let grafoRutasCargado = false;
let resolverCargaGrafo;
const promesaGrafoRutas = new Promise(resolve => { resolverCargaGrafo = resolve; });

// -------------------------------------------------------
// [CORREGIDO] Función dinámica definitiva para botones flotantes
// -------------------------------------------------------
window.moverBotonesFlotantes = function(subir, idPanel = null) {
    const contenedorBotones = document.querySelector('.fab-container');
    if (!contenedorBotones) return;
    window._versionMovimientoFab = (window._versionMovimientoFab || 0) + 1;
    const versionActual = window._versionMovimientoFab;

    if (subir && idPanel) {
        const panel = document.getElementById(idPanel);
        if (panel) {
            // Forzamos al navegador a recalcular el tamaño físico de la pantalla de inmediato
            void panel.offsetHeight; 

            requestAnimationFrame(() => {
                if (versionActual !== window._versionMovimientoFab) return;
                // Ahora sí, la altura es 100% precisa
                const alturaReal = panel.offsetHeight;
                
                if (idPanel === 'panelNavegacion' || idPanel === 'panelAlternativasRuta') {
                    // MODO NAVEGACIÓN: Acuesta los botones (horizontal)
                    contenedorBotones.classList.add('modo-horizontal');
                    // Reducimos el extra a + 5 porque los botones ya tienen 30px de base en el CSS
                    contenedorBotones.style.transform = `translateY(-${alturaReal + 5}px)`;
                } else {
                    // MODO DESTINO: Mantiene columna vertical
                    contenedorBotones.classList.remove('modo-horizontal');
                    contenedorBotones.style.transform = `translateY(-${alturaReal + 5}px)`;
                }
            });
        }
    } else {
        // MODO CERRAR/CANCELAR: Limpia las clases y devuelve los botones abajo
        contenedorBotones.classList.remove('modo-horizontal');
        contenedorBotones.style.transform = '';
    }
};

// -------------------------------------------------------
// Ponderación por afluencia (propiedad "peso" del geojson)
// -------------------------------------------------------
// peso = 1 -> tramo "principal" (presente tanto en red_sin_pista_lateral
//             como en red_vascular_unida): costo normal.
// peso = 2 -> tramo exclusivo de red_vascular_unida (zona de mayor
//             afluencia / vía lateral): el A* la evita de forma fuerte
//             AUNQUE la ruta alterna sea más larga en el mapa, salvo
//             que el usuario ya se encuentre muy cerca de esa zona
//             (ver UMBRAL_CERCANIA_ZONA_PESO_M en la sección 5), caso en
//             el que sí se permite cruzarla sin penalización extra.
// El costo real (distReal) y el peso se guardan en cada arista; la
// penalización se calcula en tiempo real dentro del A* (sección 5),
// porque depende de dónde está parado el usuario en cada trazado.

// -------------------------------------------------------
// Vialidades destacadas: referencia para los perfiles de ruta
// -------------------------------------------------------
// Cada tramo del grafo se marca con "esDestacada: true/false" según qué
// tan cerca esté de alguna línea de vialidades_destacadas.geojson. Como
// ambos archivos NO comparten coordenadas exactas (fueron digitalizados
// por separado), la comparación es por CERCANÍA GEOMÉTRICA, no por
// coincidencia de vértices.
const TOLERANCIA_VIALIDAD_DESTACADA_M = 15; // ajustable si hay falsos +/-

// Determina si el punto medio de una arista del grafo está lo bastante
// cerca de alguna vialidad destacada. Usa un chequeo de bbox primero
// (barato) antes de calcular la distancia real (turf.pointToLineDistance),
// para no penalizar el rendimiento con miles de aristas.
function obtenerVialidadDestacada(p1, p2, destacadasConBbox) {
    if (!destacadasConBbox || destacadasConBbox.length === 0) return null;

    const medio = turf.midpoint(turf.point(p1), turf.point(p2));
    const [mlng, mlat] = medio.geometry.coordinates;
    const margenGrados = 0.0003; // ~30m de margen alrededor del bbox de cada vía destacada

    for (let d of destacadasConBbox) {
        const [minX, minY, maxX, maxY] = d.bbox;
        if (mlng < minX - margenGrados || mlng > maxX + margenGrados ||
            mlat < minY - margenGrados || mlat > maxY + margenGrados) {
            continue; // descartado barato por bbox, sin calcular distancia real
        }
        const dist = turf.pointToLineDistance(medio, d.linea, { units: 'meters' });
        if (dist <= TOLERANCIA_VIALIDAD_DESTACADA_M) return d;
    }
    return null;
}

function obtenerComponentePrincipal(grafo) {
    const visitados = new Set();
    let principal = new Set();

    for (const inicio of grafo.keys()) {
        if (visitados.has(inicio)) continue;
        const componente = new Set([inicio]);
        const pendientes = [inicio];
        visitados.add(inicio);

        while (pendientes.length > 0) {
            const actual = pendientes.pop();
            for (const vecino of grafo.get(actual) || []) {
                if (visitados.has(vecino.target)) continue;
                visitados.add(vecino.target);
                componente.add(vecino.target);
                pendientes.push(vecino.target);
            }
        }

        if (componente.size > principal.size) principal = componente;
    }

    return principal;
}

Promise.all([
    // Esta red sí conserva sus pesos originales e incluye vialidades
    // complementarias y 377 tramos de rodaje (aeroway=taxiway).
    fetch('/resources/red_vascular_unida_con_peso.geojson').then(r => r.json()),
    fetch('/resources/vialidades_destacadas.geojson').then(r => r.json()).catch(() => null)
])
    .then(([geojson, geojsonDestacadas]) => {
        const nodosTemp = new Map();
        grafoRutas = new Map();
        window.viasNombradas = window.viasNombradas || [];
        window.viasConLimite = window.viasConLimite || [];

        // [NUEVO] Preparamos las líneas de vialidades destacadas (con su
        // bbox precalculado) para poder comparar cada tramo del grafo.
        const destacadasConBbox = [];
        if (geojsonDestacadas) {
            turf.featureEach(geojsonDestacadas, function(feature) {
                if (feature.geometry && feature.geometry.type === 'LineString') {
                    const propiedades = feature.properties || {};
                    destacadasConBbox.push({
                        linea: feature,
                        bbox: turf.bbox(feature),
                        nombre: propiedades.name || null,
                        velocidad: Number(propiedades.velocidad) || null
                    });
                }
            });
        }

        turf.featureEach(geojson, function(feature) {
            if (feature.geometry.type === 'LineString') {
                const coords = feature.geometry.coordinates;

                // Si la vialidad tiene nombre, la registramos para navegación
                const nombreVia = feature.properties && feature.properties.name;
                if (nombreVia) {
                    window.viasNombradas.push({ linea: feature, nombre: nombreVia });
                }

                // [NUEVO] Si la vialidad tiene límite de velocidad, la registramos
                // para mostrar el letrero de km/h en tiempo real.
                const velocidadRaw = feature.properties && feature.properties.velocidad;
                const velocidadNum = velocidadRaw !== undefined && velocidadRaw !== null
                    ? parseInt(velocidadRaw, 10)
                    : null;
                if (velocidadNum !== null && !isNaN(velocidadNum)) {
                    window.viasConLimite.push({ linea: feature, maxspeed: velocidadNum });
                }

                // Peso de la vía completa (viene del geojson, default 1 si no existe)
                const peso = (feature.properties && typeof feature.properties.peso === 'number')
                    ? feature.properties.peso
                    : 1;

                for (let i = 0; i < coords.length - 1; i++) {
                    const p1 = coords[i];
                    const p2 = coords[i+1];
                    const id1 = `${p1[0]},${p1[1]}`; 
                    const id2 = `${p2[0]},${p2[1]}`;
                    
                    const distReal = turf.distance(turf.point(p1), turf.point(p2));

                    // ¿Este tramo coincide con una vialidad destacada?
                    const vialidadDestacada = obtenerVialidadDestacada(p1, p2, destacadasConBbox);
                    const esDestacada = Boolean(vialidadDestacada);
                    const esRodaje = feature.properties && feature.properties.aeroway === 'taxiway';
                    const nombreTramo = nombreVia || (vialidadDestacada && vialidadDestacada.nombre) || null;
                    const velocidadTramo = velocidadNum || (vialidadDestacada && vialidadDestacada.velocidad) || null;

                    if (!grafoRutas.has(id1)) { grafoRutas.set(id1, []); nodosTemp.set(id1, turf.point(p1, {id: id1})); }
                    if (!grafoRutas.has(id2)) { grafoRutas.set(id2, []); nodosTemp.set(id2, turf.point(p2, {id: id2})); }

                    // cost conserva la distancia real. Las preferencias de cada
                    // perfil se aplican al calcular las alternativas (sección 5).
                    const metadatos = { cost: distReal, peso, esDestacada, esRodaje, nombre: nombreTramo, velocidad: velocidadTramo };
                    grafoRutas.get(id1).push({ target: id2, ...metadatos });
                    grafoRutas.get(id2).push({ target: id1, ...metadatos });
                }
            }
        });

        // Evita que el origen o destino se adhieran a una isla aislada de la red.
        const componentePrincipal = obtenerComponentePrincipal(grafoRutas);
        nodosCaminos = turf.featureCollection(
            [...componentePrincipal].map(id => nodosTemp.get(id)).filter(Boolean)
        );
        grafoRutasCargado = true;
        resolverCargaGrafo(true);
        console.log(`Grafo vial cargado: ${grafoRutas.size} nodos; componente principal: ${componentePrincipal.size}.`);
    })
    .catch(err => {
        console.error("Error cargando la red vascular:", err);
        resolverCargaGrafo(false);
    });

// =======================================================
// 3. GEOLOCALIZACIÓN Y SOCKETS (SOLO USUARIO ACTUAL)
// =======================================================
let ultimaActualizacionEspacial = 0;

function actualizarPrecisionGPS(lat, lng, precisionMetros) {
    const precision = Number(precisionMetros);
    if (!Number.isFinite(precision) || precision <= 0) return;

    // El círculo de precisión es una capa geográfica: Leaflet lo mueve y gira
    // junto con el mapa. El punto azul se dibuja encima como marcador.
    const radio = Math.min(500, Math.max(3, precision));
    if (circuloPrecisionLocal) {
        circuloPrecisionLocal.setLatLng([lat, lng]);
        circuloPrecisionLocal.setRadius(radio);
        return;
    }

    circuloPrecisionLocal = L.circle([lat, lng], {
        radius: radio,
        interactive: false,
        color: '#2563eb',
        weight: 1,
        opacity: 0.28,
        fillColor: '#60a5fa',
        fillOpacity: 0.13,
        className: 'gps-halo-precision'
    }).addTo(window.map);
}

function actualizarUbicacionLocal(lat, lng, precisionMetros) {
    const capaDestino = (window.capas && window.capas.usuarios) ? window.capas.usuarios : window.map;
    actualizarLimiteVelocidad(lat, lng);
    actualizarPrecisionGPS(lat, lng, precisionMetros);

    if (miMarcadorLocal) {
        miMarcadorLocal.setLatLng([lat, lng]);
        if (marcador && trayectoria && rutaActiva) {
            recalcularRutaActiva(miMarcadorLocal.getLatLng(), marcador.getLatLng());
            actualizarPasoActualPorPosicion(miMarcadorLocal.getLatLng());
        }
    } else {
        const iconoUsuario = (window.iconos && window.iconos.miUbicacion)
            ? window.iconos.miUbicacion
            : new L.Icon.Default();
        miMarcadorLocal = L.marker([lat, lng], {
            icon: iconoUsuario,
            keyboard: false,
            riseOnHover: true,
            zIndexOffset: 1000
        }).addTo(capaDestino);
        actualizarRotacionIcono(rumboVisualActual());
        if (marcador) window.enfocarUsuario();
    }

    if (siguiendoUsuario) {
        const centroActual = window.map.getCenter();
        if (window.map.distance(centroActual, [lat, lng]) > 8) {
            window.map.panTo([lat, lng], { animate: true, duration: 1.5, easeLinearity: 0.25 });
        }
    }

    if (primerAjuste) {
        window.map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
        primerAjuste = false;
        siguiendoUsuario = true;
    }
}

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (pos) => {
            const ahora = Date.now();
            const { latitude, longitude } = pos.coords;
            actualizarUbicacionLocal(latitude, longitude, pos.coords.accuracy);
            actualizarRumboDesdeGPS(pos.coords);

            if (ahora - ultimaActualizacionEspacial > 2000) {
                if (typeof window.desbloquearZonaOrigen === 'function') window.desbloquearZonaOrigen(latitude, longitude);
                ultimaActualizacionEspacial = ahora;
            }
        },
        (err) => console.error("Error de GPS:", err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 1500 }
    );
}

// =======================================================
// 4. INTERACCIÓN Y SELECCIÓN DE DESTINOS
// =======================================================
let marcadorTemp = null;      
let nombreLugarTemporal = ""; 
let trazandoRuta = false;
let opcionesRutasCalculadas = [];
let previsualizacionesRutas = [];
let perfilRutaActivo = null;
let rutaActiva = null;
let toqueMapaPendiente = null;
let inspeccionandoDestinoTemporal = false;
let rutaOcultaPorInspeccion = false;

const MODULOS_SELECCION_REQUERIDOS = ['prohibidos', 'interes', 'especiales'];

function lugaresDelMapaListos() {
    return MODULOS_SELECCION_REQUERIDOS.every(nombre => window.modulosMapaListos && window.modulosMapaListos.has(nombre));
}

function mostrarAvisoMapa(texto) {
    let aviso = document.getElementById('avisoMapa');
    if (!aviso) {
        aviso = document.createElement('div');
        aviso.id = 'avisoMapa';
        aviso.className = 'aviso-mapa shadow';
        document.body.appendChild(aviso);
    }
    aviso.textContent = texto;
    aviso.classList.add('visible');
    clearTimeout(mostrarAvisoMapa._timer);
    mostrarAvisoMapa._timer = setTimeout(() => aviso.classList.remove('visible'), 1800);
}

function obtenerCentroLugar(lugar) {
    if (lugar.centro && Number.isFinite(lugar.centro.lat) && Number.isFinite(lugar.centro.lng)) {
        return lugar.centro;
    }
    if (Number.isFinite(lugar.lat) && Number.isFinite(lugar.lng)) {
        return { lat: lugar.lat, lng: lugar.lng };
    }
    if (lugar.feature) {
        const centro = turf.centerOfMass(lugar.feature);
        return { lat: centro.geometry.coordinates[1], lng: centro.geometry.coordinates[0] };
    }
    return null;
}

// Resolución espacial centralizada: no depende de cuál canvas/capa terminó
// arriba después de las peticiones asíncronas. Esto hace estable el toque en
// polígonos, líneas y puntos aun al terminar de cargar o después de cancelar.
function buscarLugarTocado(latlng) {
    if (!window.SelectionPolicy) return null;
    return window.SelectionPolicy.buscarEstructuraEnPunto(
        window.estructurasSeleccionables || [],
        latlng,
        turf
    );
}

function procesarToqueMapa(latlng) {
    if (!lugaresDelMapaListos()) {
        toqueMapaPendiente = latlng;
        mostrarAvisoMapa('Terminando de cargar los lugares…');
        return;
    }

    const lugar = buscarLugarTocado(latlng);
    if (lugar) {
        const centro = obtenerCentroLugar(lugar);
        if (!centro) return;
        window.zonaPermitidaTemporal = lugar.feature;
        window.irHacia(centro.lat, centro.lng, lugar.nombre);
        return;
    }

    window.zonaPermitidaTemporal = null;
    mostrarAvisoMapa('Selecciona una estructura marcada en el mapa');
}

window.addEventListener('gps:modulo-mapa-listo', () => {
    if (toqueMapaPendiente && lugaresDelMapaListos()) {
        const pendiente = toqueMapaPendiente;
        toqueMapaPendiente = null;
        procesarToqueMapa(pendiente);
    }
});

window.map.on('click', function(e) {
    const panel = document.getElementById('panelDestino');
    if (panel && !panel.classList.contains('d-none')) {
        window.cerrarPanelDestino();
    }
    procesarToqueMapa(e.latlng);
});

window.irHacia = function(lat, lng, nombreLugar) {
    const zonaSeleccionada = window.zonaPermitidaTemporal;
    if (!window.SelectionPolicy || !window.SelectionPolicy.esEstructura(zonaSeleccionada)) {
        window.zonaPermitidaTemporal = null;
        mostrarAvisoMapa('Sólo se permiten estructuras como destino');
        return;
    }
    window.zonaPermitidaTemporal = zonaSeleccionada;
    nombreLugarTemporal = nombreLugar; 
    procesarSeleccionTemporal(lat, lng, nombreLugarTemporal);
};

function procesarSeleccionTemporal(lat, lng, nombre) {
    if (!window.SelectionPolicy || !window.SelectionPolicy.esEstructura(window.zonaPermitidaTemporal)) {
        mostrarAvisoMapa('Sólo se permiten estructuras como destino');
        return;
    }

    // Inspeccionar otra estructura no modifica la ruta que ya está activa.
    // Sólo se oculta temporalmente su panel para mostrar la confirmación.
    rutaOcultaPorInspeccion = Boolean(
        trazandoRuta
        && rutaActiva
        && pasosRuta.length > 0
    );
    inspeccionandoDestinoTemporal = true;
    const panelNavegacion = document.getElementById('panelNavegacion');
    if (panelNavegacion) panelNavegacion.classList.add('d-none');

    if (marcadorTemp) {
        marcadorTemp.setLatLng([lat, lng]);
    } else {
        marcadorTemp = L.marker([lat, lng], { icon: window.iconos.destinoTemporal }).addTo(window.map);
    }

    document.getElementById('bs-titulo').innerText = nombre;
    document.getElementById('panelDestino').classList.remove('d-none');
    window.moverBotonesFlotantes(true, 'panelDestino');
}

window.cerrarPanelDestino = function(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    const debeRestaurarRuta = Boolean(
        rutaOcultaPorInspeccion
        && trazandoRuta
        && rutaActiva
        && pasosRuta.length > 0
    );

    inspeccionandoDestinoTemporal = false;
    rutaOcultaPorInspeccion = false;

    const panelDestino = document.getElementById('panelDestino');
    if (panelDestino) panelDestino.classList.add('d-none');
    if (marcadorTemp) {
        if (window.map && window.map.hasLayer(marcadorTemp)) {
            window.map.removeLayer(marcadorTemp);
        }
        marcadorTemp = null;
    }
    window.zonaPermitidaTemporal = null;

    if (debeRestaurarRuta) {
        // La inspección nunca debe borrar la línea ni el destino anteriores.
        // Si otra actualización de Leaflet retiró una capa, se vuelve a montar
        // usando el estado de la ruta que permaneció intacto.
        const capaTrayectorias = window.capas && window.capas.trayectorias;
        if (!trayectoria && Array.isArray(rutaActiva.pathCoords)) {
            dibujarLineaEnMapa(rutaActiva.pathCoords.map(pt => [pt.lat, pt.lng]));
        } else if (trayectoria && capaTrayectorias && !capaTrayectorias.hasLayer(trayectoria)) {
            capaTrayectorias.addLayer(trayectoria);
        } else if (trayectoria && !capaTrayectorias && window.map && !window.map.hasLayer(trayectoria)) {
            trayectoria.addTo(window.map);
        }

        const capaDestinos = window.capas && window.capas.destinos;
        if (marcador && capaDestinos && !capaDestinos.hasLayer(marcador)) {
            capaDestinos.addLayer(marcador);
        } else if (marcador && !capaDestinos && window.map && !window.map.hasLayer(marcador)) {
            marcador.addTo(window.map);
        }

        renderizarPanelInstrucciones();
    } else {
        window.moverBotonesFlotantes(false);
    }
};

window.confirmarNuevoDestino = async function() {
    if (!marcadorTemp) return;

    const nuevaCoordenada = marcadorTemp.getLatLng();
    const nombreFinal = nombreLugarTemporal;
    const habiaEnrutamientoAnterior = Boolean(
        trazandoRuta
        || rutaActiva
        || trayectoria
        || marcador
        || opcionesRutasCalculadas.length > 0
    );

    inspeccionandoDestinoTemporal = false;
    rutaOcultaPorInspeccion = false;

    // La ruta anterior sólo se sustituye cuando el usuario confirma
    // expresamente el nuevo edificio mediante "Iniciar Ruta".
    if (habiaEnrutamientoAnterior && typeof window.cancelarRuta === 'function') {
        window.cancelarRuta();
    } else {
        document.getElementById('panelDestino').classList.add('d-none');
        window.moverBotonesFlotantes(false);

        const tempRef = marcadorTemp;
        marcadorTemp = null;
        window.map.removeLayer(tempRef);
        window.zonaPermitidaTemporal = null;
    }

    if (marcador) {
        marcador.setLatLng(nuevaCoordenada);
        marcador.bindPopup(`<strong class="text-success">${nombreFinal}</strong>`);
    } else {
        const capaParaDestino = (window.capas && window.capas.destinos) ? window.capas.destinos : window.map;
        marcador = L.marker(nuevaCoordenada, { icon: window.iconos.destino }).addTo(capaParaDestino);
        marcador.bindPopup(`<strong class="text-success">${nombreFinal}</strong>`);
    }

    await window.solicitarRuta();
};

window.solicitarRuta = async function() {
    if (!marcador) return;
    if (!miMarcadorLocal) {
        mostrarAvisoMapa('Esperando una ubicación GPS válida…');
        return;
    }
    const redDisponible = grafoRutasCargado || await promesaGrafoRutas;
    if (!redDisponible) {
        mostrarAvisoMapa('No fue posible cargar la red de rutas');
        return;
    }
    trazandoRuta = false;
    marcador.closePopup();
    mostrarOpcionesRuta(miMarcadorLocal.getLatLng(), marcador.getLatLng());
    window.enfocarUsuario();
};

// =======================================================
// 5. MOTOR A* Y GENERACIÓN DE ALTERNATIVAS
// =======================================================
const PERFILES_RUTA = {
    recomendada: {
        id: 'recomendada',
        titulo: 'Recomendada',
        descripcion: 'Equilibrio entre distancia y vialidades principales',
        color: '#2563eb',
        factorComplementaria: 1.18,
        factorRodaje: 1.10,
        factorPesoAlto: 1.8
    },
    corta: {
        id: 'corta',
        titulo: 'Más corta',
        descripcion: 'Prioriza la menor distancia disponible',
        color: '#16a34a',
        factorComplementaria: 1,
        factorRodaje: 1,
        factorPesoAlto: 1.15
    },
    principales: {
        id: 'principales',
        titulo: 'Vialidades principales',
        descripcion: 'Prefiere las vialidades destacadas sin bloquear el resto',
        color: '#f97316',
        factorComplementaria: 1.75,
        factorRodaje: 1.45,
        factorPesoAlto: 2.2
    },
    alternativa: {
        id: 'alternativa',
        titulo: 'Alternativa',
        descripcion: 'Usa un recorrido distinto cuando la red lo permite',
        color: '#8b5cf6',
        factorComplementaria: 1.15,
        factorRodaje: 1.08,
        factorPesoAlto: 1.7
    }
};

function aristaPermitida(edge, sourceId, cacheNodos, cacheAristas) {
    const clave = `${sourceId}>${edge.target}`;
    if (cacheAristas.has(clave)) return cacheAristas.get(clave);

    const destino = window.RouteEngine.coordenadasNodo(edge.target);
    let permitida = true;

    if (!cacheNodos.has(edge.target)) {
        cacheNodos.set(
            edge.target,
            typeof window.esUbicacionValida !== 'function' || window.esUbicacionValida(destino.lat, destino.lng)
        );
    }
    permitida = cacheNodos.get(edge.target);

    if (permitida && window.evitarPistasVuelo && typeof window.segmentoCruzaPista === 'function') {
        const origen = window.RouteEngine.coordenadasNodo(sourceId);
        permitida = !window.segmentoCruzaPista(origen, destino);
    }

    cacheAristas.set(clave, permitida);
    return permitida;
}

function convertirResultadoRuta(resultado, inicioGPS, finGPS, perfil, penalizadas) {
    if (!resultado) return null;

    const pathCoords = [
        { lat: inicioGPS.lat, lng: inicioGPS.lng },
        ...resultado.ids.map(id => window.RouteEngine.coordenadasNodo(id)),
        { lat: finGPS.lat, lng: finGPS.lng }
    ].filter((punto, index, lista) => {
        if (index === 0) return true;
        const anterior = lista[index - 1];
        return punto.lat !== anterior.lat || punto.lng !== anterior.lng;
    });

    let distanciaRedKm = 0;
    let distanciaDestacadaKm = 0;
    let distanciaRodajeKm = 0;
    for (const edge of resultado.edges) {
        distanciaRedKm += edge.cost;
        if (edge.esDestacada) distanciaDestacadaKm += edge.cost;
        if (edge.esRodaje) distanciaRodajeKm += edge.cost;
    }

    const distanciaConectoresKm = turf.distance(
        turf.point([inicioGPS.lng, inicioGPS.lat]),
        turf.point([pathCoords[1].lng, pathCoords[1].lat])
    ) + turf.distance(
        turf.point([pathCoords[pathCoords.length - 2].lng, pathCoords[pathCoords.length - 2].lat]),
        turf.point([finGPS.lng, finGPS.lat])
    );
    const distanciaKm = distanciaRedKm + distanciaConectoresKm;
    const minutos = Math.max(1, Math.round((distanciaKm / 20) * 60));
    const porcentajeDestacada = distanciaRedKm > 0 ? Math.round((distanciaDestacadaKm / distanciaRedKm) * 100) : 0;

    let resumenRed = `${porcentajeDestacada}% por vialidades destacadas`;
    if (distanciaRodajeKm > 0.02) resumenRed += ' · incluye rodajes';

    return {
        id: perfil.id,
        perfil,
        penalizadas: penalizadas || new Set(),
        resultado,
        pathCoords,
        distanciaMetros: Math.round(distanciaKm * 1000),
        minutos,
        resumenRed
    };
}

function calcularRutaConPerfil(inicioGPS, finGPS, perfil, penalizadas = new Set()) {
    if (!grafoRutas.size || !nodosCaminos || !window.RouteEngine) return null;

    const ptInicio = turf.point([inicioGPS.lng, inicioGPS.lat]);
    const ptFin = turf.point([finGPS.lng, finGPS.lat]);
    const startId = turf.nearestPoint(ptInicio, nodosCaminos).properties.id;
    const endId = turf.nearestPoint(ptFin, nodosCaminos).properties.id;
    const cacheNodos = new Map();
    const cacheAristas = new Map();

    const resultado = window.RouteEngine.buscarRuta(grafoRutas, startId, endId, {
        edgeAllowed: (edge, sourceId) => aristaPermitida(edge, sourceId, cacheNodos, cacheAristas),
        edgeCost: (edge, sourceId) => {
            let factor = 1;
            if (!edge.esDestacada) factor *= perfil.factorComplementaria;
            if (edge.esRodaje) factor *= perfil.factorRodaje;
            if (edge.peso > 1) factor *= perfil.factorPesoAlto;
            if (penalizadas.has(window.RouteEngine.claveArista(sourceId, edge.target))) factor *= 2.4;
            return edge.cost * factor;
        }
    });

    return convertirResultadoRuta(resultado, inicioGPS, finGPS, perfil, penalizadas);
}

function esOpcionDistinta(opcion, existentes) {
    return existentes.every(existente => {
        return window.RouteEngine.similitudAristas(opcion.resultado, existente.resultado) < 0.82;
    });
}

function calcularOpcionesRuta(inicioGPS, finGPS) {
    const opciones = [];
    const recomendada = calcularRutaConPerfil(inicioGPS, finGPS, PERFILES_RUTA.recomendada);
    if (recomendada) opciones.push(recomendada);

    for (const perfil of [PERFILES_RUTA.corta, PERFILES_RUTA.principales]) {
        const opcion = calcularRutaConPerfil(inicioGPS, finGPS, perfil);
        if (opcion && esOpcionDistinta(opcion, opciones)) opciones.push(opcion);
    }

    if (recomendada && opciones.length < 3) {
        const penalizadas = window.RouteEngine.conjuntoAristas(recomendada.resultado);
        const alternativa = calcularRutaConPerfil(inicioGPS, finGPS, PERFILES_RUTA.alternativa, penalizadas);
        if (alternativa && esOpcionDistinta(alternativa, opciones)) opciones.push(alternativa);
    }

    return opciones.slice(0, 3);
}

function removerCapaRuta(layer) {
    if (!layer) return;
    const grupo = window.capas && window.capas.trayectorias;
    if (grupo && grupo.hasLayer(layer)) grupo.removeLayer(layer);
    else if (window.map && window.map.hasLayer(layer)) window.map.removeLayer(layer);
}

function limpiarPrevisualizacionesRutas() {
    for (const layer of previsualizacionesRutas) removerCapaRuta(layer);
    previsualizacionesRutas = [];
}

function mostrarOpcionesRuta(inicioGPS, finGPS) {
    limpiarPrevisualizacionesRutas();
    opcionesRutasCalculadas = calcularOpcionesRuta(inicioGPS, finGPS);

    if (opcionesRutasCalculadas.length === 0) {
        mostrarAvisoMapa('No hay una ruta válida con las restricciones actuales');
        return;
    }

    const capa = (window.capas && window.capas.trayectorias) ? window.capas.trayectorias : window.map;
    for (const opcion of opcionesRutasCalculadas) {
        const preview = L.polyline(opcion.pathCoords.map(p => [p.lat, p.lng]), {
            color: opcion.perfil.color,
            weight: 6,
            opacity: 0.62,
            dashArray: '8, 10',
            lineCap: 'round',
            interactive: false,
            className: 'ruta-vista-previa'
        }).addTo(capa);
        previsualizacionesRutas.push(preview);
    }

    const panel = document.getElementById('panelAlternativasRuta');
    const resumen = document.getElementById('resumenAlternativasRuta');
    const lista = document.getElementById('listaAlternativasRuta');
    if (!panel || !resumen || !lista) return;

    resumen.textContent = opcionesRutasCalculadas.length === 1
        ? 'Sólo existe un recorrido válido para este destino'
        : `${opcionesRutasCalculadas.length} recorridos diferentes disponibles`;
    lista.innerHTML = opcionesRutasCalculadas.map(opcion => `
        <button type="button" class="alternativa-ruta" onclick="window.seleccionarRuta('${opcion.id}')">
            <span class="alternativa-ruta-color" style="background:${opcion.perfil.color}"></span>
            <span>
                <span class="alternativa-ruta-titulo">${opcion.perfil.titulo}</span>
                <span class="alternativa-ruta-detalle">${formatearDistancia(opcion.distanciaMetros)} · ${opcion.minutos} min aprox.</span>
                <span class="alternativa-ruta-red">${opcion.resumenRed}</span>
            </span>
            <span class="alternativa-ruta-accion">Elegir</span>
        </button>
    `).join('');

    const searchBox = document.querySelector('.search-container');
    if (searchBox) searchBox.classList.add('d-none');
    panel.style.removeProperty('display');
    panel.classList.remove('d-none');
    window.moverBotonesFlotantes(true, 'panelAlternativasRuta');
}

function formatearDistancia(metros) {
    return metros >= 1000 ? `${(metros / 1000).toFixed(1)} km` : `${metros} m`;
}

window.seleccionarRuta = function(id) {
    const opcion = opcionesRutasCalculadas.find(item => item.id === id);
    if (!opcion) return;

    limpiarPrevisualizacionesRutas();
    const panel = document.getElementById('panelAlternativasRuta');
    if (panel) panel.classList.add('d-none');

    perfilRutaActivo = opcion.perfil;
    rutaActiva = opcion;
    rutaActiva.ultimaPosicionRecalculo = miMarcadorLocal ? miMarcadorLocal.getLatLng() : null;
    trazandoRuta = true;
    dibujarLineaEnMapa(opcion.pathCoords.map(pt => [pt.lat, pt.lng]));
    pasosRuta = generarInstrucciones(opcion.pathCoords);
    pasoActualIndex = 0;
    renderizarPanelInstrucciones();
};

function recalcularRutaActiva(inicioGPS, finGPS, forzar = false) {
    if (!rutaActiva || !perfilRutaActivo) return;
    const ultima = rutaActiva.ultimaPosicionRecalculo;
    if (!forzar && ultima && window.map.distance(ultima, inicioGPS) < 25) return;

    const actualizada = calcularRutaConPerfil(inicioGPS, finGPS, perfilRutaActivo, rutaActiva.penalizadas);
    if (!actualizada) return;
    actualizada.ultimaPosicionRecalculo = inicioGPS;
    rutaActiva = actualizada;
    dibujarLineaEnMapa(actualizada.pathCoords.map(pt => [pt.lat, pt.lng]));
    pasosRuta = generarInstrucciones(actualizada.pathCoords);
    pasoActualIndex = 0;
    renderizarPanelInstrucciones();
}


// =======================================================
// 6. FUNCIONES AUXILIARES Y DIBUJO
// =======================================================
function dibujarLineaEnMapa(puntos) {
    const capaParaTrayectoria = (window.capas && window.capas.trayectorias) ? window.capas.trayectorias : window.map;
    
    if (trayectoria) {
        trayectoria.setLatLngs(puntos);
    } else {
        trayectoria = L.polyline(puntos, {
            color: '#2563eb',
            weight: 5,
            opacity: 0.8,
            dashArray: '10, 15',
            lineCap: 'round',
            smoothFactor: 0,
            interactive: false,
            className: 'ruta-navegacion'
        }).addTo(capaParaTrayectoria); 
    }
}

window.enfocarUsuario = function() {
    if (miMarcadorLocal && window.map) {
        siguiendoUsuario = true;
        window.map.flyTo(miMarcadorLocal.getLatLng(), 18, { animate: true, duration: 1.5 });
        const btnEnfoque = document.getElementById('btnEnfocarGps');
        if (btnEnfoque) btnEnfoque.style.display = 'none';
    }
};

// =======================================================
// 7. FILTROS, BRÚJULA Y ORIENTACIÓN AL NORTE
// =======================================================
const chkEvitarPistas = document.getElementById('chkEvitarPistas');
if (chkEvitarPistas) {
    chkEvitarPistas.addEventListener('change', function(e) {
        window.evitarPistasVuelo = e.target.checked;
        if (window.capaPistasVuelo) {
            window.capaPistasVuelo.setStyle({
                fillOpacity: window.evitarPistasVuelo ? 0.2 : 0.05,
                color: window.evitarPistasVuelo ? "#dc3545" : "#6c757d"
            });
        }
        if (miMarcadorLocal && marcador) {
            if (rutaActiva) recalcularRutaActiva(miMarcadorLocal.getLatLng(), marcador.getLatLng(), true);
            else mostrarOpcionesRuta(miMarcadorLocal.getLatLng(), marcador.getLatLng());
        }
    });
}

// =======================================================
// ORIENTACIÓN MÓVIL — fusión de giroscopio + giro manual
// =======================================================
let usandoAbsoluto = false;
let brujulaEscuchando = false;
let anguloCrudo = null;
let anguloSuavizado = null;
let ultimoAnguloRenderizado = -1;
let frameOrientacionMapa = null;
const ModeloOrientacion = window.GPSOrientationModel;
const OFFSET_ICONO_USUARIO = 0; // El cono SVG apunta hacia arriba (norte).
const OFFSET_ICONO_BRUJULA = 0;

if (!ModeloOrientacion) {
    throw new Error('No se cargó orientationModel.js antes de main.js');
}

const normalizarAngulo = ModeloOrientacion.normalizarAngulo;
const diferenciaCircular = ModeloOrientacion.diferenciaCircular;

function anguloPantalla() {
    if (window.screen && window.screen.orientation && Number.isFinite(window.screen.orientation.angle)) {
        return window.screen.orientation.angle;
    }
    return Number.isFinite(Number(window.orientation)) ? Number(window.orientation) : 0;
}

function obtenerRumboDispositivo(event) {
    return ModeloOrientacion.rumboDesdeEvento(event, anguloPantalla());
}

// Respaldo para equipos sin sensor de orientación: si el usuario se desplaza,
// el GPS aporta el rumbo de movimiento. La brújula física siempre tiene
// prioridad porque representa hacia dónde mira el teléfono.
function actualizarRumboDesdeGPS(coords) {
    if (brujulaEscuchando && anguloCrudo !== null) return;
    const rumbo = Number(coords && coords.heading);
    const velocidad = Number(coords && coords.speed);
    if (!Number.isFinite(rumbo) || rumbo < 0) return;
    if (Number.isFinite(velocidad) && velocidad < 0.8) return;
    anguloCrudo = normalizarAngulo(rumbo);
    if (anguloSuavizado === null) anguloSuavizado = anguloCrudo;
}

async function inicializarBrujula(desdeGestoUsuario = false) {
    if (brujulaEscuchando) return true;
    const APIOrientacion = window.DeviceOrientationEvent;
    if (!APIOrientacion) return false;

    if (typeof APIOrientacion.requestPermission === 'function') {
        if (!desdeGestoUsuario) return false;
        try {
            const permiso = await APIOrientacion.requestPermission();
            if (permiso !== 'granted') return false;
        } catch (error) {
            console.warn('No fue posible activar la orientación:', error.message);
            return false;
        }
    }

    escucharOrientacion();
    return true;
}

function escucharOrientacion() {
    if (brujulaEscuchando) return;
    brujulaEscuchando = true;
    window.addEventListener('deviceorientationabsolute', event => {
        const rumbo = obtenerRumboDispositivo(event);
        // Algunos equipos anuncian el evento absoluto pero envían valores
        // nulos. Sólo bloqueamos el respaldo cuando recibimos un rumbo válido.
        if (rumbo === null) return;
        usandoAbsoluto = true;
        handlerOrientacion(event, rumbo);
    }, true);
    window.addEventListener('deviceorientation', event => {
        if (!usandoAbsoluto) handlerOrientacion(event);
    }, true);
}

function handlerOrientacion(event, rumboCalculado = null) {
    const rumbo = rumboCalculado === null ? obtenerRumboDispositivo(event) : rumboCalculado;
    if (rumbo === null) return;
    anguloCrudo = rumbo;
    if (anguloSuavizado === null) anguloSuavizado = rumbo;
}

function rumboVisualActual() {
    if (ultimoAnguloRenderizado !== -1) return ultimoAnguloRenderizado;
    if (anguloSuavizado !== null) return anguloSuavizado;
    if (anguloCrudo !== null) return anguloCrudo;
    // Sin una fuente válida no se inventa un norte: se muestra sólo el punto,
    // como Maps cuando todavía no tiene rumbo confiable.
    return null;
}

function actualizarRotacionIcono(angulo = rumboVisualActual()) {
    if (!miMarcadorLocal) return;

    if (typeof miMarcadorLocal.update === 'function') {
        miMarcadorLocal.update();
    }

    const icono = miMarcadorLocal.getElement
        ? miMarcadorLocal.getElement()
        : miMarcadorLocal._icon;

    if (!icono) return;

    // Existen dos piezas que deben girar:
    // el cono y la punta triangular.
    const gruposRumbo =
        icono.querySelectorAll('.usuario-rumbo');

    if (!gruposRumbo || gruposRumbo.length === 0) {
        return;
    }

    if (!Number.isFinite(Number(angulo))) {
        icono.classList.add('gps-sin-rumbo');
        return;
    }

    icono.classList.remove('gps-sin-rumbo');

    const rotacionVisualMapa =
        window.map &&
        typeof window.map.getBearing === 'function'
            ? window.map.getBearing()
            : 0;

    const anguloCSS =
        ModeloOrientacion.rumboEnPantalla(
            angulo,
            rotacionVisualMapa,
            OFFSET_ICONO_USUARIO
        );

    // Se giran solamente el cono y la punta.
    // Leaflet conserva el control del marcador exterior.
    gruposRumbo.forEach(grupo => {
        grupo.setAttribute(
            'transform',
            `rotate(${anguloCSS} 0 0)`
        );
    });
}

function actualizarBrujulaInterfaz() {
    const btn = document.getElementById('btnBrujula');
    const icono = btn && btn.querySelector('i');
    if (!icono) return;
    const rotacionVisualMapa = window.map && typeof window.map.getBearing === 'function'
        ? window.map.getBearing()
        : 0;
    // El icono antiguo conserva el norte alineado con el contenido geográfico.
    // leaflet-rotate aplica getBearing() como rotación visual, por eso se suma.
    const anguloNorte = ModeloOrientacion.rumboEnPantalla(
        0,
        rotacionVisualMapa,
        OFFSET_ICONO_BRUJULA
    );
    icono.style.transform = `rotate(${anguloNorte}deg)`;
}

function sincronizarOrientacionVisual() {
    if (miMarcadorLocal && typeof miMarcadorLocal.update === 'function') {
        miMarcadorLocal.update();
    }
    actualizarRotacionIcono(rumboVisualActual());
    actualizarBrujulaInterfaz();
}

function programarSincronizacionOrientacion() {
    if (frameOrientacionMapa !== null) return;
    frameOrientacionMapa = requestAnimationFrame(() => {
        // La rotación del mapa se proyecta sin suavizado. Sólo el sensor físico
        // pasa por el filtro circular del bucle de orientación.
        sincronizarOrientacionVisual();
        frameOrientacionMapa = null;
    });
}

// El giro manual del mapa nunca se sobrescribe. El giroscopio sólo modifica el
// rumbo físico del usuario; ambos valores se combinan al dibujar el icono.
function bucleOrientacionSuave() {
    if (anguloCrudo !== null && anguloSuavizado !== null) {
        const diferencia = diferenciaCircular(anguloCrudo, anguloSuavizado);
        const magnitud = Math.abs(diferencia);
        let alpha = 0.08;
        if (magnitud > 25) alpha = 0.28;
        else if (magnitud > 8) alpha = 0.16;

        anguloSuavizado = ModeloOrientacion.suavizarCircular(anguloSuavizado, anguloCrudo, alpha);

        const diferenciaRender = ultimoAnguloRenderizado === -1
            ? 360
            : Math.abs(diferenciaCircular(anguloSuavizado, ultimoAnguloRenderizado));
        if (diferenciaRender >= 0.7 || ultimoAnguloRenderizado === -1) {
            ultimoAnguloRenderizado = anguloSuavizado;
            actualizarRotacionIcono(anguloSuavizado);
        }
    }
    requestAnimationFrame(bucleOrientacionSuave);
}

document.addEventListener('DOMContentLoaded', () => {
    const activarSensorOrientacion = async () => {
        const disponible = await inicializarBrujula(true);
        if (!disponible && typeof mostrarAvisoMapa === 'function') {
            mostrarAvisoMapa('Permite el acceso a orientación para mostrar tu rumbo real');
        }
        return disponible;
    };

    const btnEnfoque = document.getElementById('btnEnfocarGps');
    if (btnEnfoque && window.map) {
        btnEnfoque.addEventListener('click', async () => {
            await activarSensorOrientacion();
            window.enfocarUsuario();
            sincronizarOrientacionVisual();
        });
    }

    const btnBrujula = document.getElementById('btnBrujula');
    if (btnBrujula) {
        btnBrujula.addEventListener('click', async () => {
            await activarSensorOrientacion();
            if (window.map && typeof window.map.setBearing === 'function') {
                window.map.setBearing(0);
            }
            sincronizarOrientacionVisual();
        });
    }

    inicializarBrujula(false);
    sincronizarOrientacionVisual();
    requestAnimationFrame(bucleOrientacionSuave);

    // Al cambiar de vertical a horizontal, la parte superior física de la
    // pantalla cambia. Se vuelve a proyectar el último rumbo sin alterar el
    // bearing manual que eligió el usuario.
    if (window.screen && window.screen.orientation &&
        typeof window.screen.orientation.addEventListener === 'function') {
        window.screen.orientation.addEventListener('change', sincronizarOrientacionVisual);
    } else {
        window.addEventListener('orientationchange', sincronizarOrientacionVisual);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        inicializarBrujula(false);
        programarSincronizacionOrientacion();
    });
});

// =======================================================
// 8. OPTIMIZADOR DE RENDIMIENTO VISUAL (ANTI-LAG)
// =======================================================
document.addEventListener('DOMContentLoaded', () => {
    if (window.map) {
        const mapaDOM = document.getElementById('map');
        let temporizadorMovimiento;

        function activarModoMovimiento() {
            mapaDOM.classList.add('mapa-en-movimiento');
            clearTimeout(temporizadorMovimiento);
        }

        function desactivarModoMovimiento() {
            temporizadorMovimiento = setTimeout(() => {
                mapaDOM.classList.remove('mapa-en-movimiento');
            }, 200); 
        }

        // Cuando el usuario arrastra el mapa manualmente, cancelamos el seguimiento
        // y mostramos el botón para volver a centrar.
        window.map.on('dragstart', () => {
            siguiendoUsuario = false;
            const btnEnfoque = document.getElementById('btnEnfocarGps');
            if (btnEnfoque) btnEnfoque.style.display = 'flex';
        });

        window.map.on('rotatestart', activarModoMovimiento);
        window.map.on('dragstart', activarModoMovimiento);
        window.map.on('zoomstart', activarModoMovimiento);

        window.map.on('rotateend', desactivarModoMovimiento);
        window.map.on('dragend', desactivarModoMovimiento);
        window.map.on('zoomend', desactivarModoMovimiento);

        window.map.on('rotate', programarSincronizacionOrientacion);
    }
});

// =======================================================
// 9. INSTRUCCIONES DE NAVEGACIÓN (Turn-by-turn) Y FLECHAS DE DIRECCIÓN
// =======================================================

let pasosRuta = [];      // [{coordInicio, coordFin, distancia, bearingSalida, giro, texto, icono}]
let pasoActualIndex = 0;

const UMBRAL_GIRO_LEVE = 20;    // grados: a partir de aquí ya es "gira a la..."
const UMBRAL_GIRO_FUERTE = 45;  // grados: giro cerrado
const DIST_MIN_SEGMENTO_M = 15; // ignora micro-tramos para no generar giros falsos
const SEPARACION_FLECHAS_M = 40;

// -------------------------------------------------------
// 9.1 Genera instrucciones a partir del camino ya calculado por A*
// -------------------------------------------------------
function generarInstrucciones(pathCoords) {
    if (!pathCoords || pathCoords.length < 2) return [];

    const puntos = pathCoords.map(p => turf.point([p.lng, p.lat]));
    const bearings = [];
    for (let i = 0; i < puntos.length - 1; i++) {
        bearings.push(turf.bearing(puntos[i], puntos[i + 1]));
    }

    const pasos = [];
    let inicioSegmento = 0;
    let distanciaAcumulada = 0;

    for (let i = 0; i < bearings.length; i++) {
        distanciaAcumulada += turf.distance(puntos[i], puntos[i + 1], { units: 'meters' });
        const esUltimo = i === bearings.length - 1;

        let diffBearing = 0;
        if (!esUltimo) {
            diffBearing = bearings[i + 1] - bearings[i];
            while (diffBearing > 180) diffBearing -= 360;
            while (diffBearing < -180) diffBearing += 360;
        }

        if (esUltimo || Math.abs(diffBearing) >= UMBRAL_GIRO_LEVE) {
            if (distanciaAcumulada >= DIST_MIN_SEGMENTO_M || pasos.length === 0 || esUltimo) {
                const coordInicio = pathCoords[inicioSegmento];
                const coordFin = pathCoords[i + 1];

                // [NUEVO] Nombre de la vía en el punto medio de este paso
                const puntoMedio = turf.midpoint(
                    turf.point([coordInicio.lng, coordInicio.lat]),
                    turf.point([coordFin.lng, coordFin.lat])
                );
                const [midLng, midLat] = puntoMedio.geometry.coordinates;
                const nombreVia = buscarNombreViaCercana(midLat, midLng);

                pasos.push({
                    coordInicio,
                    coordFin,
                    distancia: distanciaAcumulada,
                    giro: esUltimo ? null : diffBearing,
                    nombreVia
                });
                inicioSegmento = i + 1;
                distanciaAcumulada = 0;
            }
        }
    }

    const instrucciones = pasos.map((paso, idx) => {
        const giroEntrada = idx === 0 ? null : pasos[idx - 1].giro;
        const nombreAnterior = idx === 0 ? null : pasos[idx - 1].nombreVia;
        const via = paso.nombreVia;

        let texto, icono;
        const cambioDeVia = via && via !== nombreAnterior;

        if (idx === 0) {
            texto = via ? `Inicia tu recorrido por ${via}` : "Inicia tu recorrido";
            icono = "bi-arrow-up-circle-fill";
        } else if (giroEntrada === null || Math.abs(giroEntrada) < UMBRAL_GIRO_LEVE) {
            texto = via
                ? (cambioDeVia ? `Continúa por ${via}` : "Continúa derecho")
                : "Continúa derecho";
            icono = "bi-arrow-up";
        } else if (giroEntrada >= UMBRAL_GIRO_FUERTE) {
            texto = via ? `Gira fuerte a la derecha hacia ${via}` : "Gira fuerte a la derecha";
            icono = "bi-arrow-right-square-fill";
        } else if (giroEntrada >= UMBRAL_GIRO_LEVE) {
            texto = via ? `Gira a la derecha hacia ${via}` : "Gira a la derecha";
            icono = "bi-arrow-up-right";
        } else if (giroEntrada <= -UMBRAL_GIRO_FUERTE) {
            texto = via ? `Gira fuerte a la izquierda hacia ${via}` : "Gira fuerte a la izquierda";
            icono = "bi-arrow-left-square-fill";
        } else {
            texto = via ? `Gira a la izquierda hacia ${via}` : "Gira a la izquierda";
            icono = "bi-arrow-up-left";
        }

        return { ...paso, texto, icono };
    });

    if (instrucciones.length > 0) {
        instrucciones[instrucciones.length - 1].texto = "Has llegado a tu destino";
        instrucciones[instrucciones.length - 1].icono = "bi-flag-fill";
    }
    return instrucciones;
}

// -------------------------------------------------------
// [CORRECCIÓN CRÍTICA] Función blindada para cancelar la ruta activa
// -------------------------------------------------------
window.cancelarRuta = function(e) {
    // 1. Prevenir cualquier comportamiento automático del navegador al hacer clic
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // 2. Limpieza completa de capas y estados de selección.
    try {
        limpiarPrevisualizacionesRutas();
        if (trayectoria) {
            removerCapaRuta(trayectoria);
            trayectoria = null;
        }
        if (marcador) {
            const grupoDestinos = window.capas && window.capas.destinos;
            if (grupoDestinos && grupoDestinos.hasLayer(marcador)) grupoDestinos.removeLayer(marcador);
            else if (window.map && window.map.hasLayer(marcador)) window.map.removeLayer(marcador);
            marcador = null;
        }
        if (marcadorTemp) {
            if (window.map && window.map.hasLayer(marcadorTemp)) window.map.removeLayer(marcadorTemp);
            marcadorTemp = null;
        }
    } catch (error) {
        console.warn("Advertencia al limpiar capas del mapa:", error);
    }

    trazandoRuta = false;
    perfilRutaActivo = null;
    rutaActiva = null;
    inspeccionandoDestinoTemporal = false;
    rutaOcultaPorInspeccion = false;
    opcionesRutasCalculadas = [];
    toqueMapaPendiente = null;
    window.zonaPermitidaTemporal = null;
    nombreLugarTemporal = '';
    
    // 3. Apagar ambos paneles sin dejar una caja invisible sobre el mapa.
    ocultarPanelInstrucciones();
    const panelAlternativas = document.getElementById('panelAlternativasRuta');
    if (panelAlternativas) {
        panelAlternativas.classList.add('d-none');
        panelAlternativas.style.removeProperty('display');
    }
    const panelDestino = document.getElementById('panelDestino');
    if (panelDestino) panelDestino.classList.add('d-none');
    
    // 4. Regresamos la barra del buscador a la pantalla
    const searchBox = document.querySelector('.search-container');
    if (searchBox) searchBox.classList.remove('d-none');

    if (window.map) {
        window.map.closePopup();
        if (window.map.dragging) window.map.dragging.enable();
        if (window.map.touchZoom) window.map.touchZoom.enable();
        if (window.map.doubleClickZoom) window.map.doubleClickZoom.enable();
        requestAnimationFrame(() => window.map.invalidateSize({ pan: false }));
    }
};

// -------------------------------------------------------
// 9.3 Panel de instrucciones (turn-by-turn en vivo)
// -------------------------------------------------------
function renderizarPanelInstrucciones() {
    const panel = document.getElementById('panelNavegacion');
    if (!panel || pasosRuta.length === 0) return;

    // La navegación sigue activa mientras se inspecciona otro edificio,
    // pero su panel queda temporalmente detrás del panel de confirmación.
    if (inspeccionandoDestinoTemporal) {
        panel.classList.add('d-none');
        return;
    }

    const searchBox = document.querySelector('.search-container');
    if (searchBox) searchBox.classList.add('d-none');

    const paso = pasosRuta[pasoActualIndex];
    const siguiente = pasosRuta[pasoActualIndex + 1];

    panel.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center">
                <div class="bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center me-3 shadow-sm" style="width: 52px; height: 52px; flex-shrink: 0;">
                    <i class="bi ${paso.icono} fs-2 text-primary"></i>
                </div>
                <div>
                    <div class="fw-bold text-dark" style="font-size: 1.05rem; line-height: 1.2;">${paso.texto}</div>
                    <div class="fw-bold text-primary mt-1 fs-6">${Math.round(paso.distancia)} metros</div>
                </div>
            </div>
            
            <button type="button" class="btn btn-light rounded-circle shadow-sm border ms-2" onclick="window.cancelarRuta(event)" style="width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;" aria-label="Cancelar Ruta">
                <i class="bi bi-x-lg text-danger fw-bold"></i>
            </button>
        </div>
        ${siguiente ? `<div class="text-muted small mt-3 pt-2 border-top"><i class="bi bi-arrow-return-right me-1"></i> Luego: ${siguiente.texto}</div>` : ''}
    `;
    
    panel.style.removeProperty('display');
    panel.classList.remove('d-none');
    
    // [CORRECCIÓN CRÍTICA] Se envía el ID correcto: 'panelNavegacion'
    window.moverBotonesFlotantes(true, 'panelNavegacion');
}

// -------------------------------------------------------
// Función auxiliar que apaga y destruye el contenido del panel
// -------------------------------------------------------
function ocultarPanelInstrucciones() {
    const panel = document.getElementById('panelNavegacion');
    if (panel) {
        panel.classList.add('d-none');
        // Medida extrema: Forzamos la desaparición con CSS en línea por si Bootstrap falla
        panel.style.setProperty('display', 'none', 'important');
        // Vaciamos el HTML para que físicamente no haya nada que mostrar
        panel.innerHTML = '';

        window.moverBotonesFlotantes(false);
    }
    pasosRuta = [];
    pasoActualIndex = 0;
}

// Avanza el paso "actual" según qué tan cerca esté el usuario del final del tramo
function actualizarPasoActualPorPosicion(latlngUsuario) {
    if (pasosRuta.length === 0) return;
    const ptUsuario = turf.point([latlngUsuario.lng, latlngUsuario.lat]);
    const paso = pasosRuta[pasoActualIndex];
    const pFin = turf.point([paso.coordFin.lng, paso.coordFin.lat]);
    const dist = turf.distance(ptUsuario, pFin, { units: 'meters' });

    if (dist < 12 && pasoActualIndex < pasosRuta.length - 1) {
        pasoActualIndex++;
    }
    // [NUEVO] Ubicación actual en tiempo real (puede diferir del "nombreVia" del paso
    // si el usuario aún no llega al tramo con nombre siguiente)
    window._ubicacionActualTexto = buscarNombreViaCercana(latlngUsuario.lat, latlngUsuario.lng);

    renderizarPanelInstrucciones();
}
// -------------------------------------------------------
// Busca el nombre de la vía (rodaje o vialidad) más cercana
// a un punto dado. Se usa tanto para "dónde estás" en tiempo
// real como para nombrar cada paso de las instrucciones.
// -------------------------------------------------------
const DISTANCIA_MAXIMA_VIA_M = 30; // más allá de esto, no se asume ninguna vía

function buscarNombreViaCercana(lat, lng) {
    if (!window.viasNombradas || window.viasNombradas.length === 0) return null;

    const punto = turf.point([lng, lat]);
    let mejorNombre = null;
    let mejorDistancia = Infinity;

    for (let via of window.viasNombradas) {
        const dist = turf.pointToLineDistance(punto, via.linea, { units: 'meters' });
        if (dist < mejorDistancia) {
            mejorDistancia = dist;
            mejorNombre = via.nombre;
        }
    }

    return mejorDistancia <= DISTANCIA_MAXIMA_VIA_M ? mejorNombre : null;
}

// -------------------------------------------------------
// [NUEVO] Límite de velocidad vigente según la posición actual
// -------------------------------------------------------
const DISTANCIA_MAXIMA_LIMITE_M = 25;

function buscarLimiteVelocidadCercano(lat, lng) {
    if (!window.viasConLimite || window.viasConLimite.length === 0) return null;

    const punto = turf.point([lng, lat]);
    let mejorLimite = null;
    let mejorDistancia = Infinity;

    for (let via of window.viasConLimite) {
        const dist = turf.pointToLineDistance(punto, via.linea, { units: 'meters' });
        if (dist < mejorDistancia) {
            mejorDistancia = dist;
            mejorLimite = via.maxspeed;
        }
    }

    return mejorDistancia <= DISTANCIA_MAXIMA_LIMITE_M ? mejorLimite : null;
}

let ultimoLimiteMostrado = undefined;

function actualizarLimiteVelocidad(lat, lng) {
    const limite = buscarLimiteVelocidadCercano(lat, lng);
    if (limite === ultimoLimiteMostrado) return;
    ultimoLimiteMostrado = limite;

    const letrero = document.getElementById('letreroLimiteVelocidad');
    if (!letrero) return;

    if (limite === null) {
        letrero.classList.add('oculto');
    } else {
        letrero.querySelector('.limite-numero').textContent = limite;
        letrero.classList.remove('oculto');
    }
}
