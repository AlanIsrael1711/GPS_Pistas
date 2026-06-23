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
// 7. FILTROS, BRÚJULA ULTRA-ESTABLE Y ROTACIÓN AUTOMÁTICA
// =======================================================

// Alineado a la cámara trasera del dispositivo.
// En Android portrait, la cámara trasera queda a 0° del eje del dispositivo,
// pero el eje de referencia de deviceorientation difiere según fabricante.
// 0 = sin offset (Pixel, Samsung reciente); ajusta a -90 o 90 si el cono apunta
// al lado equivocado en tu dispositivo específico.
const CALIBRACION_FRENTE = 0; 

// Bandera para saber si ya recibimos un evento "absolute" (más preciso)
let usandoAbsoluto = false;

let anguloCrudo = null;    
let anguloSuavizado = null;
let modoAutoRotacion = false; 
let ultimoAnguloRenderizado = -1;

function mostrarNotificacion(mensaje) {
    let toast = document.getElementById('toast-giroscopio');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-giroscopio';
        toast.className = 'shadow-lg';
        toast.style.cssText = 'position: fixed; top: 100px; left: 50%; transform: translateX(-50%) scale(0.95); background-color: #0d6efd; color: white; padding: 10px 20px; border-radius: 30px; font-weight: 600; font-size: 14px; z-index: 9999; opacity: 0; pointer-events: none; transition: opacity 0.4s ease, transform 0.4s ease; display: flex; align-items: center; gap: 8px;';
        document.body.appendChild(toast);
    }
    
    toast.innerHTML = `<i class="bi bi-compass-fill"></i> ${mensaje}`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) scale(1)';

    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) scale(0.95)';
    }, 1500); 
}

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
        btnEnfoque.addEventListener('click', () => { window.enfocarUsuario(); inicializarBrujula(); });
    }

    const btnBrujula = document.getElementById('btnBrujula');
    if (btnBrujula) {
        btnBrujula.addEventListener('click', () => {
            modoAutoRotacion = !modoAutoRotacion;
            
            if (modoAutoRotacion) {
                btnBrujula.classList.remove('bg-white');
                btnBrujula.classList.add('bg-primary');
                btnBrujula.innerHTML = '<i class="bi bi-compass-fill fs-4 text-white"></i>';
                mostrarNotificacion("Rotación de mapa activada");
                window.enfocarUsuario();
            } else {
                btnBrujula.classList.remove('bg-primary');
                btnBrujula.classList.add('bg-white');
                btnBrujula.innerHTML = '<i class="bi bi-compass fs-4 text-dark"></i>';
                
                // Devolvemos el mapa al norte y forzamos re-render del icono
                // con el ángulo actual para que no quede "congelado" en 0°.
                if (window.map && window.map.setBearing) window.map.setBearing(0);
                if (anguloSuavizado !== null) actualizarRotacionIcono(Math.round(anguloSuavizado));
                ultimoAnguloRenderizado = -1; 
            }
        });
    }

    inicializarBrujula();
    requestAnimationFrame(bucleSuavizadoYRotacion);
});

function inicializarBrujula() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(p => { 
            if (p === 'granted') escucharOrientacion(); 
            else alert("Se requiere acceso al giroscopio para orientar el mapa.");
        }).catch(console.error);
    } else escucharOrientacion();
}

function escucharOrientacion() {
    // Registramos primero el evento absoluto (más preciso, disponible en Chrome/Android).
    window.addEventListener('deviceorientationabsolute', (e) => {
        usandoAbsoluto = true;
        handlerOrientacion(e);
    }, true);

    // El evento genérico solo actúa si no hemos recibido el absoluto todavía
    // (ej: Safari iOS que no emite 'deviceorientationabsolute').
    window.addEventListener('deviceorientation', (e) => {
        if (!usandoAbsoluto) handlerOrientacion(e);
    }, true);
}

function handlerOrientacion(event) {
    let heading;

    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        // iOS Safari: ya entrega el heading respecto al norte magnético con la
        // cámara trasera como frente (portrait). No necesita inversión.
        heading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
        // Android con deviceorientationabsolute o deviceorientation:
        // alpha = ángulo que el eje Y del dispositivo forma con el norte magnético.
        // En portrait con pantalla hacia arriba, la cámara trasera apunta en
        // dirección -Y → el heading real es (360 - alpha).
        heading = (360 - event.alpha) % 360;
    }

    if (heading !== undefined && heading !== null) {
        heading = ((heading + CALIBRACION_FRENTE) % 360 + 360) % 360;
        anguloCrudo = heading;
        if (anguloSuavizado === null) anguloSuavizado = heading;
    }
}

// =======================================================
// [CORE] FILTRO DE ZONA MUERTA EXTREMA (Estilo Waze/Maps)
// =======================================================
function bucleSuavizadoYRotacion() {
    if (anguloCrudo !== null && anguloSuavizado !== null) {
        
        let diferencia = anguloCrudo - anguloSuavizado;
        while (diferencia > 180) diferencia -= 360;
        while (diferencia < -180) diferencia += 360;

        // Fricción adaptativa: movimientos pequeños (ruido del giroscopio) se absorben
        // casi por completo; giros reales (>20°) se aplican más rápido para no sentirse lentos.
        let suavidad = 0.012;           // reposo / ruido: muy suave
        if (Math.abs(diferencia) > 20) suavidad = 0.055; // giro intencional: respuesta más ágil
        else if (Math.abs(diferencia) > 8) suavidad = 0.025; // giro moderado

        anguloSuavizado += diferencia * suavidad; 
        
        if (anguloSuavizado < 0) anguloSuavizado += 360;
        if (anguloSuavizado >= 360) anguloSuavizado -= 360;
        
        // ZONA MUERTA: el mapa/icono solo se repinta si el cambio acumulado
        // supera 2.5°, eliminando el temblor visual por ruido del sensor.
        let difRender = anguloSuavizado - ultimoAnguloRenderizado;
        while (difRender > 180) difRender -= 360;
        while (difRender < -180) difRender += 360;

        if (Math.abs(difRender) >= 2.5 || ultimoAnguloRenderizado === -1) {
            
            // Renderizamos EN GRADOS ENTEROS para que el motor CSS de Leaflet no se sature 
            // intentando pintar decimales y causar vibraciones ("tartamudeos").
            let anguloEntero = Math.round(anguloSuavizado);
            ultimoAnguloRenderizado = anguloEntero;

            if (modoAutoRotacion && window.map && window.map.setBearing) {
                // setBearing rota el mapa en sentido horario.
                // Para que la parte de arriba del mapa apunte hacia donde apunta
                // la cámara trasera (mismo frente que el icono), hay que girar el
                // mapa en sentido CONTRARIO al heading del dispositivo.
                // Ejemplo: dispositivo apunta al Este (90°) → mapa gira -90° para
                // que el Este quede arriba, igual que el cono del icono.
                window.map.setBearing(-anguloEntero);
                actualizarRotacionIcono(0); // el icono queda fijo apuntando arriba
            } else {
                actualizarRotacionIcono(anguloEntero);
            }
        }
    }
    requestAnimationFrame(bucleSuavizadoYRotacion);
}

function actualizarRotacionIcono(angulo) {
    const miMarcador = marcadores[socket.id];
    if (miMarcador && miMarcador._icon) {
        const svgElement = miMarcador._icon.querySelector('svg');
        if (svgElement) {
            svgElement.style.transform = `rotateZ(${angulo}deg)`;
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
    }
});