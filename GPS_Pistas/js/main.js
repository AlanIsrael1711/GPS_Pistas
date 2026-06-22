// =======================================================
// main.js - GPS, Sockets, Motor VECTORIAL y Brújula de Rotación
// =======================================================

const socket = io();
const marcadores = {};
let primerAjuste = true;
let trayectoria = null;
let marcador = null; 

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
        const iconoPropio = (window.iconos && window.iconos.miUbicacion) ? window.iconos.miUbicacion : new L.Icon.Default();
        const iconoDestino = (window.iconos && window.iconos.destinoTemporal) ? window.iconos.destinoTemporal : new L.Icon.Default();
        const iconoAsignar = (id === socket.id) ? iconoPropio : iconoDestino;
        
        marcadores[id] = L.marker([lat, lng], { icon: iconoAsignar }).addTo(capaDestino);
        
        if (id === socket.id && marcador) window.enfocarUsuario();
    }

    if (id === socket.id && primerAjuste) {
        window.map.flyTo([lat, lng], 16, { animate: true, duration: 2 });
        primerAjuste = false;
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
    const miPosicion = marcadores[socket.id];
    if (miPosicion && window.map) {
        window.map.flyTo(miPosicion.getLatLng(), 18, { animate: true, duration: 1.5 });
        const btnEnfoque = document.getElementById('btnEnfocarGps');
        if (btnEnfoque) btnEnfoque.style.display = 'none';
    }
};

// =======================================================
// 7. FILTROS, BRÚJULA Y ROTACIÓN AUTOMÁTICA DEL MAPA
// =======================================================

// --- Variables para control de Rotación Matemática ---
let anguloObjetivo = null; // El ángulo crudo del sensor
let anguloActual = 0;      // El ángulo suavizado y filtrado
let modoAutoRotacion = false; 

// Notificación dinámica (Toast Inyectado por JS)
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
    }, 3000);
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
        window.map.on('dragstart', () => { btnEnfoque.style.display = 'block'; });
        btnEnfoque.addEventListener('click', () => { window.enfocarUsuario(); inicializarBrujula(); });
    }

    const btnBrujula = document.getElementById('btnBrujula');
    if (btnBrujula) {
        btnBrujula.addEventListener('click', () => {
            modoAutoRotacion = !modoAutoRotacion;
            
            if (modoAutoRotacion) {
                // MANTENER AZUL
                btnBrujula.classList.remove('bg-white');
                btnBrujula.classList.add('bg-primary');
                btnBrujula.innerHTML = '<i class="bi bi-compass-fill fs-4 text-white"></i>';
                
                mostrarNotificacion("Utilizando giroscopio");
                
                if (window.map && window.map.setBearing) {
                    window.map.setBearing(anguloActual);
                }
            } else {
                // REGRESAR A BLANCO
                btnBrujula.classList.remove('bg-primary');
                btnBrujula.classList.add('bg-white');
                btnBrujula.innerHTML = '<i class="bi bi-compass fs-4 text-dark"></i>';
                
                if (window.map && window.map.setBearing) {
                    window.map.setBearing(0);
                }
            }
        });
    }

    inicializarBrujula();
    requestAnimationFrame(bucleSuavizadoGiroscopio); // Iniciar el motor matemático
});

function inicializarBrujula() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(p => { if (p === 'granted') escucharOrientacion(); }).catch(console.error);
    } else escucharOrientacion();
}

function escucharOrientacion() {
    window.addEventListener('deviceorientationabsolute', handlerOrientacion, true);
    window.addEventListener('deviceorientation', handlerOrientacion, true);
}

// Recibe la señal pura pero NO actualiza el mapa, solo actualiza el objetivo
function handlerOrientacion(event) {
    let heading = event.webkitCompassHeading ? event.webkitCompassHeading : (event.alpha !== null ? 360 - event.alpha : null);
    if (heading !== null) {
        if (anguloObjetivo === null) anguloActual = heading; // El primer golpe es instantáneo
        anguloObjetivo = heading;
    }
}

// Bucle hiperfluido (60 fps) que filtra el ruido del giroscopio
let ultimoAnguloRenderizado = -1;

function bucleSuavizadoGiroscopio() {
    if (anguloObjetivo !== null) {
        let diferencia = anguloObjetivo - anguloActual;

        // Regla matemática para no dar giros completos cuando pasa del grado 359 al grado 1
        while (diferencia > 180) diferencia -= 360;
        while (diferencia < -180) diferencia += 360;

        // ZONA MUERTA: Si el temblor es menor a 0.5 grados, lo ignoramos por completo
        if (Math.abs(diferencia) > 0.5) {
            
            // Factor 0.08: Se mueve el 8% de la distancia por fotograma (súper fluido y "pesado")
            anguloActual += diferencia * 0.08; 
            
            if (anguloActual < 0) anguloActual += 360;
            if (anguloActual >= 360) anguloActual -= 360;
            
            // Redondear a 1 decimal salva muchísimo procesamiento de la tarjeta gráfica
            let anguloFinal = Math.round(anguloActual * 10) / 10;

            if (anguloFinal !== ultimoAnguloRenderizado) {
                actualizarRotacionIcono(anguloFinal);
                
                if (modoAutoRotacion && window.map && window.map.setBearing) {
                    window.map.setBearing(anguloFinal);
                }
                ultimoAnguloRenderizado = anguloFinal;
            }
        }
    }
    requestAnimationFrame(bucleSuavizadoGiroscopio);
}

function actualizarRotacionIcono(angulo) {
    const miMarcador = marcadores[socket.id];
    if (miMarcador && miMarcador._icon) {
        const currentTransform = miMarcador._icon.style.transform;
        if (!currentTransform) return;
        const baseTransform = currentTransform.replace(/ rotateZ\([^)]+\)/g, '');
        // El movimiento ya es fluido por la matemática en JS, quitamos las transiciones de CSS para no duplicar el trabajo
        miMarcador._icon.style.transition = 'none'; 
        miMarcador._icon.style.transform = `${baseTransform} rotateZ(${angulo}deg)`;
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