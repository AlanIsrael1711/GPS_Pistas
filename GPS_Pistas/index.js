const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Importar controladores de lógica externa
const rutas = require('./rutas/rutas');
const activarSockets = require('./sockets/socketHandler'); // <--- NUEVO

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware para recursos estáticos
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/estilos', express.static(path.join(__dirname, 'estilos')));
// Carpeta de recursos:
app.use('/resources', express.static(path.join(__dirname, 'resources')));

// Servir enrutamiento HTTP
app.use('/', rutas);

// Inicializar la lógica de Sockets de forma aislada
activarSockets(io); // <--- NUEVO

// Encendido del servidor
const PUERTO = 3000;
server.listen(PUERTO, () => {
    console.log(`Servidor corriendo en: http://localhost:${PUERTO}`);
});