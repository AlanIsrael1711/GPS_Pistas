// =======================================================
// main.js - GPS, Sockets, Motor VECTORIAL y Brújula Avanzada
// =======================================================

const socket = io();
const marcadores = {};
let primerAjuste = true;
let trayectoria = null;
let marcador = null; 

// =======================================================
// [NUEVO] ICONO DEL USUARIO (Estilo Google Maps con Cono)
// =======================================================
// SVG de un punto azul con un cono de dirección apuntando hacia arriba (Norte relativo)
const iconoUsuarioConoSVG = `
<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <!-- Cono de visión (apuntando hacia arriba) -->
  <path d="M 20 20 L 5 0 A 20 20 0 0 1 35 0 Z" fill="rgba(37, 99, 235, 0.3)" />
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
    iconAnchor: [20, 20] // El centro exacto del punto azul
});

// Aseguramos que el CSS para el icono no tenga transiciones que estorben
const styleIcono = document.createElement('style');
styleIcono.innerHTML = `
    .marcador-usuario-direccion {
        /* Transición hiper-rápida solo para el giro del cono en modo libre */
        transition: transform 0.05s linear !important;
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
        // [MODIFICADO] Asignar siempre el nuevo icono con cono al usuario local
        const iconoDestino = (window.iconos && window.iconos.destinoTemporal) ? window.iconos.destinoTemporal : new L.Icon.Default();
        const iconoAsignar = (id === socket.id) ? iconoUsuarioGoogleMaps : iconoDestino;
        
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

// --- Variables Matemáticas para Orientación ---
let anguloCrudo = null;    // Valor directo del sensor
let anguloSuavizado = 0;   // Valor filtrado que usamos
let offsetBrújula = 0;     // Para calibrar el "Frente" del teléfono
let modoAutoRotacion = false; 

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
                btnBrujula.classList.remove('bg-white');
                btnBrujula.classList.add('bg-primary');
                btnBrujula.innerHTML = '<i class="bi bi-compass-fill fs-4 text-white"></i>';
                mostrarNotificacion("Rotación de mapa activada");
                
                // Forzar enfoque inmediato al activar
                window.enfocarUsuario();

            } else {
                btnBrujula.classList.remove('bg-primary');
                btnBrujula.classList.add('bg-white');
                btnBrujula.innerHTML = '<i class="bi bi-compass fs-4 text-dark"></i>';
                
                // Si desactivamos, regresamos el mapa al Norte absoluto
                if (window.map && window.map.setBearing) {
                    window.map.setBearing(0);
                }
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
    window.addEventListener('deviceorientationabsolute', handlerOrientacion, true);
    // Fallback para iOS
    window.addEventListener('deviceorientation', handlerOrientacion, true);
}

// =======================================================
// [MODIFICADO] PROCESAMIENTO CRIPTOGRÁFICO DE ORIENTACIÓN
// =======================================================
function handlerOrientacion(event) {
    let heading;
    
    // iOS usa webkitCompassHeading (Norte Verdadero/Magnético)
    if (event.webkitCompassHeading) {
        heading = event.webkitCompassHeading;
    } 
    // Android usa alpha (0 = Este, así que ajustamos)
    else if (event.alpha !== null) {
        // En navegadores web, event.alpha=0 suele apuntar al Este o a la posición inicial.
        // La fórmula estandar para convertir 'alpha' a un "Norte" (Heading) aproximado en Android:
        heading = 360 - event.alpha;
        
        // Dependiendo del teléfono, a veces necesitamos rotar la lectura 90 grados
        // Si notas que apuntas al Norte y el cono apunta al Oeste, cambia este valor a 90 o -90
        offsetBrújula = 0; 
        
        heading = (heading + offsetBrújula) % 360;
    }

    if (heading !== undefined && heading !== null) {
        if (anguloCrudo === null) anguloSuavizado = heading; // Primer lectura instantánea
        anguloCrudo = heading;
    }
}

// =======================================================
// [MODIFICADO] BUCLE DE FILTRADO Y RENDERIZADO
// =======================================================
let ultimoAnguloRenderizado = -1;

function bucleSuavizadoYRotacion() {
    if (anguloCrudo !== null) {
        // 1. Encontrar el camino más corto en los 360 grados
        let diferencia = anguloCrudo - anguloSuavizado;
        while (diferencia > 180) diferencia -= 360;
        while (diferencia < -180) diferencia += 360;

        // 2. ZONA MUERTA SEVERA: Ignorar temblores menores a 1.5 grados (estabiliza brutalmente)
        if (Math.abs(diferencia) > 1.5) {
            
            // 3. LOW-PASS FILTER: Nos movemos solo el 5% hacia el objetivo (muy pesado y estable)
            anguloSuavizado += diferencia * 0.05; 
            
            // Normalizar a 0-360
            if (anguloSuavizado < 0) anguloSuavizado += 360;
            if (anguloSuavizado >= 360) anguloSuavizado -= 360;
            
            // 4. REDONDEO: Para evitar que el CSS repinte constantemente por 0.1 grados
            let anguloFinal = Math.round(anguloSuavizado);

            if (anguloFinal !== ultimoAnguloRenderizado) {
                
                // CASO A: Rotación Automática (Modo Waze)
                if (modoAutoRotacion && window.map && window.map.setBearing) {
                    // El mapa gira en dirección OPUESTA para que el "frente" siempre quede arriba de la pantalla
                    // Al mapa le pasamos el ángulo inverso para girarlo.
                    window.map.setBearing(anguloFinal);
                    
                    // Como el mapa gira para mantener tu frente "Arriba", el cono de visión SIEMPRE
                    // debe apuntar a 0 grados (Arriba de la pantalla del celular).
                    actualizarRotacionIcono(0);
                } 
                // CASO B: Modo Libre (Mapa Quieto)
                else {
                    // El mapa está quieto (Norte Arriba).
                    // El cono de visión es el que gira para señalar hacia dónde apunta el teléfono.
                    actualizarRotacionIcono(anguloFinal);
                }

                ultimoAnguloRenderizado = anguloFinal;
            }
        }
    }
    requestAnimationFrame(bucleSuavizadoYRotacion);
}

// Gira solo el divIcon del usuario
function actualizarRotacionIcono(angulo) {
    const miMarcador = marcadores[socket.id];
    if (miMarcador && miMarcador._icon) {
        // Encontramos el SVG directamente
        const svgElement = miMarcador._icon.querySelector('svg');
        if (svgElement) {
            // Aplicamos la rotación directamente al SVG. 
            // Esto es más limpio y evita problemas con la posición del contenedor de Leaflet.
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