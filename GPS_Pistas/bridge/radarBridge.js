'use strict';

const crypto = require('crypto');

const API_LOCAL = process.env.LOCAL_RADAR_API_URL || 'http://127.0.0.1:4001/api/vuelos-live';
const HOST = String(process.env.GPS_PISTAS_HOST_URL || '').replace(/\/$/, '');
const TOKEN = process.env.RADAR_BRIDGE_TOKEN || '';
const INTERVALO_MS = Math.max(3000, Number(process.env.RADAR_BRIDGE_INTERVAL_MS) || 5000);
const LATIDO_MS = Math.max(15000, Number(process.env.RADAR_BRIDGE_HEARTBEAT_MS) || 30000);

if (!HOST || !TOKEN) {
    console.error('Faltan GPS_PISTAS_HOST_URL o RADAR_BRIDGE_TOKEN. Revisa bridge/README.md.');
    process.exit(1);
}

let ultimaFirma = '';
let ultimoEnvio = 0;
let esperaErrorMs = INTERVALO_MS;

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function firma(vuelos) {
    return crypto.createHash('sha256').update(JSON.stringify(vuelos)).digest('hex');
}

async function leerRadarLocal() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
        const respuesta = await fetch(API_LOCAL, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        if (!respuesta.ok) throw new Error(`radar local respondió ${respuesta.status}`);
        const datos = await respuesta.json();
        if (!Array.isArray(datos)) throw new Error('el radar local no devolvió una lista');
        return datos;
    } finally {
        clearTimeout(timeout);
    }
}

async function publicar(vuelos) {
    const respuesta = await fetch(`${HOST}/api/radar/push`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-radar-token': TOKEN
        },
        body: JSON.stringify({ vuelos }),
        signal: AbortSignal.timeout(8000)
    });
    if (!respuesta.ok) {
        const detalle = await respuesta.text();
        throw new Error(`host respondió ${respuesta.status}: ${detalle.slice(0, 160)}`);
    }
    return respuesta.json();
}

async function ciclo() {
    console.log(`Puente activo: ${API_LOCAL} -> ${HOST}`);
    while (true) {
        try {
            const vuelos = await leerRadarLocal();
            const nuevaFirma = firma(vuelos);
            const requiereLatido = Date.now() - ultimoEnvio >= LATIDO_MS;

            if (nuevaFirma !== ultimaFirma || requiereLatido) {
                const resultado = await publicar(vuelos);
                ultimaFirma = nuevaFirma;
                ultimoEnvio = Date.now();
                console.log(`[${new Date().toLocaleTimeString()}] ${resultado.recibidas} aeronaves publicadas`);
            }

            esperaErrorMs = INTERVALO_MS;
            await esperar(INTERVALO_MS);
        } catch (error) {
            console.warn(`[Puente] ${error.message}; reintento en ${Math.round(esperaErrorMs / 1000)} s`);
            await esperar(esperaErrorMs);
            esperaErrorMs = Math.min(60000, esperaErrorMs * 2);
        }
    }
}

ciclo();
