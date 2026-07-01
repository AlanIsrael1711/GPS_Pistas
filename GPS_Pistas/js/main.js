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
// ICONOS VECTORIALES (Usuario y Destino)
// =======================================================
const iconoUsuarioConoSVG = `
<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <path d="M 20 20 L 5 0 A 20 20 0 0 1 35 0 Z" fill="rgba(37, 99, 235, 0.35)" />
  <circle cx="20" cy="20" r="8" fill="white" />
  <circle cx="20" cy="20" r="6" fill="#2563eb" />
</svg>
`;

const iconoUsuarioGoogleMaps = L.divIcon({
    className: 'marcador-usuario-direccion',
    html: iconoUsuarioConoSVG,
    iconSize: [40, 40],
    iconAnchor: [20, 20] 
});

const iconoDestinoTemporalSVG = `
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 0c-5.523 0-10 4.477-10 10 0 7.5 10 22 10 22s10-14.5 10-22c0-5.523-4.477-10-10-10z" fill="#ef4444"/>
  <circle cx="16" cy="10" r="4" fill="white"/>
</svg>
`;

const iconoDestinoTemporalPersonalizado = L.divIcon({
    className: 'marcador-destino-temporal',
    html: iconoDestinoTemporalSVG,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
});

const styleIcono = document.createElement('style');
styleIcono.innerHTML = `
    .marcador-usuario-direccion svg { transition: none !important; will-change: transform; }
    .marcador-destino-temporal svg { filter: drop-shadow(0px 4px 3px rgba(0,0,0,0.3)); }
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

// [MODIFICADO] Apuntamos a tu nuevo archivo que contiene los pesos
fetch('/resources/red_final_con_pesos.geojson')
    .then(r => r.json())
    .then(geojson => {
        let nodosTemp = [];
        turf.featureEach(geojson, function(feature) {
            if (feature.geometry.type === 'LineString') {
                const coords = feature.geometry.coordinates;
                
                // [MODIFICACIÓN DE PESOS] Extraemos la propiedad 'peso'. Si no existe, vale 1.0 por defecto.
                const pesoDeLaLinea = feature.properties.peso || 1.0;

                for (let i = 0; i < coords.length - 1; i++) {
                    const p1 = coords[i]; const p2 = coords[i+1];
                    const id1 = `${p1[0]},${p1[1]}`; const id2 = `${p2[0]},${p2[1]}`;
                    
                    // Calculamos la distancia física real
                    const distReal = turf.distance(turf.point(p1), turf.point(p2));
                    
                    // [MODIFICACIÓN DE PESOS] El costo final para el algoritmo es la distancia multiplicada por el peso
                    const costoFinal = distReal * pesoDeLaLinea;

                    if (!grafoRutas.has(id1)) { grafoRutas.set(id1, []); nodosTemp.push(turf.point(p1, {id: id1})); }
                    if (!grafoRutas.has(id2)) { grafoRutas.set(id2, []); nodosTemp.push(turf.point(p2, {id: id2})); }

                    // Guardamos la conexión usando el costoFinal, no solo la distancia
                    grafoRutas.get(id1).push({ target: id2, cost: costoFinal });
                    grafoRutas.get(id2).push({ target: id1, cost: costoFinal }); 
                }
            }
        });
        nodosCaminos = turf.featureCollection(nodosTemp);
        console.log(`Grafo vial cargado: ${grafoRutas.size} nodos listos con pesos integrados.`);
    }).catch(err => console.error("Error cargando red vascular:", err));

// =======================================================
// 3. GEOLOCALIZACIÓN Y SOCKETS (AISLADO PARA 1 USUARIO)
// =======================================================
let ultimoEnvioGps = 0;
const LIMITE_LATENCIA_MS = 2000; 

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (pos) => {
            const ahora = Date.now();
            const { latitude, longitude } = pos.coords;
            
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

socket.on('dibujar-ubicacion', (data) => {
    // Si el ID no es estrictamente el tuyo, lo ignora automáticamente.
    if (data.id && data.id !== socket.id) return; 

    const { lat, lng } = data;
    const capaDestino = (window.capas && window.capas.usuarios) ? window.capas.usuarios : window.map;

    if (miMarcadorLocal) {
        miMarcadorLocal.setLatLng([lat, lng]);
        if (marcador && trayectoria) trazarRutaInteligente(miMarcadorLocal.getLatLng(), marcador.getLatLng());
    } else {
        miMarcadorLocal = L.marker([lat, lng], { icon: iconoUsuarioGoogleMaps }).addTo(capaDestino);
        if (marcador) window.enfocarUsuario();
    }

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

// Al reconectarse (ej. si apagas la pantalla), eliminamos tu marcador anterior para no duplicarlo
socket.on('connect', () => {
    if (miMarcadorLocal && window.map) {
        const capaDestino = (window.capas && window.capas.usuarios) ? window.capas.usuarios : window.map;
        try { capaDestino.removeLayer(miMarcadorLocal); } catch(_) {}
        miMarcadorLocal = null;
    }
    primerAjuste = true;
    siguiendoUsuario = false;
});

// =======================================================
// 4. INTERACCIÓN Y SELECCIÓN DE DESTINOS
// =======================================================
let marcadorTemp = null;      
let nombreLugarTemporal = ""; 
let trazandoRuta = false; 

let _ultimoDragEnd = 0;
window.map.on('dragend', () => { _ultimoDragEnd = Date.now(); });

window.map.on('click', function(e) {
    if (Date.now() - _ultimoDragEnd < 300) return;
    const panel = document.getElementById('panelDestino');
    if (!panel.classList.contains('oculto')) {
        panel.classList.add('oculto');
        if (marcadorTemp) { window.map.removeLayer(marcadorTemp); marcadorTemp = null; }
        return; 
    }
    nombreLugarTemporal = "Punto en el Mapa"; 
    procesarSeleccionTemporal(e.latlng.lat, e.latlng.lng, nombreLugarTemporal);
});

window.irHacia = function(lat, lng, nombreLugar) {
    nombreLugarTemporal = nombreLugar; 
    procesarSeleccionTemporal(lat, lng, nombreLugarTemporal);
};

function procesarSeleccionTemporal(lat, lng, nombre) {
    // Si la selección viene de un POI conocido (zona de interés, edificio, terminal),
    // zonaPermitidaTemporal ya está fijado y no necesitamos validar contra el perímetro.
    // Solo validamos perímetro cuando el usuario toca un punto libre en el mapa.
    if (!window.zonaPermitidaTemporal && window.geojsonDataPrincipalPermitida) {
        const puntoClick = turf.point([lng, lat]);
        const perimetro = window.geojsonDataPrincipalPermitida.features
            ? window.geojsonDataPrincipalPermitida.features[0]
            : window.geojsonDataPrincipalPermitida;
        if (!turf.booleanPointInPolygon(puntoClick, perimetro)) {
            alert("Destino fuera de límite.");
            return;
        }
    }

    if (typeof window.esUbicacionValida === 'function' && !window.esUbicacionValida(lat, lng)) {
        alert("Punto Inválido: Área restringida."); return;
    }

    if (marcadorTemp) marcadorTemp.setLatLng([lat, lng]);
    else marcadorTemp = L.marker([lat, lng], { icon: iconoDestinoTemporalPersonalizado }).addTo(window.map);

    document.getElementById('bs-titulo').innerText = nombre;
    document.getElementById('panelDestino').classList.remove('oculto');
}

window.cerrarPanelDestino = function() {
    document.getElementById('panelDestino').classList.add('oculto');
    if (marcadorTemp) { window.map.removeLayer(marcadorTemp); marcadorTemp = null; }
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
function trazarRutaInteligente(inicioGPS, finGPS) {
    if (!grafoRutas.size || !nodosCaminos) {
        dibujarLineaEnMapa([[inicioGPS.lat, inicioGPS.lng], [finGPS.lat, finGPS.lng]]); return;
    }

    const startId = turf.nearestPoint(turf.point([inicioGPS.lng, inicioGPS.lat]), nodosCaminos).properties.id;
    const endId = turf.nearestPoint(turf.point([finGPS.lng, finGPS.lat]), nodosCaminos).properties.id;

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
            let penalizacionAdicional = 1.0;
            if (window.evitarPistasVuelo && typeof window.esZonaPuente === 'function') {
                const [lng, lat] = v.target.split(',').map(Number);
                if (!window.esZonaPuente(lat, lng) && typeof window.esUbicacionValida === 'function' && !window.esUbicacionValida(lat, lng)) {
                    penalizacionAdicional = 9999; 
                }
            }

            // [MODIFICACIÓN DE PESOS] El v.cost que viene del grafo ya incluye el peso del GeoJSON
            // Aquí solo se multiplica por posibles filtros visuales (evitar pistas) adicionales.
            const tentativeG = currG + (v.cost * penalizacionAdicional);
            const neighborG = gScores.has(v.target) ? gScores.get(v.target) : Infinity;

            if (tentativeG < neighborG) {
                parents.set(v.target, currId);
                gScores.set(v.target, tentativeG);
                const pC = v.target.split(',').map(Number);
                const pF = endId.split(',').map(Number);
                openHeap.push(v.target, tentativeG + turf.distance(turf.point(pC), turf.point(pF)));
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
            color: '#2563eb', weight: 5, opacity: 0.8, dashArray: '10, 15', lineCap: 'round', smoothFactor: 0 
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
// 7. GIROSCOPIO (SÓLO PARA ICONO)
// =======================================================
const CALIBRACION_FRENTE = 0;
let usandoAbsoluto = false;
let anguloCrudo = null;
let anguloSuavizado = null;
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
    toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) scale(1)';
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) scale(0.95)'; }, 1500); 
}

const chkEvitarPistas = document.getElementById('chkEvitarPistas');
if (chkEvitarPistas) {
    chkEvitarPistas.addEventListener('change', function(e) {
        window.evitarPistasVuelo = e.target.checked;
        if (window.capaPistasVuelo) {
            window.capaPistasVuelo.setStyle({ fillOpacity: window.evitarPistasVuelo ? 0.2 : 0.05, color: window.evitarPistasVuelo ? "#dc3545" : "#6c757d" });
        }
        if (miMarcadorLocal && marcador) trazarRutaInteligente(miMarcadorLocal.getLatLng(), marcador.getLatLng());
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const btnEnfoque = document.getElementById('btnEnfocarGps');
    if (btnEnfoque && window.map) {
        window.map.on('dragstart', () => { siguiendoUsuario = false; btnEnfoque.style.display = 'flex'; });
        btnEnfoque.addEventListener('click', () => { window.enfocarUsuario(); });
    }

    const btnBrujula = document.getElementById('btnBrujula');
    if (btnBrujula) {
        btnBrujula.addEventListener('click', () => {
            // Efecto visual
            btnBrujula.classList.add('bg-primary');
            setTimeout(() => { btnBrujula.classList.remove('bg-primary'); }, 200);

            // Reorientación simple
            if (window.map && typeof window.map.setBearing === 'function') {
                window.map.setBearing(0, { animate: true, duration: 0.5 });
                mostrarNotificacion("Mapa orientado al Norte");
            }
        });
    }

    iniciarGiroscopio();
    requestAnimationFrame(bucleIconoSuave);
});

function iniciarGiroscopio() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(p => { if (p === 'granted') escucharOrientacion(); }).catch(console.error);
    } else escucharOrientacion();
}

function escucharOrientacion() {
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
        heading = ((heading + CALIBRACION_FRENTE) % 360 + 360) % 360;
        anguloCrudo = heading;
        if (anguloSuavizado === null) anguloSuavizado = heading;
    }
}

function bucleIconoSuave() {
    if (anguloCrudo !== null && anguloSuavizado !== null) {
        let diferencia = anguloCrudo - anguloSuavizado;
        while (diferencia >  180) diferencia -= 360;
        while (diferencia < -180) diferencia += 360;
        let alpha = 0.012; 
        const abs = Math.abs(diferencia);
        if (abs > 20) alpha = 0.055; else if (abs > 8) alpha = 0.025;
        anguloSuavizado += diferencia * alpha;
        if (anguloSuavizado < 0) anguloSuavizado += 360;
        if (anguloSuavizado >= 360) anguloSuavizado -= 360;
        let difRender = anguloSuavizado - ultimoAnguloRenderizado;
        while (difRender > 180) difRender -= 360;
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
        const svgElement = miMarcadorLocal._icon.querySelector('svg');
        if (svgElement) {
            const bearing = (window.map && typeof window.map.getBearing === 'function') ? window.map.getBearing() : 0;
            const anguloCSS = ((angulo - bearing) % 360 + 360) % 360;
            svgElement.style.transform = `rotateZ(${anguloCSS}deg)`;
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

        function activarModoMovimiento() { mapaDOM.classList.add('mapa-en-movimiento'); clearTimeout(temporizadorMovimiento); }
        function desactivarModoMovimiento() { temporizadorMovimiento = setTimeout(() => { mapaDOM.classList.remove('mapa-en-movimiento'); }, 200); }

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