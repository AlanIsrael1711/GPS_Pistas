// Clase encargada de configurar el mapa y poner límites en la visualización.

// Los módulos GeoJSON notifican aquí cuando terminaron de cargar. La selección
// táctil puede consultar este estado sin depender del orden de las peticiones.
window.modulosMapaListos = window.modulosMapaListos || new Set();
window.notificarModuloMapaListo = function(nombre) {
    window.modulosMapaListos.add(nombre);
    window.dispatchEvent(new CustomEvent('gps:modulo-mapa-listo', { detail: { nombre } }));
};

// constantes de limites del mapa
window.limite1 = L.latLng(19.4591931, -99.0451066) // noreste
window.limite2 = L.latLng(19.413817, -99.092546) // suroeste
window.bordeMapa =  L.latLngBounds(limite1, limite2) // borde del mapa

// Inicializar el mapa
window.map = L.map('map', {
    center: [19.4360, -99.0701],
    zoom: 16,
    minZoom: 15,
    preferCanvas: true,
    rotate: true,
    touchRotate: true,
    rotateControl: false,
    tapTolerance: 25,
    shiftKeyRotate: true,
    bearing: 0
});

window.capaMapaBase = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd',
    maxZoom: 20,
    detectRetina: false,
    updateWhenIdle: true,
    keepBuffer: 1
});

window.establecerMapaBase = function(activar, guardar = true) {
    const permitido = Boolean(activar && navigator.onLine);
    if (permitido && !window.map.hasLayer(window.capaMapaBase)) {
        window.capaMapaBase.addTo(window.map);
    } else if (!permitido && window.map.hasLayer(window.capaMapaBase)) {
        window.map.removeLayer(window.capaMapaBase);
    }
    if (guardar) localStorage.setItem('gpsPistasMapaBase', activar ? '1' : '0');
    return permitido;
};

// El mapa vectorial local es suficiente para navegar. El mapa de teselas se
// deja apagado por defecto para evitar miles de descargas en uso móvil.
const preferenciaMapaBase = localStorage.getItem('gpsPistasMapaBase') === '1';
window.establecerMapaBase(preferenciaMapaBase, false);

window.addEventListener('offline', () => window.establecerMapaBase(false, false));
window.addEventListener('online', () => {
    if (localStorage.getItem('gpsPistasMapaBase') === '1') window.establecerMapaBase(true, false);
});

