const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const { validateJwtSocketConnection } = require('../middlewares/validateToken');
const { Server } = require('socket.io');

const namespaces = [
    { path: '/ws/chats', handler: require('../../src/websockets/chats') },
    { path: '/ws/blind-dates', handler: require('../../src/websockets/blindDates') },
    { path: '/ws/calls', handler: require('../../src/websockets/calls') }
];

const allowedNamespaces = namespaces.map(ns => ns.path);
let io;

function setupWebSocketServer(server) {
    io = new Server(server, {
        cors: {
            origin: process.env.SOCKET_ORIGIN,
            methods: ['GET', 'POST']
        }
    });

    logger.info({ message: 'Websockets running', className: filename });

    io.on('connection', (socket) => {
        const nsp = socket.nsp.name;
        if (!allowedNamespaces.includes(nsp)) {
            logger.error({ message: `Unauthorized connection attempt to ${nsp}`, className: filename });
            socket.disconnect(true);
        }
    });

    namespaces.forEach(({ path, handler }) => {
        logger.info({ message: `Starting websocket namespace: ${path}`, className: filename });
        const namespace = io.of(path);
        namespace.use(validateJwtSocketConnection);
        handler(namespace);
    });

    return io;
}

function getSocketIO() {
    if (!io) {
        logger.info({ message: `Socket.IO has not been initialized yet`, className: filename });
        return;
    }
    return io;
}

module.exports = {
    setupWebSocketServer,
    getSocketIO
};
