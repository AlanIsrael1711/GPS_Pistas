module.exports = (io) => {
    io.on('connection', (socket) => {
        // Almacenar o registrar conexiones si es necesario
        
        socket.on('actualizar-ubicacion', (coords) => {
            // Solo devuelve la ubicación al mismo usuario que la envió.
            // Ningún otro cliente recibe la posición ajena.
            socket.emit('dibujar-ubicacion', { id: socket.id, ...coords });
        });

        socket.on('disconnect', () => {
            io.emit('usuario-desconectado', socket.id);
        });
    });
};