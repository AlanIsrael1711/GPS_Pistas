module.exports = (io) => {
    io.on('connection', (socket) => {
        
        socket.on('actualizar-ubicacion', (coords) => {
            // [CORRECCIÓN] socket.emit responde SOLO al usuario que envió la petición.
            // Eliminamos io.emit para evitar retransmitir a otras pestañas o dispositivos.
            socket.emit('dibujar-ubicacion', coords);
        });

        socket.on('disconnect', () => {
            // Ya no notificamos desconexiones porque no hay un entorno multijugador
        });
    });
};