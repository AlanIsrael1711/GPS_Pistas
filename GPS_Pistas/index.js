const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const radarStore = require('./radar/radarStore');

// Importar controladores de lógica externa
const rutas = require('./rutas/rutas');
const activarSockets = require('./sockets/socketHandler'); // <--- NUEVO

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.set('io', io);
app.set('radarStore', radarStore);

// GeoJSON, JavaScript y CSS se comprimen antes de salir al teléfono.
app.use(compression());

// Middleware para recursos estáticos
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/estilos', express.static(path.join(__dirname, 'estilos')));
// Carpeta de recursos:
app.use('/resources', express.static(path.join(__dirname, 'resources')));
app.use('/vendor', express.static(path.join(__dirname, 'vendor'), {
    immutable: true,
    maxAge: '30d'
}));

app.get('/service-worker.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'service-worker.js'));
});
app.get('/manifest.webmanifest', (req, res) => {
    res.sendFile(path.join(__dirname, 'manifest.webmanifest'));
});

// Servir enrutamiento HTTP
app.use('/', rutas);

// Inicializar la lógica de Sockets de forma aislada
activarSockets(io, radarStore); // <--- NUEVO

// Encendido del servidor
const PUERTO = Number(process.env.PORT) || 3001;
server.listen(PUERTO, () => {
    console.log(`Servidor GPS Pistas disponible en el puerto ${PUERTO}`);
});
