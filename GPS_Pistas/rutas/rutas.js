const express = require('express');
const router = express.Router();
const path = require('path');

const RADAR_API_URL = process.env.RADAR_API_URL || 'http://172.16.2.125:4001/api/vuelos-live';

// Expone al navegador solamente los datos necesarios para dibujar las
// aeronaves. La consulta se realiza desde este servidor para que los clientes
// móviles no dependan de CORS ni intenten mezclar una página HTTPS con la API
// HTTP del radar.
router.get('/api/vuelos-live', async (req, res) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
        const respuesta = await fetch(RADAR_API_URL, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });

        if (!respuesta.ok) {
            throw new Error(`La API del radar respondió ${respuesta.status}`);
        }

        const datos = await respuesta.json();
        if (!Array.isArray(datos)) {
            throw new Error('La API del radar no devolvió una lista de aeronaves');
        }

        const vuelos = datos
            .filter(vuelo => vuelo && vuelo.id && vuelo.lat != null && vuelo.lng != null)
            .map(vuelo => ({
                id: vuelo.id,
                callsign: vuelo.callsign,
                lat: vuelo.lat,
                lng: vuelo.lng,
                track: vuelo.track,
                speed: vuelo.speed,
                alt: vuelo.alt,
                status: vuelo.status,
                pista: vuelo.pista,
                tipo: vuelo.tipo,
                operacion: vuelo.asa_TipoOperacion
            }));

        res.set('Cache-Control', 'no-store');
        res.json(vuelos);
    } catch (error) {
        const detalle = error.name === 'AbortError'
            ? 'La API del radar tardó demasiado en responder'
            : error.message;

        console.error(`[Radar] ${detalle}`);
        res.status(502).json({ error: 'No fue posible consultar las aeronaves en vivo' });
    } finally {
        clearTimeout(timeout);
    }
});

// Definir la ruta principal (raíz)
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../vistas/index.html'));
});

module.exports = router;
