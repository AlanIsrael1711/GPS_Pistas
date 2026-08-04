(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SelectionPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    const PROPIEDAD_TIPO = '__gpsTipoDestino';
    const TIPO_ESTRUCTURA = 'estructura';

    function marcarEstructura(feature) {
        if (!feature || !feature.geometry) return feature;
        feature.properties = feature.properties || {};
        feature.properties[PROPIEDAD_TIPO] = TIPO_ESTRUCTURA;
        return feature;
    }

    function esEstructura(feature) {
        if (!feature || !feature.geometry || !feature.properties) return false;
        const tipoGeometria = feature.geometry.type;
        return (tipoGeometria === 'Polygon' || tipoGeometria === 'MultiPolygon') &&
            feature.properties[PROPIEDAD_TIPO] === TIPO_ESTRUCTURA;
    }

    function buscarEstructuraEnPunto(directorio, latlng, turfApi) {
        if (!latlng || !turfApi) return null;
        const punto = turfApi.point([latlng.lng, latlng.lat]);
        const candidatos = [];

        for (const lugar of directorio || []) {
            if (!lugar || !lugar.nombre || !esEstructura(lugar.feature)) continue;
            try {
                if (turfApi.booleanPointInPolygon(punto, lugar.feature)) {
                    candidatos.push({ lugar, area: turfApi.area(lugar.feature) });
                }
            } catch (_) {
                // Un GeoJSON inválido no debe romper toda la selección del mapa.
            }
        }

        candidatos.sort((a, b) => a.area - b.area);
        return candidatos.length > 0 ? candidatos[0].lugar : null;
    }

    return {
        PROPIEDAD_TIPO,
        TIPO_ESTRUCTURA,
        marcarEstructura,
        esEstructura,
        buscarEstructuraEnPunto
    };
});
