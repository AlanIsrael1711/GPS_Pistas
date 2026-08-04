module.exports = (io, radarStore) => {
    io.on('connection', (socket) => {
        socket.on('radar:suscribir', () => {
            socket.join('radar-clientes');
            socket.emit('radar:estado', radarStore.estado());
        });

        socket.on('radar:desuscribir', () => {
            socket.leave('radar-clientes');
        });
    });
};
