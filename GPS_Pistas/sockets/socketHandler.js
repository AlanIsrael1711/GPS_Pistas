module.exports = (io) => {
    io.on('connection', (socket) => {
        // Almacenar o registrar conexiones si es necesario
        
        socket.on('actualizar-ubicacion', (coords) => {
            // Retransmite la ubicación a todos los clientes conectados
            io.emit('dibujar-ubicacion', { id: socket.id, ...coords });
        });

        socket.on('disconnect', () => {
            io.emit('usuario-desconectado', socket.id);
        });
    });
};