module.exports = (io) => {
    io.on('connection', (socket) => {

        socket.on('actualizar-ubicacion', (coords) => {
            // Solo emite de vuelta al mismo socket que envió su ubicación.
            // Ningún otro cliente recibe este evento, eliminando el sistema multijugador.
            socket.emit('dibujar-ubicacion', { id: socket.id, ...coords });
        });

        // disconnect ya no necesita notificar a nadie: cada usuario es invisible al resto.
        socket.on('disconnect', () => {});
    });
};