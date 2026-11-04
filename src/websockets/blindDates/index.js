const path = require('path');
const logger = require('../../../shared/config/logger');
const filename = path.basename(__filename);
const ObjectId = require('mongoose').Types.ObjectId;
const BlindDate = require('../../models/blindDate.model');
const BlindDateService = require('../../services/blindDate.service');
const Rules = require('../../services/blindDate.rules');
const redis = require('../../../shared/config/redis');
const consCache = require('../../../shared/util/constants.cache');

/**
 * WebRTC signaling for blind dates. The server never touches media: it only
 * relays SDP/ICE between the two participants of a room.
 *
 * Client emits                       Server emits (to the other participant)
 *  bd:hello  {roomId}           →     bd:hello {ok, role, status, peerName}  (to the sender)
 *  bd:offer  {roomId, sdp}      →     bd:offer  {roomId, sdp}        (host → guest)
 *  bd:answer {roomId, sdp}      →     bd:answer {roomId, sdp}        (guest → host; room becomes in_call)
 *  bd:ice    {roomId, candidate}→     bd:ice    {roomId, candidate}
 *  bd:hangup {roomId}           →     bd:peerLeft {roomId}
 *  (REST join)                  →     bd:guestJoined {roomId, guestName}  (to the host)
 *  (socket drop)                →     bd:peerOffline {roomId}   (media is P2P and may survive)
 */
const MAX_SDP_LENGTH = 20000;

const parse = (payload) => {
    if (typeof payload === 'string') { try { return JSON.parse(payload); } catch { return null; } }
    return payload && typeof payload === 'object' ? payload : null;
};

module.exports = (namespace) => {
    namespace.on('connection', (socket) => {
        const userId = socket.userId;

        const inRoom = (roomId) => typeof roomId === 'string' && socket.rooms.has(BlindDateService.roomChannel(roomId));
        const relay = (event, transform = (body) => body) => socket.on(event, async (raw) => {
            const body = parse(raw);
            if (!body || !inRoom(body.roomId)) return;
            if (body.sdp && String(body.sdp).length > MAX_SDP_LENGTH) return;
            socket.to(BlindDateService.roomChannel(body.roomId)).emit(event, transform(body));
            if (event === 'bd:answer') {
                await BlindDateService.markInCall(new ObjectId(body.roomId)).catch(err =>
                    logger.error(`markInCall failed: ${err}`, { className: filename }));
            }
        });

        socket.on('bd:hello', async (raw) => {
            const body = parse(raw);
            if (!body || !ObjectId.isValid(body.roomId)) return socket.emit('bd:hello', { ok: false });
            try {
                const room = await BlindDate.findById(body.roomId).lean();
                if (!Rules.isParticipant(room, userId) || !Rules.LIVE_STATUSES.includes(room.status)) {
                    return socket.emit('bd:hello', { ok: false, roomId: body.roomId });
                }
                socket.join(BlindDateService.roomChannel(body.roomId));
                const role = String(room.hostId) === String(userId) ? 'host' : 'guest';
                socket.emit('bd:hello', { ok: true, roomId: body.roomId, role, status: room.status });
                // Host opening the app from the push: replay the join so it starts the call.
                if (role === 'host' && room.status === 'matched') {
                    socket.emit('bd:guestJoined', { roomId: body.roomId });
                }
                if (role === 'guest') socket.to(BlindDateService.roomChannel(body.roomId)).emit('bd:guestReady', { roomId: body.roomId });
            } catch (err) {
                logger.error(`bd:hello failed: ${err}`, { className: filename });
                socket.emit('bd:hello', { ok: false, roomId: body.roomId });
            }
        });

        relay('bd:offer', ({ roomId, sdp }) => ({ roomId, sdp: String(sdp) }));
        relay('bd:answer', ({ roomId, sdp }) => ({ roomId, sdp: String(sdp) }));
        relay('bd:ice', ({ roomId, candidate }) => ({ roomId, candidate }));

        socket.on('bd:hangup', async (raw) => {
            const body = parse(raw);
            if (!body || !inRoom(body.roomId)) return;
            await BlindDateService.endForUser(new ObjectId(body.roomId), userId, 'hangup').catch(err =>
                logger.error(`bd:hangup failed: ${err}`, { className: filename }));
            socket.leave(BlindDateService.roomChannel(body.roomId));
        });

        // The shared JWT socket middleware registers every socket id under the
        // user's chat-socket set; remove ours so it does not leak.
        socket.on('disconnect', async () => {
            if (userId) await redis.sRem(`${consCache.REDIS_KEY_USER_SOCKETS}${userId}`, socket.id).catch(() => undefined);
        });

        socket.on('disconnecting', () => {
            for (const channel of socket.rooms) {
                if (channel.startsWith('bd:')) socket.to(channel).emit('bd:peerOffline', { roomId: channel.slice(3) });
            }
        });
    });
};
