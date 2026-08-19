'use strict';

const VERSION = 'gps-pistas-v9-rotacion-visual-leaflet';
const CACHE_APP = `${VERSION}-app`;
const CACHE_TILES = `${VERSION}-tiles`;
const MAX_TILES = 120;

const ARCHIVOS_APP = [
    '/',
    '/manifest.webmanifest',
    '/estilos/style.css',
    '/estilos/mapa-rendimiento.css',
    '/vendor/bootstrap/bootstrap.min.css',
    '/vendor/bootstrap/bootstrap.bundle.min.js',
    '/vendor/bootstrap-icons/bootstrap-icons.min.css',
    '/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
    '/vendor/leaflet/leaflet.css',
    '/vendor/leaflet/leaflet.js',
    '/vendor/leaflet-rotate/leaflet-rotate.js',
    '/vendor/turf/turf.min.js',
    '/socket.io/socket.io.js',
    '/js/orientationModel.js',
    '/js/selectionPolicy.js',
    '/js/mapConfig.js',
    '/js/mapEtiquetasSiguiendoVista.js',
    '/js/mapIconos.js',
    '/js/mapFiltros.js',
    '/js/mapProhibidos.js',
    '/js/mapInteres.js',
    '/js/mapEtiquetas.js',
    '/js/mapCapasEspeciales.js',
    '/js/mapAeronaves.js',
    '/js/routeEngine.js',
    '/js/main.js',
    '/js/offline.js',
    '/resources/app-icon.svg',
    '/resources/aeronaves/avion.svg',
    '/resources/aeronaves/cargo.svg',
    '/resources/aeronaves/helicoptero.svg',
    '/resources/aeronaves/ligero.svg',
    '/resources/aeronaves/militar.svg',
    '/resources/red_vascular_unida_con_peso.geojson',
    '/resources/vialidades_destacadas.geojson',
    '/resources/vialidades_final_completo.geojson',
    '/resources/zona_principal.geojson',
    '/resources/zonas_prohibidas.geojson',
    '/resources/pistas.geojson',
    '/resources/señalizaciones.geojson',
    '/resources/zonas_interes.geojson',
    '/resources/carcamos.geojson',
    '/resources/Terminal1.geojson',
    '/resources/Terminal2.geojson',
    '/resources/zonas_peligro.geojson',
    '/resources/plataformas.geojson',
    '/resources/posiciones.geojson',
    '/resources/host_spot.geojson'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_APP);
        await Promise.all(ARCHIVOS_APP.map(async url => {
            try {
                const respuesta = await fetch(url, { cache: 'no-cache' });
                if (respuesta.ok) await cache.put(url, respuesta);
            } catch (_) {}
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const nombres = await caches.keys();
        await Promise.all(nombres
            .filter(nombre => nombre.startsWith('gps-pistas-') && nombre !== CACHE_APP && nombre !== CACHE_TILES)
            .map(nombre => caches.delete(nombre)));
        await self.clients.claim();
    })());
});

async function desdeCacheConActualizacion(request) {
    const cache = await caches.open(CACHE_APP);
    const guardada = await cache.match(request, { ignoreSearch: true });
    if (guardada) return guardada;
    const respuesta = await fetch(request);
    if (respuesta.ok) await cache.put(request, respuesta.clone());
    return respuesta;
}

// Los archivos de interacción móvil contienen la navegación, orientación y
// marcadores. Cuando hay red se solicita su versión actual para no ejecutar
// una copia antigua; sin conexión se conserva el respaldo local.
async function desdeRedConRespaldo(request) {
    const cache = await caches.open(CACHE_APP);
    try {
        const respuesta = await fetch(request, { cache: 'no-cache' });
        if (respuesta.ok) await cache.put(request, respuesta.clone());
        return respuesta;
    } catch (_) {
        return (await cache.match(request, { ignoreSearch: true })) || Response.error();
    }
}

async function navegacion(request) {
    try {
        const respuesta = await fetch(request);
        if (respuesta.ok) {
            const cache = await caches.open(CACHE_APP);
            await cache.put('/', respuesta.clone());
        }
        return respuesta;
    } catch (_) {
        return (await caches.match('/')) || Response.error();
    }
}

async function tesela(request) {
    const cache = await caches.open(CACHE_TILES);
    const guardada = await cache.match(request);
    if (guardada) return guardada;
    const respuesta = await fetch(request);
    if (respuesta.ok || respuesta.type === 'opaque') {
        await cache.put(request, respuesta.clone());
        const claves = await cache.keys();
        while (claves.length > MAX_TILES) await cache.delete(claves.shift());
    }
    return respuesta;
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(navegacion(request));
        return;
    }
    if (url.pathname.startsWith('/api/')) return;
    if (url.pathname.startsWith('/socket.io/') && url.pathname !== '/socket.io/socket.io.js') return;
    if ([
        '/js/main.js',
        '/js/orientationModel.js',
        '/js/mapConfig.js',
        '/js/mapIconos.js',
        '/js/mapAeronaves.js',
        '/estilos/style.css'
    ].includes(url.pathname)) {
        event.respondWith(desdeRedConRespaldo(request));
        return;
    }
    if (url.hostname.endsWith('basemaps.cartocdn.com')) {
        event.respondWith(tesela(request));
        return;
    }
    if (url.origin === self.location.origin) event.respondWith(desdeCacheConActualizacion(request));
});
