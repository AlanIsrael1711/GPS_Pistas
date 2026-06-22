// =======================================================
// main.js - GPS, Sockets, Motor VECTORIAL y Brújula Avanzada
// =======================================================

const socket = io();
const marcadores = {};
let primerAjuste = true;
let trayectoria = null;
let marcador = null; 
let siguiendoUsuario = false; // Controla si la cámara sigue al usuario

// =======================================================
// [NUEVO] ICONO DEL USUARIO (Estilo Google Maps con Cono)
// =======================================================
const iconoUsuarioConoSVG = `
<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <!-- Cono de visión (apuntando hacia arriba) -->
  <path d="M 20 20 L 5 0 A 20 20 0 0 1 35 0 Z" fill="rgba(37, 99, 235, 0.35)" />
  <!-- Borde blanco del punto -->
  <circle cx="20" cy="20" r="8" fill="white" />
  <!-- Punto azul central -->
  <circle cx="20" cy="20" r="6" fill="#2563eb" />
</svg>
`;

const iconoUsuarioGoogleMaps = L.divIcon({
    className: 'marcador-usuario-direccion',
    html: iconoUsuarioConoSVG,
    iconSize: [40, 40],
    iconAnchor: [20, 20] 
});

const styleIcono = document.createElement('style');
styleIcono.innerHTML = `
    .marcador-usuario-direccion svg {
        transition: none !important; 
        will-change: transform;
    }
`;
document.head.appendChild(styleIcono);

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

fetch('/resources/red_vascular_unida.geojson')
    .then(r => r.json())
    .then(geojson => {
        let nodosTemp = [];
        turf.featureEach(geojson, function(feature) {
            if (feature.geometry.type === 'LineString') {
                const coords = feature.geometry.coordinates;
                for (let i = 0; i < coords.length - 1; i++) {
                    const p1 = coords[i];
                    const p2 = coords[i+1];
                    const id1 = `${p1[0]},${p1[1]}`; 
                    const id2 = `${p2[0]},${p2[1]}`;
                    
                    const dist = turf.distance(turf.point(p1), turf.point(p2));

                    if (!grafoRutas.has(id1)) { grafoRutas.set(id1, []); nodosTemp.push(turf.point(p1, {id: id1})); }
                    if (!grafoRutas.has(id2)) { grafoRutas.set(id2, []); nodosTemp.push(turf.point(p2, {id: id2})); }

                    grafoRutas.get(id1).push({ target: id2, cost: dist });
                    grafoRutas.get(id2).push({ target: id1, cost: dist }); 
                }
            }
        });
        nodosCaminos = turf.featureCollection(nodosTemp);
        console.log(`Grafo vial cargado: ${grafoRutas.size} nodos listos.`);
    })
    .catch(err => console.error("Error cargando la red vascular:", err));

// =======================================================
// 3. GEOLOCALIZACIÓN Y SOCKETS
// =======================================================
let ultimoEnvioGps = 0;
const LIMITE_LATENCIA_MS = 2000; 

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (pos) => {
            const ahora = Date.now();
            const { latitude, longitude } = pos.coords;
            
            if (marcadores[socket.id]) marcadores[socket.id].setLatLng([latitude, longitude]);

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

socket.on('dibujar-ubicacion', (data) => {
    const { id, lat, lng } = data;
    const capaDestino = (window.capas && window.capas.usuarios) ? window.capas.usuarios : window.map;

    // Si el marcador existe pero ya no está en ninguna capa (por zoom, reinicio de capa,
    // o pantalla apagada), lo eliminamos para que se recree limpio.
    if (marcadores[id] && !window.map.hasLayer(marcadores[id])) {
        try { capaDestino.removeLayer(marcadores[id]); } catch (_) {}
        delete marcadores[id];
    }

    if (marcadores[id]) {
        marcadores[id].setLatLng([lat, lng]);
        if (id === socket.id && marcador && trayectoria) {
            trazarRutaInteligente(marcadores[id].getLatLng(), marcador.getLatLng());
        }
    } else {
        const iconoDestino = (window.iconos && window.iconos.destinoTemporal) ? window.iconos.destinoTemporal : new L.Icon.Default();
        const iconoAsignar = (id === socket.id) ? iconoUsuarioGoogleMaps : iconoDestino;
        
        marcadores[id] = L.marker([lat, lng], { icon: iconoAsignar }).addTo(capaDestino);
        
        if (id === socket.id && marcador) window.enfocarUsuario();
    }

    // Motor de Auto-Seguimiento de Cámara
    // Solo mueve la cámara si el usuario se alejó más de ~8 metros del centro
    // visible, evitando saltos bruscos por cada pequeña actualización del GPS.
    if (siguiendoUsuario && id === socket.id && window.map) {
        const centroActual = window.map.getCenter();
        const distCentro = window.map.distance(centroActual, [lat, lng]);
        if (distCentro > 8) {
            window.map.panTo([lat, lng], {
                animate: true,
                duration: 1.5,       // más lento = más suave
                easeLinearity: 0.25  // curva de aceleración más gentil
            });
        }
    }

    if (id === socket.id && primerAjuste) {
        window.map.flyTo([lat, lng], 16, { animate: true, duration: 2 });
        primerAjuste = false;
        siguiendoUsuario = true; 
    }
});

socket.on('usuario-desconectado', (id) => {
    if (marcadores[id]) {
        const capaDestino = (window.capas && window.capas.usuarios) ? window.capas.usuarios : window.map;
        capaDestino.removeLayer(marcadores[id]);
        delete marcadores[id];
    }
});

// Al reconectarse (pantalla apagada, red caída, etc.) el socket.id cambia.
// Limpiamos TODOS los marcadores propios anteriores para que no queden duplicados.
socket.on('connect', () => {
    const capa = (window.capas && window.capas.usuarios) ? window.capas.usuarios : window.map;

    // Borramos cualquier marcador que no sea de otro usuario conocido por el
    // nuevo socket.id. Como aún no sabemos cuáles son "nuestros" marcadores
    // viejos, la estrategia más segura es limpiar el objeto completo y dejar
    // que el servidor reenvíe las posiciones de todos.
    Object.keys(marcadores).forEach(id => {
        try { capa.removeLayer(marcadores[id]); } catch (_) {}
        delete marcadores[id];
    });

    // Reiniciamos el flag para que la cámara vuele de nuevo a nuestra posición.
    primerAjuste = true;
    siguiendoUsuario = false;
});

// =======================================================
// 4. INTERACCIÓN Y SELECCIÓN DE DESTINOS
// =======================================================
let marcadorTemp = null;      
let nombreLugarTemporal = ""; 
let trazandoRuta = false; 

// Guardamos el tiempo del último dragend para ignorar el 'click' que
// Leaflet dispara al soltar el dedo después de arrastrar el mapa.
let _ultimoDragEnd = 0;
window.map.on('dragend', () => { _ultimoDragEnd = Date.now(); });

window.map.on('click', function(e) {
    // Ignorar si el evento viene inmediatamente después de un drag (< 300 ms).
    if (Date.now() - _ultimoDragEnd < 300) return;

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
    if (window.geojsonDataPrincipalPermitida) {
        const puntoClick = turf.point([lng, lat]);
        const perimetro = window.geojsonDataPrincipalPermitida.features ? window.geojsonDataPrincipalPermitida.features[0] : window.geojsonDataPrincipalPermitida;
        if (!turf.booleanPointInPolygon(puntoClick, perimetro)) {
            alert("Destino fuera de límite."); return; 
        }
    }

    if (typeof window.esUbicacionValida === 'function' && !window.esUbicacionValida(lat, lng)) {
        alert("Punto Inválido: Área restringida."); return;
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
    const miPosicion = marcadores[socket.id];
    if (!miPosicion || !marcador) return;
    trazandoRuta = true; 
    marcador.closePopup(); 
    trazarRutaInteligente(miPosicion.getLatLng(), marcador.getLatLng());
    window.enfocarUsuario();
};

// =======================================================
// 5. MOTOR VECTORIAL A* CON PUENTES INTELIGENTES
// =======================================================
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
                    penalizacion = 9999; 
                }
            }

            const tentativeG = currG + (v.cost * penalizacion);
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
    }
    
    pathCoords.push(finGPS);

    dibujarLineaEnMapa(pathCoords.map(pt => [pt.lat, pt.lng]));
}

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
    const miPosicion = marcadores[socket.id];
    if (miPosicion && window.map) {
        siguiendoUsuario = true; 
        window.map.flyTo(miPosicion.getLatLng(), 18, { animate: true, duration: 1.5 });
        const btnEnfoque = document.getElementById('btnEnfocarGps');
        if (btnEnfoque) btnEnfoque.style.display = 'none';
    }
};

// =======================================================
// 7. GIROSCOPIO — ICONO SUAVE (sin rotación de mapa)
// =======================================================

// Offset de la cámara trasera. 0 = sin corrección (Pixel, Samsung reciente).
// Cambia a -90 o 90 si el cono apunta al lado equivocado en tu dispositivo.
const CALIBRACION_FRENTE = 0;

// Preferimos deviceorientationabsolute sobre el genérico cuando esté disponible.
let usandoAbsoluto = false;

let anguloCrudo     = null;
let anguloSuavizado = null;
let ultimoAnguloRenderizado = -1;

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
        const miPosicion = marcadores[socket.id];
        if (miPosicion && marcador) trazarRutaInteligente(miPosicion.getLatLng(), marcador.getLatLng());
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const btnEnfoque = document.getElementById('btnEnfocarGps');
    if (btnEnfoque && window.map) {
        window.map.on('dragstart', () => { 
            siguiendoUsuario = false; 
            btnEnfoque.style.display = 'flex'; 
        });
        btnEnfoque.addEventListener('click', () => { window.enfocarUsuario(); });
    }

    // Botón brújula: resetea el mapa al norte y al zoom por defecto (16).
    const btnBrujula = document.getElementById('btnBrujula');
    if (btnBrujula) {
        btnBrujula.addEventListener('click', () => {
            if (window.map) {
                // Vuelve el bearing a 0 (norte arriba) con animación suave.
                if (typeof window.map.setBearing === 'function') {
                    window.map.setBearing(0, { animate: true, duration: 0.5 });
                }
                // Fuerza re-render del icono con el bearing ya en 0.
                setTimeout(() => {
                    if (ultimoAnguloRenderizado !== -1) {
                        actualizarRotacionIcono(ultimoAnguloRenderizado);
                    }
                }, 520);
            }
        });
    }

    iniciarGiroscopio();
    requestAnimationFrame(bucleIconoSuave);
});

// Solicita permiso en iOS y arranca los listeners del sensor.
function iniciarGiroscopio() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ requiere permiso explícito.
        DeviceOrientationEvent.requestPermission()
            .then(p => { if (p === 'granted') escucharOrientacion(); })
            .catch(console.error);
    } else {
        escucharOrientacion();
    }
}

function escucharOrientacion() {
    // Preferimos el evento absoluto (Chrome/Android): referenciado al norte magnético real.
    window.addEventListener('deviceorientationabsolute', (e) => {
        usandoAbsoluto = true;
        handlerOrientacion(e);
    }, true);

    // Fallback para Safari iOS, que no emite 'deviceorientationabsolute'.
    window.addEventListener('deviceorientation', (e) => {
        if (!usandoAbsoluto) handlerOrientacion(e);
    }, true);
}

function handlerOrientacion(event) {
    let heading;

    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        // iOS Safari: heading ya viene referenciado a la cámara trasera en portrait.
        heading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
        // Android: alpha es el ángulo del eje Y respecto al norte.
        // La cámara trasera en portrait apunta en -Y, por eso invertimos.
        heading = (360 - event.alpha) % 360;
    }

    if (heading !== undefined && heading !== null) {
        heading = ((heading + CALIBRACION_FRENTE) % 360 + 360) % 360;
        anguloCrudo = heading;
        // En la primera lectura inicializamos el suavizado en el ángulo real
        // para evitar que el icono "gire desde 0" al arrancar.
        if (anguloSuavizado === null) anguloSuavizado = heading;
    }
}

// =======================================================
// BUCLE RAF: suavizado adaptativo + zona muerta → icono
// =======================================================
function bucleIconoSuave() {
    if (anguloCrudo !== null && anguloSuavizado !== null) {

        // Diferencia más corta en el círculo (−180 … +180).
        let diferencia = anguloCrudo - anguloSuavizado;
        while (diferencia >  180) diferencia -= 360;
        while (diferencia < -180) diferencia += 360;

        // Factor de suavizado adaptativo:
        //   • < 5°  → casi nada (ruido de pulso / mano en reposo)
        //   • 5–20° → suave pero perceptible (giro lento al caminar)
        //   • > 20° → más rápido (giro real al doblar una esquina)
        let alpha;
        const abs = Math.abs(diferencia);
        if      (abs < 5)  alpha = 0.008;
        else if (abs < 20) alpha = 0.022;
        else               alpha = 0.060;

        anguloSuavizado += diferencia * alpha;
        if (anguloSuavizado <   0) anguloSuavizado += 360;
        if (anguloSuavizado >= 360) anguloSuavizado -= 360;

        // Zona muerta de 3°: descartamos micro-temblores antes de tocar el DOM.
        let difRender = anguloSuavizado - ultimoAnguloRenderizado;
        while (difRender >  180) difRender -= 360;
        while (difRender < -180) difRender += 360;

        if (Math.abs(difRender) >= 3 || ultimoAnguloRenderizado === -1) {
            const anguloEntero = Math.round(anguloSuavizado);
            ultimoAnguloRenderizado = anguloEntero;
            actualizarRotacionIcono(anguloEntero);
        }
    }
    requestAnimationFrame(bucleIconoSuave);
}

function actualizarRotacionIcono(angulo) {
    const miMarcador = marcadores[socket.id];
    if (miMarcador && miMarcador._icon) {
        const svgElement = miMarcador._icon.querySelector('svg');
        if (svgElement) {
            // Compensamos la rotación actual del mapa para que el icono siempre
            // apunte hacia donde apunta el dispositivo en el mundo real,
            // independientemente de cómo esté girado el mapa en pantalla.
            const bearingMapa = (window.map && typeof window.map.getBearing === 'function')
                ? window.map.getBearing()
                : 0;
            const anguloFinal = ((angulo + bearingMapa) % 360 + 360) % 360;
            svgElement.style.transform = `rotateZ(${anguloFinal}deg)`;
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

        window.map.on('rotatestart', activarModoMovimiento);
        window.map.on('dragstart', activarModoMovimiento);
        window.map.on('zoomstart', activarModoMovimiento);

        window.map.on('rotateend', desactivarModoMovimiento);
        window.map.on('dragend', desactivarModoMovimiento);
        window.map.on('zoomend', desactivarModoMovimiento);

        // Cuando el mapa rota manualmente, re-renderizamos el icono al instante
        // con el último ángulo conocido para que siempre apunte en la dirección
        // correcta del mundo real sin esperar al siguiente tick del giroscopio.
        window.map.on('rotate', () => {
            if (ultimoAnguloRenderizado !== -1) {
                actualizarRotacionIcono(ultimoAnguloRenderizado);
            }
        });
    }
});