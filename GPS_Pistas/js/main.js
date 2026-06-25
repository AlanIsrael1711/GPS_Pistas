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
        const iconoPropio = (window.iconos && window.iconos.miUbicacion) ? window.iconos.miUbicacion : new L.Icon.Default();
        miMarcadorLocal = L.marker([lat, lng], { icon: iconoPropio }).addTo(capaDestino);
        if (marcador) window.enfocarUsuario();
    }

    if (primerAjuste) {
        window.map.flyTo([lat, lng], 16, { animate: true, duration: 2 });
        primerAjuste = false;
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

let anguloActual = 0;
// modoAutoRotacion eliminado: el mapa nunca rota automáticamente con el giroscopio.

document.addEventListener('DOMContentLoaded', () => {
    const btnEnfoque = document.getElementById('btnEnfocarGps');
    if (btnEnfoque && window.map) {
        window.map.on('dragstart', () => { btnEnfoque.style.display = 'block'; });
        btnEnfoque.addEventListener('click', () => { window.enfocarUsuario(); inicializarBrujula(); });
    }

    // Brújula: al presionarla, hace el efecto visual de clic y luego
    // regresa el mapa a la orientación norte original (bearing 0).
    const btnBrujula = document.getElementById('btnBrujula');
    if (btnBrujula) {
        btnBrujula.addEventListener('click', () => {
            // 1. Efecto visual: Se pone azul al instante de presionarlo
            btnBrujula.classList.remove('bg-white');
            btnBrujula.classList.add('bg-primary');
            btnBrujula.innerHTML = '<i class="bi bi-compass fs-4 text-white"></i>';

            // 2. Regresa a blanco después de 200ms (dando la sensación de un clic físico)
            setTimeout(() => {
                btnBrujula.classList.remove('bg-primary');
                btnBrujula.classList.add('bg-white');
                btnBrujula.innerHTML = '<i class="bi bi-compass fs-4 text-dark"></i>';
            }, 200);

            // 3. Lógica interna: Regresar el mapa a la orientación norte (bearing 0)
            if (window.map && typeof window.map.setBearing === 'function') {
                window.map.setBearing(0, { animate: true, duration: 0.5 });
            }
        });
    }

    inicializarBrujula();
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

function handlerOrientacion(event) {
    let heading = event.webkitCompassHeading ? event.webkitCompassHeading : (event.alpha !== null ? 360 - event.alpha : null);
    if (heading !== null) {
        anguloActual = heading;
        actualizarRotacionIcono();
        // El mapa ya no rota automáticamente con el giroscopio.
    }
}

function actualizarRotacionIcono() {
    if (miMarcadorLocal && miMarcadorLocal._icon) {
        const currentTransform = miMarcadorLocal._icon.style.transform;
        if (!currentTransform) return;
        const baseTransform = currentTransform.replace(/ rotateZ\([^)]+\)/g, '');
        miMarcadorLocal._icon.style.transform = `${baseTransform} rotateZ(${anguloActual}deg)`;
        miMarcadorLocal._icon.style.transition = 'transform 0.15s ease-out';
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

        window.map.on('rotate', () => {
            actualizarRotacionIcono();
        });
    }
});