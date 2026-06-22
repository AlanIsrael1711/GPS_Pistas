const express = require('express');
const router = express.Router();
const path = require('path');

// Definir la ruta principal (raíz)
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../vistas/index.html'));
});

module.exports = router;