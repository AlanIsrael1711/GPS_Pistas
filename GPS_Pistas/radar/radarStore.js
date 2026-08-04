'use strict';

const MAX_AERONAVES = 500;
const RADAR_STALE_MS = Math.max(10000, Number(process.env.RADAR_STALE_MS) || 45000);

function texto(valor, respaldo = '') {
    if (valor === null || valor === undefined) return respaldo;
    return String(valor).trim() || respaldo;
}

function numero(valor, minimo, maximo) {
    if (valor === null || valor === undefined || valor === '') return null;
    const resultado = Number(valor);
    if (!Number.isFinite(resultado)) return null;
    if (minimo !== undefined && resultado < minimo) return null;
    if (maximo !== undefined && resultado > maximo) return null;
    return resultado;
}

function normalizarVuelo(vuelo) {
    if (!vuelo || typeof vuelo !== 'object') return null;
    const id = texto(vuelo.id, '');
    const lat = numero(vuelo.lat, -90, 90);
    const lng = numero(vuelo.lng, -180, 180);
    if (!id || lat === null || lng === null) return null;

    return {
        id: id.slice(0, 32),
        callsign: texto(vuelo.callsign).slice(0, 32),
        lat,
        lng,
        track: numero(vuelo.track, 0, 360),
        speed: numero(vuelo.speed, 0, 2000),
        alt: numero(vuelo.alt, -2000, 100000),
        status: texto(vuelo.status, 'DESCONOCIDO').slice(0, 32),
        pista: texto(vuelo.pista).slice(0, 80),
        tipo: texto(vuelo.tipo, 'COMERCIAL').slice(0, 32),
        operacion: texto(vuelo.operacion || vuelo.asa_TipoOperacion).slice(0, 8)
    };
}

function firma(vuelo) {
    return JSON.stringify([
        vuelo.callsign, vuelo.lat, vuelo.lng, vuelo.track, vuelo.speed,
        vuelo.alt, vuelo.status, vuelo.pista, vuelo.tipo, vuelo.operacion
    ]);
}

class RadarStore {
    constructor() {
        this.aeronaves = new Map();
        this.firmas = new Map();
        this.version = 0;
        this.actualizadoEn = null;
        this.ultimoPuenteEn = null;
    }

    reemplazar(vuelosCrudos) {
        if (!Array.isArray(vuelosCrudos)) throw new TypeError('vuelos debe ser una lista');
        if (vuelosCrudos.length > MAX_AERONAVES) throw new RangeError(`máximo ${MAX_AERONAVES} aeronaves`);

        const nuevos = new Map();
        const nuevasFirmas = new Map();
        const actualizados = [];

        for (const crudo of vuelosCrudos) {
            const vuelo = normalizarVuelo(crudo);
            if (!vuelo) continue;
            const nuevaFirma = firma(vuelo);
            nuevos.set(vuelo.id, vuelo);
            nuevasFirmas.set(vuelo.id, nuevaFirma);
            if (this.firmas.get(vuelo.id) !== nuevaFirma) actualizados.push(vuelo);
        }

        const eliminados = [];
        for (const id of this.aeronaves.keys()) {
            if (!nuevos.has(id)) eliminados.push(id);
        }

        this.ultimoPuenteEn = new Date().toISOString();
        const cambio = actualizados.length > 0 || eliminados.length > 0;
        if (cambio) {
            this.aeronaves = nuevos;
            this.firmas = nuevasFirmas;
            this.version += 1;
            this.actualizadoEn = this.ultimoPuenteEn;
        }

        return {
            cambio,
            delta: {
                actualizados,
                eliminados,
                version: this.version,
                actualizadoEn: this.actualizadoEn
            },
            estado: this.estado()
        };
    }

    estaObsoleto() {
        if (!this.ultimoPuenteEn) return true;
        return Date.now() - Date.parse(this.ultimoPuenteEn) > RADAR_STALE_MS;
    }

    estado() {
        return {
            vuelos: [...this.aeronaves.values()],
            version: this.version,
            actualizadoEn: this.actualizadoEn,
            ultimoPuenteEn: this.ultimoPuenteEn,
            obsoleto: this.estaObsoleto()
        };
    }
}

module.exports = new RadarStore();
module.exports.RadarStore = RadarStore;
module.exports.normalizarVuelo = normalizarVuelo;
