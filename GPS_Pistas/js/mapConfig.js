// Clase encargada de fonijar el mapa y poner limites en la visualizacion del mapa

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
    shiftKeyRotate: true,
    bearing: 0
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(window.map);

