'use strict';

const crypto = require('crypto');
const express = require('express');
const path = require('path');
const radarStore = require('../radar/radarStore');

const router = express.Router();
const parsearJsonRadar = express.json({ limit: '256kb', strict: true });

function tokenValido(recibido) {
    const esperado = process.env.RADAR_BRIDGE_TOKEN;
    if (!esperado || !recibido) return false;
    const a = Buffer.from(String(esperado));
    const b = Buffer.from(String(recibido));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/api/radar/push', parsearJsonRadar, (req, res) => {
    if (!process.env.RADAR_BRIDGE_TOKEN) {
        return res.status(503).json({ error: 'El puente del radar no está configurado en el host' });
    }
    if (!tokenValido(req.get('x-radar-token'))) {
        return res.status(401).json({ error: 'Token del puente inválido' });
    }

    try {
        const resultado = radarStore.reemplazar(req.body && req.body.vuelos);
        if (resultado.cambio) {
            const io = req.app.get('io');
            io.to('radar-clientes').emit('radar:delta', resultado.delta);
        }
        res.json({
            ok: true,
            cambio: resultado.cambio,
            version: resultado.estado.version,
            recibidas: resultado.estado.vuelos.length,
            servidorEn: new Date().toISOString()
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/api/vuelos-live', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(radarStore.estado());
});

router.get('/api/radar/status', (req, res) => {
    const estado = radarStore.estado();
    res.json({
        aeronaves: estado.vuelos.length,
        version: estado.version,
        actualizadoEn: estado.actualizadoEn,
        ultimoPuenteEn: estado.ultimoPuenteEn,
        obsoleto: estado.obsoleto
    });
});

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../vistas/index.html'));
});

module.exports = router;
