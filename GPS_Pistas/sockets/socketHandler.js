module.exports = (io) => {
    io.on('connection', (socket) => {
        socket.on('actualizar-ubicacion', (coords) => {
            // Solo devuelve la ubicación al mismo cliente
            socket.emit('dibujar-ubicacion', { id: socket.id, ...coords });
        });

        socket.on('disconnect', () => {
            // Sin retransmisión a terceros
        });
    });
};