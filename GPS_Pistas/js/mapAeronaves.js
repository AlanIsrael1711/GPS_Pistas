// =======================================================
// mapAeronaves.js - Aeronaves en vivo sobre el mapa de GPS_Pistas
// =======================================================

(function iniciarCapaAeronaves() {
    'use strict';

    const ENDPOINT = '/api/vuelos-live';
    const INTERVALO_ACTUALIZACION_MS = 2000;
    const ESTADOS_EMERGENCIA = new Set(['EMERGENCIA', 'SECUESTRO', 'FALLA_RADIO']);
    const archivosPorTipo = {
        HELICOPTERO: 'helicoptero.svg',
        MILITAR: 'militar.svg',
        CARGO: 'cargo.svg',
        LIGERO: 'ligero.svg'
    };

    const aeronavesEnMapa = new Map();
    const capaAeronaves = L.layerGroup().addTo(window.map);
    let consultaActiva = false;
    let avisoConexionMostrado = false;
    let frameRotacion = null;

    window.capaAeronaves = capaAeronaves;
    window.aeronavesEnMapa = aeronavesEnMapa;

    function texto(valor, respaldo = '--') {
        if (valor === null || valor === undefined) return respaldo;
        const resultado = String(valor).trim();
        return resultado || respaldo;
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

        if (!id || lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return null;
        }

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
        const archivo = archivosPorTipo[tipo] || 'avion.svg';
        return `/resources/aeronaves/${archivo}`;
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
        const rumbo = track === null ? 0 : track;
        const bearing = typeof window.map.getBearing === 'function' ? window.map.getBearing() : 0;
        return ((rumbo - bearing) % 360 + 360) % 360;
    }

    function aplicarRotacion(entrada) {
        if (!entrada.img) return;
        entrada.img.style.transform = `rotateZ(${rotacionEnPantalla(entrada.datos.track)}deg)`;
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

        const icono = L.divIcon({
            className: 'marcador-aeronave',
            html: contenido,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            popupAnchor: [0, -17]
        });

        const marker = L.marker([vuelo.lat, vuelo.lng], {
            icon: icono,
            keyboard: true,
            riseOnHover: true,
            title: vuelo.callsign || `Aeronave ${vuelo.id}`
        }).addTo(capaAeronaves);

        marker.bindPopup(crearContenidoPopup(vuelo), {
            className: 'popup-aeronave',
            closeButton: true,
            autoPanPadding: [24, 24]
        });

        const entrada = { marker, img, datos: vuelo };
        aeronavesEnMapa.set(vuelo.id, entrada);
        aplicarRotacion(entrada);
    }

    function actualizarMarcador(entrada, vuelo) {
        entrada.datos = vuelo;
        entrada.marker.setLatLng([vuelo.lat, vuelo.lng]);
        entrada.marker.setPopupContent(crearContenidoPopup(vuelo));

        const nuevaRuta = rutaIcono(vuelo.tipo);
        if (!entrada.img.src.endsWith(nuevaRuta)) entrada.img.src = nuevaRuta;
        entrada.img.className = `aeronave-icono ${claseEstado(vuelo)}`;

        const elementoMarker = entrada.marker.getElement();
        if (elementoMarker) {
            elementoMarker.setAttribute('aria-label', vuelo.callsign || `Aeronave ${vuelo.id}`);
            elementoMarker.setAttribute('title', vuelo.callsign || `Aeronave ${vuelo.id}`);
        }

        aplicarRotacion(entrada);
    }

    function sincronizarAeronaves(vuelos) {
        const idsRecibidos = new Set();

        for (const vueloCrudo of vuelos) {
            const vuelo = normalizarVuelo(vueloCrudo);
            if (!vuelo) continue;

            idsRecibidos.add(vuelo.id);
            const entrada = aeronavesEnMapa.get(vuelo.id);
            if (entrada) actualizarMarcador(entrada, vuelo);
            else crearMarcador(vuelo);
        }

        for (const [id, entrada] of aeronavesEnMapa) {
            if (!idsRecibidos.has(id)) {
                capaAeronaves.removeLayer(entrada.marker);
                aeronavesEnMapa.delete(id);
            }
        }
    }

    async function consultarAeronaves() {
        if (consultaActiva || document.hidden) return;
        consultaActiva = true;

        try {
            const respuesta = await fetch(ENDPOINT, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });

            if (!respuesta.ok) throw new Error(`Respuesta ${respuesta.status}`);
            const vuelos = await respuesta.json();
            if (!Array.isArray(vuelos)) throw new Error('Formato de respuesta inválido');

            sincronizarAeronaves(vuelos);
            avisoConexionMostrado = false;
        } catch (error) {
            if (!avisoConexionMostrado) {
                console.warn('No fue posible actualizar las aeronaves en vivo:', error.message);
                avisoConexionMostrado = true;
            }
        } finally {
            consultaActiva = false;
        }
    }

    function programarRotacion() {
        if (frameRotacion !== null) return;
        frameRotacion = requestAnimationFrame(() => {
            for (const entrada of aeronavesEnMapa.values()) aplicarRotacion(entrada);
            frameRotacion = null;
        });
    }

    window.map.on('rotate', programarRotacion);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) consultarAeronaves();
    });

    document.addEventListener('DOMContentLoaded', () => {
        const checkbox = document.getElementById('chkAeronaves');
        if (!checkbox) return;

        checkbox.addEventListener('change', event => {
            if (event.target.checked) capaAeronaves.addTo(window.map);
            else window.map.removeLayer(capaAeronaves);
        });
    });

    consultarAeronaves();
    setInterval(consultarAeronaves, INTERVALO_ACTUALIZACION_MS);
})();
