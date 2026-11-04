const path = require('path');
const logger = require('../../../shared/config/logger');
const filename = path.basename(__filename);
const redis = require('../../../shared/config/redis');
const consCache = require('../../../shared/util/constants.cache');
const CallService = require('../../services/call.service');

/**
 * WebRTC signaling for calls between matched users. The server never touches
 * media: it relays SDP/ICE to the other participant's devices, only for an
 * accepted call. Ringing/accept/decline go through REST (/api/calls).
 *
 * Every socket joins user:<userId>, so all of a user's devices ring.
 *
 * Client emits                          Server emits (to the other participant)
 *  call:offer  {callId, sdp}        →    call:offer  {callId, sdp}      (caller → callee)
 *  call:answer {callId, sdp}        →    call:answer {callId, sdp}      (callee → caller)
 *  call:ice    {callId, candidate}  →    call:ice    {callId, candidate}
 *  call:media  {callId, camOn, micOn}→   call:media  {callId, camOn, micOn}
 *  call:hangup {callId}             →    call:status {callId, status: ended|cancelled|declined, by}
 *  (REST POST /api/calls)           →    call:incoming {call}           (to the callee)
 *  (REST accept/decline/cancel/end, ring timeout) → call:status {callId, chatId, status, by} (to both)
 */
const MAX_SDP_LENGTH = 20000;
const VERIFIED_TTL_MS = 60 * 1000;

const parse = (payload) => {
    if (typeof payload === 'string') { try { return JSON.parse(payload); } catch { return null; } }
    return payload && typeof payload === 'object' ? payload : null;
};

module.exports = (namespace) => {
    namespace.on('connection', (socket) => {
        const userId = socket.userId;
        if (userId) socket.join(CallService.userChannel(userId));
        // callId → { peerId, at }: avoids a DB read per ICE candidate.
        const verified = new Map();

        const peerFor = async (callId) => {
            const cached = verified.get(callId);
            if (cached && Date.now() - cached.at < VERIFIED_TTL_MS) return cached.peerId;
            const peerId = await CallService.peerInAcceptedCall(callId, userId);
            if (peerId) verified.set(callId, { peerId, at: Date.now() }); else verified.delete(callId);
            return peerId;
        };

        const relay = (event, transform) => socket.on(event, async (raw) => {
            const body = parse(raw);
            if (!body || typeof body.callId !== 'string') return;
            if (body.sdp && String(body.sdp).length > MAX_SDP_LENGTH) return;
            try {
                const peerId = await peerFor(body.callId);
                if (peerId) socket.to(CallService.userChannel(peerId)).emit(event, transform(body));
            } catch (err) {
                logger.error(`${event} relay failed: ${err}`, { className: filename });
            }
        });

        relay('call:offer', ({ callId, sdp }) => ({ callId, sdp: String(sdp) }));
        relay('call:answer', ({ callId, sdp }) => ({ callId, sdp: String(sdp) }));
        relay('call:ice', ({ callId, candidate }) => ({ callId, candidate }));
        relay('call:media', ({ callId, camOn, micOn }) => ({ callId, camOn: camOn !== false, micOn: micOn !== false }));

        socket.on('call:hangup', async (raw) => {
            const body = parse(raw);
            if (!body || typeof body.callId !== 'string') return;
            verified.delete(body.callId);
            await CallService.endById(body.callId, userId).catch(err =>
                logger.error(`call:hangup failed: ${err}`, { className: filename }));
        });

        // The shared JWT socket middleware registers every socket id under the
        // user's chat-socket set; remove ours so it does not leak.
        socket.on('disconnect', async () => {
            if (userId) await redis.sRem(`${consCache.REDIS_KEY_USER_SOCKETS}${userId}`, socket.id).catch(() => undefined);
        });
    });
};
