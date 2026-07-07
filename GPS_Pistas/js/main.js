// =======================================================
// main.js - GPS, Sockets, Motor VECTORIAL y Brújula de Rotación
// =======================================================

const socket = io();

// Un único marcador local: solo tú existes en el mapa.
// Se elimina el Map de marcadores múltiples y el sistema multijugador.
let miMarcadorLocal = null;
let primerAjuste = true;
let trayectoria = null;
let marcador = null;
let siguiendoUsuario = false;

// =======================================================
// 1. ESTRUCTURA DE DATOS: MIN-HEAP
// =======================================================
class MinHeap {
    constructor() { this.data = []; }
    push(val, score) { this.data.push({val, score}); this.up(this.data.length - 1); }
    pop() { if (this.data.length === 0) return null; const top = this.data[0], bottom = this.data.pop(); if (this.data.length > 0) { this.data[0] = bottom; this.down(0); } return top.val; }
    up(i) { while (i > 0) { let p = (i - 1) >> 1; if (this.data[p].score <= this.data[i].score) break; let tmp = this.data[i]; this.data[i] = this.data[p]; this.data[p] = tmp; i = p; } }
    down(i) { const len = this.data.length; while ((i << 1) + 1 < len) { let left = (i << 1) + 1, right = left + 1, min = (right < len && this.data[right].score < this.data[left].score) ? right : left; if (this.data[i].score <= this.data[min].score) break; let tmp = this.data[i]; this.data[i] = this.data[min]; this.data[min] = tmp; i = min; } }
    get length() { return this.data.length; }
}

// =======================================================
// 2. CONSTRUCCIÓN DEL GRAFO VIAL
// =======================================================
let grafoRutas = new Map();
let nodosCaminos = null; 

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

fetch('/resources/mapa_conectado.geojson')
    .then(r => r.json())
    .then(geojson => {
        let nodosTemp = [];
        turf.featureEach(geojson, function(feature) {
            if (feature.geometry.type === 'LineString') {
                const coords = feature.geometry.coordinates;

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

                    if (!grafoRutas.has(id1)) { grafoRutas.set(id1, []); nodosTemp.push(turf.point(p1, {id: id1})); }
                    if (!grafoRutas.has(id2)) { grafoRutas.set(id2, []); nodosTemp.push(turf.point(p2, {id: id2})); }

                    // cost = distancia real "pelona". El peso NO se aplica aquí porque
                    // su penalización depende de la posición del usuario en cada
                    // trazado (ver trazarRutaInteligente, sección 5).
                    grafoRutas.get(id1).push({ target: id2, cost: distReal, peso });
                    grafoRutas.get(id2).push({ target: id1, cost: distReal, peso }); 
                }
            }
        });
        nodosCaminos = turf.featureCollection(nodosTemp);
        console.log(`Grafo vial cargado: ${grafoRutas.size} nodos listos.`);
    })
    .catch(err => console.error("Error cargando la red vascular:", err));

// =======================================================
// 3. GEOLOCALIZACIÓN Y SOCKETS (SOLO USUARIO ACTUAL)
// =======================================================
let ultimoEnvioGps = 0;
const LIMITE_LATENCIA_MS = 2000; 

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (pos) => {
            const ahora = Date.now();
            const { latitude, longitude } = pos.coords;
            
            // Actualización inmediata y fluida del marcador local sin esperar al servidor
            if (miMarcadorLocal) miMarcadorLocal.setLatLng([latitude, longitude]);

            if (ahora - ultimoEnvioGps > LIMITE_LATENCIA_MS) {
                if (typeof window.desbloquearZonaOrigen === 'function') window.desbloquearZonaOrigen(latitude, longitude);
                socket.emit('actualizar-ubicacion', { lat: latitude, lng: longitude });
                ultimoEnvioGps = ahora;
            }
        },
        (err) => console.error("Error de GPS:", err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// El servidor solo nos devuelve nuestra propia ubicación; no llega ningún otro usuario.
socket.on('dibujar-ubicacion', (data) => {
    const { lat, lng } = data;
    const capaDestino = (window.capas && window.capas.usuarios) ? window.capas.usuarios : window.map;

    if (miMarcadorLocal) {
        miMarcadorLocal.setLatLng([lat, lng]);
        if (marcador && trayectoria) {
            trazarRutaInteligente(miMarcadorLocal.getLatLng(), marcador.getLatLng());
        }
    } else {
        // El ícono direccional está definido en mapIconos.js (window.iconos.miUbicacion).
        // actualizarRotacionIcono() lo gira según el giroscopio para mostrar el frente real.
        const iconoUsuario = (window.iconos && window.iconos.miUbicacion)
            ? window.iconos.miUbicacion
            : new L.Icon.Default();
        miMarcadorLocal = L.marker([lat, lng], { icon: iconoUsuario }).addTo(capaDestino);
        if (marcador) window.enfocarUsuario();
    }

    // Si el modo seguimiento está activo, re-centramos el mapa suavemente
    // solo cuando el usuario se alejó lo suficiente del centro (>8m).
    if (siguiendoUsuario && window.map) {
        const centroActual = window.map.getCenter();
        const distCentro = window.map.distance(centroActual, [lat, lng]);
        if (distCentro > 8) {
            window.map.panTo([lat, lng], { animate: true, duration: 1.5, easeLinearity: 0.25 });
        }
    }

    if (primerAjuste) {
        window.map.flyTo([lat, lng], 16, { animate: true, duration: 2 });
        primerAjuste = false;
        siguiendoUsuario = true;
    }
});

// Al reconectarse (ej. pantalla apagada), limpiamos el marcador anterior
// para no duplicarlo con el nuevo socket.id que asigna el servidor.
socket.on('connect', () => {
    if (miMarcadorLocal) {
        const capaDestino = (window.capas && window.capas.usuarios) ? window.capas.usuarios : window.map;
        try { capaDestino.removeLayer(miMarcadorLocal); } catch (_) {}
        miMarcadorLocal = null;
    }
    primerAjuste = true;
});

// usuario-desconectado eliminado: no hay otros usuarios que gestionar.

// =======================================================
// 4. INTERACCIÓN Y SELECCIÓN DE DESTINOS
// =======================================================
let marcadorTemp = null;      
let nombreLugarTemporal = ""; 
let trazandoRuta = false; 

window.map.on('click', function(e) {
    const panel = document.getElementById('panelDestino');
    if (!panel.classList.contains('oculto')) {
        panel.classList.add('oculto');
        if (marcadorTemp) {
            window.map.removeLayer(marcadorTemp);
            marcadorTemp = null;
        }
        return; 
    }

    const { lat, lng } = e.latlng;
    nombreLugarTemporal = "Punto en el Mapa"; 
    procesarSeleccionTemporal(lat, lng, nombreLugarTemporal);
});

window.irHacia = function(lat, lng, nombreLugar) {
    nombreLugarTemporal = nombreLugar; 
    procesarSeleccionTemporal(lat, lng, nombreLugarTemporal);
};

function procesarSeleccionTemporal(lat, lng, nombre) {
    // Si el punto viene de un lugar conocido (POI, edificio, terminal, historial o
    // resultado del buscador), zonaPermitidaTemporal ya está fijado y saltamos
    // AMBAS validaciones: perímetro exterior y zonas restringidas internas.
    // Solo validamos cuando el usuario toca un punto libre en el mapa.
    if (!window.zonaPermitidaTemporal) {
        if (window.geojsonDataPrincipalPermitida) {
            const puntoClick = turf.point([lng, lat]);
            const perimetro = window.geojsonDataPrincipalPermitida.features ? window.geojsonDataPrincipalPermitida.features[0] : window.geojsonDataPrincipalPermitida;
            if (!turf.booleanPointInPolygon(puntoClick, perimetro)) {
                return;
            }
        }

        if (typeof window.esUbicacionValida === 'function' && !window.esUbicacionValida(lat, lng)) {
            return;
        }
    }

    if (marcadorTemp) {
        marcadorTemp.setLatLng([lat, lng]);
    } else {
        marcadorTemp = L.marker([lat, lng], { icon: window.iconos.destinoTemporal }).addTo(window.map);
    }

    document.getElementById('bs-titulo').innerText = nombre;
    document.getElementById('panelDestino').classList.remove('oculto');
}

window.cerrarPanelDestino = function() {
    document.getElementById('panelDestino').classList.add('oculto');
    if (marcadorTemp) {
        window.map.removeLayer(marcadorTemp);
        marcadorTemp = null;
    }
};

window.confirmarNuevoDestino = function() {
    if (!marcadorTemp) return;
    
    document.getElementById('panelDestino').classList.add('oculto');

    const nuevaCoordenada = marcadorTemp.getLatLng();
    const nombreFinal = nombreLugarTemporal; 

    const tempRef = marcadorTemp;
    marcadorTemp = null; 
    window.map.removeLayer(tempRef);

    if (marcador) {
        marcador.setLatLng(nuevaCoordenada);
        marcador.bindPopup(`<strong class="text-success">${nombreFinal}</strong>`).openPopup();
    } else {
        const capaParaDestino = (window.capas && window.capas.destinos) ? window.capas.destinos : window.map;
        marcador = L.marker(nuevaCoordenada, { icon: window.iconos.destino }).addTo(capaParaDestino);
        marcador.bindPopup(`<strong class="text-success">${nombreFinal}</strong>`).openPopup();
        
        marcador.on('popupclose', function() {
            if (!trazandoRuta && marcador) {
                window.capas.destinos.removeLayer(marcador);
                marcador = null;
                if (trayectoria) { window.capas.trayectorias.removeLayer(trayectoria); trayectoria = null; }
            }
            trazandoRuta = false; 
        });
    }

    window.solicitarRuta();
};

window.solicitarRuta = function() {
    if (!miMarcadorLocal || !marcador) return;
    trazandoRuta = true; 
    marcador.closePopup(); 
    trazarRutaInteligente(miMarcadorLocal.getLatLng(), marcador.getLatLng());
    window.enfocarUsuario();
};

// =======================================================
// 5. MOTOR VECTORIAL A* CON PUENTES INTELIGENTES
// =======================================================

// -------------------------------------------------------
// Evasión dinámica de zonas de mayor afluencia (peso = 2)
// -------------------------------------------------------
// UMBRAL_CERCANIA_ZONA_PESO_M: si el punto de partida del usuario está a
// menos de esta distancia (en metros) de un tramo de peso alto, se asume
// que el usuario YA está prácticamente sobre/dentro de esa zona y por lo
// tanto sí se le permite cruzarla sin penalización (sería absurdo
// mandarlo a dar la vuelta si ya está ahí).
//
// FACTOR_EVASION_FUERTE: multiplicador aplicado al costo de un tramo de
// peso alto cuando el usuario NO está cerca (según el umbral de arriba).
// Es intencionalmente grande para que el A* prefiera una ruta bastante
// más larga con tal de no cruzar esa zona, pero sigue siendo un número
// finito (a diferencia del bloqueo de pistas de vuelo, que es 9999) para
// que, si esa fuera la única forma de llegar, la ruta igual se calcule.
const UMBRAL_CERCANIA_ZONA_PESO_M = 600;
const FACTOR_EVASION_FUERTE = 20;

function trazarRutaInteligente(inicioGPS, finGPS) {
    if (!grafoRutas.size || !nodosCaminos) {
        dibujarLineaEnMapa([[inicioGPS.lat, inicioGPS.lng], [finGPS.lat, finGPS.lng]]);
        return;
    }

    const ptInicio = turf.point([inicioGPS.lng, inicioGPS.lat]);
    const ptFin = turf.point([finGPS.lng, finGPS.lat]);

    const nodoInicio = turf.nearestPoint(ptInicio, nodosCaminos);
    const nodoFin = turf.nearestPoint(ptFin, nodosCaminos);

    const startId = nodoInicio.properties.id;
    const endId = nodoFin.properties.id;

    const openHeap = new MinHeap();
    const gScores = new Map();
    const parents = new Map();

    gScores.set(startId, 0);
    openHeap.push(startId, 0);

    let caminoEncontrado = false;
    let mejorNodoAlcanzado = startId;
    let distanciaMinimaAlFinal = Infinity;

    while (openHeap.length > 0) {
        const currId = openHeap.pop();
        if (currId === endId) { caminoEncontrado = true; break; }

        const [cLng, cLat] = currId.split(',').map(Number);
        const [fLng, fLat] = endId.split(',').map(Number);
        const distAlObjetivo = Math.hypot(cLng - fLng, cLat - fLat);
        
        if (distAlObjetivo < distanciaMinimaAlFinal) {
            distanciaMinimaAlFinal = distAlObjetivo;
            mejorNodoAlcanzado = currId;
        }

        const currG = gScores.get(currId);
        const vecinos = grafoRutas.get(currId) || [];

        for (let v of vecinos) {
            let penalizacion = 1.0;
            if (window.evitarPistasVuelo && typeof window.esZonaPuente === 'function') {
                const [lng, lat] = v.target.split(',').map(Number);
                if (!window.esZonaPuente(lat, lng) && typeof window.esUbicacionValida === 'function' && !window.esUbicacionValida(lat, lng)) {
                    continue; // Se ignora esta arista, no se relaja ni se agrega al heap
                }
            }

            // --- Evasión por peso (zonas de mayor afluencia) ---
            // Si el tramo tiene peso > 1, se penaliza fuerte para que el A*
            // prefiera un camino más largo, EXCEPTO si el usuario ya arrancó
            // muy cerca de ese tramo (UMBRAL_CERCANIA_ZONA_PESO_M), en cuyo
            // caso se le permite pasar sin castigo extra.
            let factorPeso = 1.0;
            if (v.peso && v.peso > 1) {
                const [lngV, latV] = v.target.split(',').map(Number);
                const distUsuarioM = turf.distance(ptInicio, turf.point([lngV, latV]), { units: 'meters' });
                factorPeso = (distUsuarioM > UMBRAL_CERCANIA_ZONA_PESO_M)
                    ? v.peso * FACTOR_EVASION_FUERTE
                    : 1.0;
            }

            const tentativeG = currG + (v.cost * factorPeso);
            const neighborG = gScores.has(v.target) ? gScores.get(v.target) : Infinity;
        
            if (tentativeG < neighborG) {
                parents.set(v.target, currId);
                gScores.set(v.target, tentativeG);
        
                const pC = v.target.split(',').map(Number);
                const pF = endId.split(',').map(Number);
                const h = turf.distance(turf.point(pC), turf.point(pF));
        
                openHeap.push(v.target, tentativeG + h);
            }
        }
    }

    const pathCoords = [];
    let curr = caminoEncontrado ? endId : mejorNodoAlcanzado;
    
    while (curr) {
        const [lng, lat] = curr.split(',').map(Number);
        pathCoords.push({lat, lng});
        curr = parents.get(curr);
    }
    pathCoords.reverse();
    
    pathCoords.unshift(inicioGPS);
    
    if (!caminoEncontrado) {
        const [endLng, endLat] = endId.split(',').map(Number);
        pathCoords.push({lat: endLat, lng: endLng});
        console.warn("Se utilizó un puente de aproximación inteligente para sortear una zona desconectada.");
    }
    
    pathCoords.push(finGPS);

    dibujarLineaEnMapa(pathCoords.map(pt => [pt.lat, pt.lng]));
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
            smoothFactor: 0 
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
        if (miMarcadorLocal && marcador) trazarRutaInteligente(miMarcadorLocal.getLatLng(), marcador.getLatLng());
    });
}

// =======================================================
// GIROSCOPIO — Filtro de suavizado con zona muerta (anti-erratico)
// =======================================================
let usandoAbsoluto = false;
let anguloCrudo = null;
let anguloSuavizado = null;
let ultimoAnguloRenderizado = -1;

document.addEventListener('DOMContentLoaded', () => {
    const btnEnfoque = document.getElementById('btnEnfocarGps');
    if (btnEnfoque && window.map) {
        // El dragstart que cancela el seguimiento y muestra el botón
        // está en la sección 8 junto al resto de eventos del mapa.
        btnEnfoque.addEventListener('click', () => { window.enfocarUsuario(); inicializarBrujula(); });
    }

    // Brújula: efecto visual de clic y regresa el mapa al norte (bearing 0).
    const btnBrujula = document.getElementById('btnBrujula');
    if (btnBrujula) {
        btnBrujula.addEventListener('click', () => {
            btnBrujula.classList.remove('bg-white');
            btnBrujula.classList.add('bg-primary');
            btnBrujula.innerHTML = '<i class="bi bi-compass fs-4 text-white"></i>';

            setTimeout(() => {
                btnBrujula.classList.remove('bg-primary');
                btnBrujula.classList.add('bg-white');
                btnBrujula.innerHTML = '<i class="bi bi-compass fs-4 text-dark"></i>';
            }, 200);

            if (window.map && typeof window.map.setBearing === 'function') {
                window.map.setBearing(0, { animate: true, duration: 0.5 });
            }
            // Re-renderizamos el ícono con el nuevo bearing tras la animación
            setTimeout(() => {
                if (ultimoAnguloRenderizado !== -1) actualizarRotacionIcono(ultimoAnguloRenderizado);
            }, 520);
        });
    }

    inicializarBrujula();
    requestAnimationFrame(bucleIconoSuave);
});

function inicializarBrujula() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(p => { if (p === 'granted') escucharOrientacion(); }).catch(console.error);
    } else escucharOrientacion();
}

function escucharOrientacion() {
    // Preferimos deviceorientationabsolute (más preciso, ya referenciado al norte magnético)
    window.addEventListener('deviceorientationabsolute', (e) => { usandoAbsoluto = true; handlerOrientacion(e); }, true);
    window.addEventListener('deviceorientation', (e) => { if (!usandoAbsoluto) handlerOrientacion(e); }, true);
}

function handlerOrientacion(event) {
    let heading;
    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        heading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
        heading = (360 - event.alpha) % 360;
    }
    if (heading !== undefined && heading !== null) {
        anguloCrudo = heading;
        // Inicializamos el suavizado en el primer dato recibido
        if (anguloSuavizado === null) anguloSuavizado = heading;
    }
}

// Bucle RAF: suaviza el ángulo crudo y solo renderiza cuando el cambio es visible.
// Alpha adaptativo: absorbe vibraciones pequeñas, responde rápido a giros grandes.
// Zona muerta gráfica de 2°: evita micro-temblores constantes en el SVG.
function bucleIconoSuave() {
    if (anguloCrudo !== null && anguloSuavizado !== null) {

        // Diferencia circular (evita saltos en el cruce 0°/360°)
        let diferencia = anguloCrudo - anguloSuavizado;
        while (diferencia >  180) diferencia -= 360;
        while (diferencia < -180) diferencia += 360;

        // Alpha adaptativo según la magnitud del giro
        const abs = Math.abs(diferencia);
        let alpha = 0.012;           // Reposo: absorción casi total de vibración
        if      (abs > 20) alpha = 0.055;  // Giro rápido: respuesta ágil
        else if (abs > 8)  alpha = 0.025;  // Giro medio: transición fluida

        anguloSuavizado += diferencia * alpha;
        if (anguloSuavizado <   0) anguloSuavizado += 360;
        if (anguloSuavizado >= 360) anguloSuavizado -= 360;

        // Zona muerta gráfica: solo renderizamos si el cambio es ≥ 2°
        let difRender = anguloSuavizado - ultimoAnguloRenderizado;
        while (difRender >  180) difRender -= 360;
        while (difRender < -180) difRender += 360;

        if (Math.abs(difRender) >= 2 || ultimoAnguloRenderizado === -1) {
            ultimoAnguloRenderizado = Math.round(anguloSuavizado);
            actualizarRotacionIcono(ultimoAnguloRenderizado);
        }
    }
    requestAnimationFrame(bucleIconoSuave);
}

function actualizarRotacionIcono(angulo) {
    if (miMarcadorLocal && miMarcadorLocal._icon) {
        const svgEl = miMarcadorLocal._icon.querySelector('svg');
        if (svgEl) {
            const bearing = (window.map && typeof window.map.getBearing === 'function') ? window.map.getBearing() : 0;
            const anguloCSS = ((angulo - bearing) % 360 + 360) % 360;
            svgEl.style.transform = `rotateZ(${anguloCSS}deg)`;
        }
    }
}

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

        window.map.on('rotate', () => {
            if (ultimoAnguloRenderizado !== -1) actualizarRotacionIcono(ultimoAnguloRenderizado);
        });
    }
});