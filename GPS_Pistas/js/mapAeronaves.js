// Aeronaves en vivo: una sola conexión por navegador, caché local y deltas.
(function iniciarCapaAeronaves() {
    'use strict';

    const ENDPOINT = '/api/vuelos-live';
    const CACHE_KEY = 'gpsPistasRadarUltimoEstadoV2';
    const ESTADOS_EMERGENCIA = new Set(['EMERGENCIA', 'SECUESTRO', 'FALLA_RADIO']);
    const archivosPorTipo = {
        HELICOPTERO: 'helicoptero.svg',
        MILITAR: 'militar.svg',
        CARGO: 'cargo.svg',
        LIGERO: 'ligero.svg'
    };

    const aeronavesEnMapa = new Map();
    const capaAeronaves = L.layerGroup().addTo(window.map);
    const socket = window.gpsSocket || io({ transports: ['websocket', 'polling'] });
    const ModeloOrientacion = window.GPSOrientationModel;
    let actualizadoEn = null;
    let estadoObsoleto = true;
    let frameRotacion = null;
    let estadoRecibido = false;

    window.gpsSocket = socket;
    window.capaAeronaves = capaAeronaves;
    window.aeronavesEnMapa = aeronavesEnMapa;

    if (!ModeloOrientacion) {
        throw new Error('No se cargó orientationModel.js antes de mapAeronaves.js');
    }

    function texto(valor, respaldo = '--') {
        if (valor === null || valor === undefined) return respaldo;
        return String(valor).trim() || respaldo;
    }

    function numero(valor) {
        if (valor === null || valor === undefined || valor === '') return null;
        const resultado = Number(valor);
        return Number.isFinite(resultado) ? resultado : null;
    }

    function normalizarVuelo(vuelo) {
        const id = texto(vuelo && vuelo.id, '');
        const lat = numero(vuelo && vuelo.lat);
        const lng = numero(vuelo && vuelo.lng);
        if (!id || lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

        return {
            id,
            callsign: texto(vuelo.callsign, ''),
            lat,
            lng,
            track: numero(vuelo.track),
            speed: numero(vuelo.speed),
            alt: numero(vuelo.alt),
            status: texto(vuelo.status, 'DESCONOCIDO').toUpperCase(),
            pista: texto(vuelo.pista, ''),
            tipo: texto(vuelo.tipo, 'COMERCIAL').toUpperCase(),
            operacion: texto(vuelo.operacion, '').toUpperCase()
        };
    }

    function rutaIcono(tipo) {
        return `/resources/aeronaves/${archivosPorTipo[tipo] || 'avion.svg'}`;
    }

    function claseEstado(vuelo) {
        if (ESTADOS_EMERGENCIA.has(vuelo.status)) return 'aeronave-estado-emergencia';
        if (vuelo.operacion === 'A') return 'aeronave-estado-llegada';
        if (vuelo.operacion === 'D') return 'aeronave-estado-salida';
        if (vuelo.status === 'EN_TIERRA') return 'aeronave-estado-tierra';
        return 'aeronave-estado-normal';
    }

    function estadoLegible(estado) {
        return texto(estado).replaceAll('_', ' ').toLowerCase().replace(/^./, letra => letra.toUpperCase());
    }

    function agregarFila(contenedor, etiqueta, valor) {
        if (valor === null || valor === undefined || valor === '') return;
        const fila = document.createElement('div');
        fila.className = 'aeronave-popup-fila';
        const nombre = document.createElement('span');
        nombre.textContent = etiqueta;
        const dato = document.createElement('strong');
        dato.textContent = String(valor);
        fila.append(nombre, dato);
        contenedor.appendChild(fila);
    }

    function crearContenidoPopup(vuelo) {
        const contenedor = document.createElement('div');
        const titulo = document.createElement('h3');
        titulo.className = 'aeronave-popup-titulo';
        titulo.textContent = vuelo.callsign || 'Aeronave';
        const identificador = document.createElement('div');
        identificador.className = 'aeronave-popup-id';
        identificador.textContent = `HEX ${vuelo.id}`;
        contenedor.append(titulo, identificador);
        agregarFila(contenedor, 'Estado', estadoLegible(vuelo.status));
        agregarFila(contenedor, 'Altitud', vuelo.alt === null ? null : `${vuelo.alt.toLocaleString('es-MX')} ft`);
        agregarFila(contenedor, 'Velocidad', vuelo.speed === null ? null : `${vuelo.speed.toLocaleString('es-MX')} kt`);
        agregarFila(contenedor, 'Ubicación', vuelo.pista);
        return contenedor;
    }

    function rotacionEnPantalla(track) {
        const bearing = typeof window.map.getBearing === 'function' ? window.map.getBearing() : 0;
        return ModeloOrientacion.rumboEnPantalla(track, bearing);
    }

    function aplicarRotacion(entrada) {
        if (!entrada.img) return;
        const angulo = rotacionEnPantalla(entrada.ultimoTrack);
        if (angulo === null) {
            entrada.img.classList.add('aeronave-rumbo-desconocido');
            return;
        }
        entrada.img.classList.remove('aeronave-rumbo-desconocido');
        entrada.img.style.transform = `rotateZ(${angulo}deg)`;
    }

    function sincronizarMarcadorConMapa(entrada) {
        // leaflet-rotate mantiene los marcadores en un pane sin rotación y
        // recalcula su posición. update() fuerza ese cálculo en cada frame
        // táctil para que el avión nunca parezca quedarse pegado a la pantalla.
        if (entrada.marker && typeof entrada.marker.update === 'function') {
            entrada.marker.update();
        }
        aplicarRotacion(entrada);
    }

    function crearMarcador(vuelo) {
        const contenido = document.createElement('div');
        contenido.className = 'aeronave-marcador-contenido';
        const img = document.createElement('img');
        img.className = `aeronave-icono ${claseEstado(vuelo)}`;
        img.src = rutaIcono(vuelo.tipo);
        img.alt = '';
        img.draggable = false;
        contenido.appendChild(img);

        const marker = L.marker([vuelo.lat, vuelo.lng], {
            icon: L.divIcon({
                className: 'marcador-aeronave',
                html: contenido,
                iconSize: [36, 36],
                iconAnchor: [18, 18],
                popupAnchor: [0, -17]
            }),
            keyboard: true,
            riseOnHover: true,
            title: vuelo.callsign || `Aeronave ${vuelo.id}`
        }).addTo(capaAeronaves);

        marker.bindPopup(crearContenidoPopup(vuelo), {
            className: 'popup-aeronave',
            closeButton: true,
            autoPanPadding: [24, 24]
        });
        const entrada = { marker, img, datos: vuelo, ultimoTrack: vuelo.track };
        aeronavesEnMapa.set(vuelo.id, entrada);
        sincronizarMarcadorConMapa(entrada);
    }

    function actualizarMarcador(entrada, vuelo) {
        // Los mensajes ADS-B intermedios pueden no traer track. Conservamos el
        // último rumbo válido para que el avión no salte artificialmente al
        // norte y siga reaccionando al bearing del mapa.
        if (vuelo.track !== null) entrada.ultimoTrack = vuelo.track;
        entrada.datos = vuelo;
        entrada.marker.setLatLng([vuelo.lat, vuelo.lng]);
        entrada.marker.setPopupContent(crearContenidoPopup(vuelo));
        const nuevaRuta = rutaIcono(vuelo.tipo);
        if (!entrada.img.src.endsWith(nuevaRuta)) entrada.img.src = nuevaRuta;
        entrada.img.className = `aeronave-icono ${claseEstado(vuelo)}`;
        sincronizarMarcadorConMapa(entrada);
    }

    function aplicarActualizados(vuelos) {
        for (const crudo of vuelos || []) {
            const vuelo = normalizarVuelo(crudo);
            if (!vuelo) continue;
            const entrada = aeronavesEnMapa.get(vuelo.id);
            if (entrada) actualizarMarcador(entrada, vuelo);
            else crearMarcador(vuelo);
        }
    }

    function sincronizarEstado(vuelos) {
        const ids = new Set();
        for (const crudo of vuelos || []) {
            const vuelo = normalizarVuelo(crudo);
            if (!vuelo) continue;
            ids.add(vuelo.id);
            const entrada = aeronavesEnMapa.get(vuelo.id);
            if (entrada) actualizarMarcador(entrada, vuelo);
            else crearMarcador(vuelo);
        }
        for (const [id, entrada] of aeronavesEnMapa) {
            if (!ids.has(id)) {
                capaAeronaves.removeLayer(entrada.marker);
                aeronavesEnMapa.delete(id);
            }
        }
    }

    function eliminarIds(ids) {
        for (const id of ids || []) {
            const entrada = aeronavesEnMapa.get(String(id));
            if (!entrada) continue;
            capaAeronaves.removeLayer(entrada.marker);
            aeronavesEnMapa.delete(String(id));
        }
    }

    function guardarCache() {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                vuelos: [...aeronavesEnMapa.values()].map(entrada => entrada.datos),
                actualizadoEn
            }));
        } catch (_) {}
    }

    function cargarCache() {
        try {
            const cache = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (cache && Array.isArray(cache.vuelos)) {
                sincronizarEstado(cache.vuelos);
                actualizadoEn = cache.actualizadoEn || null;
                estadoObsoleto = true;
            }
        } catch (_) {}
    }

    function actualizarIndicador() {
        const indicador = document.getElementById('estadoDatosRadar');
        if (!indicador) return;
        const edad = actualizadoEn ? Date.now() - Date.parse(actualizadoEn) : Infinity;
        indicador.className = 'estado-datos-radar';

        if (!navigator.onLine) {
            indicador.classList.add('sin-conexion');
            indicador.textContent = aeronavesEnMapa.size ? 'Sin conexión · último radar guardado' : 'Sin conexión';
        } else if (!socket.connected) {
            indicador.classList.add('conectando');
            indicador.textContent = 'Conectando al radar…';
        } else if (!actualizadoEn || estadoObsoleto || edad > 45000) {
            indicador.classList.add('obsoleto');
            indicador.textContent = actualizadoEn ? 'Radar sin actualizar' : 'Radar sin datos';
        } else {
            indicador.classList.add('en-vivo');
            indicador.textContent = `Aeronaves en vivo · ${aeronavesEnMapa.size}`;
        }
        if (actualizadoEn) indicador.title = `Última actualización: ${new Date(actualizadoEn).toLocaleString('es-MX')}`;
    }

    function recibirEstado(payload) {
        const estado = Array.isArray(payload) ? { vuelos: payload } : (payload || {});
        if (!Array.isArray(estado.vuelos)) return;
        sincronizarEstado(estado.vuelos);
        actualizadoEn = estado.actualizadoEn || new Date().toISOString();
        estadoObsoleto = Boolean(estado.obsoleto);
        estadoRecibido = true;
        guardarCache();
        actualizarIndicador();
    }

    function recibirDelta(delta) {
        if (!delta) return;
        aplicarActualizados(delta.actualizados);
        eliminarIds(delta.eliminados);
        actualizadoEn = delta.actualizadoEn || new Date().toISOString();
        estadoObsoleto = false;
        estadoRecibido = true;
        guardarCache();
        actualizarIndicador();
    }

    function capaHabilitada() {
        const checkbox = document.getElementById('chkAeronaves');
        return !checkbox || checkbox.checked;
    }

    function suscribir() {
        if (socket.connected && capaHabilitada() && !document.hidden) socket.emit('radar:suscribir');
    }

    function desuscribir() {
        if (socket.connected) socket.emit('radar:desuscribir');
    }

    async function consultarEstadoUnaVez() {
        if (!navigator.onLine || estadoRecibido) return;
        try {
            const respuesta = await fetch(ENDPOINT, { headers: { Accept: 'application/json' }, cache: 'no-store' });
            if (respuesta.ok) recibirEstado(await respuesta.json());
        } catch (_) {
            actualizarIndicador();
        }
    }

    socket.on('connect', () => {
        actualizarIndicador();
        suscribir();
    });
    socket.on('disconnect', actualizarIndicador);
    socket.on('radar:estado', recibirEstado);
    socket.on('radar:delta', recibirDelta);

    window.map.on('rotate', () => {
        if (frameRotacion !== null) return;
        frameRotacion = requestAnimationFrame(() => {
            for (const entrada of aeronavesEnMapa.values()) sincronizarMarcadorConMapa(entrada);
            frameRotacion = null;
        });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) desuscribir();
        else suscribir();
    });
    window.addEventListener('online', () => {
        actualizarIndicador();
        suscribir();
    });
    window.addEventListener('offline', actualizarIndicador);

    document.addEventListener('DOMContentLoaded', () => {
        const checkbox = document.getElementById('chkAeronaves');
        if (checkbox) {
            checkbox.addEventListener('change', event => {
                if (event.target.checked) {
                    capaAeronaves.addTo(window.map);
                    suscribir();
                } else {
                    window.map.removeLayer(capaAeronaves);
                    desuscribir();
                }
            });
        }
        actualizarIndicador();
    });

    cargarCache();
    actualizarIndicador();
    setTimeout(consultarEstadoUnaVez, 5000);
    setInterval(actualizarIndicador, 10000);
})();
