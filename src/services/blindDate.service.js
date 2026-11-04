const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const ObjectId = require('mongoose').Types.ObjectId;
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const jwtUtil = require('../../shared/util/jwt');
const redis = require('../../shared/config/redis');
const PushNotification = require('../../shared/util/pushNotification');
const { getIceServers } = require('../../shared/util/turnCredentials');
const BlindDate = require('../models/blindDate.model');
const Match = require('../models/match.model');
const UserRepository = require('../repository/user.repository');
const PremiumService = require('./premium.service');
const ConfigService = require('./config.service');
const LikesService = require('./likes.service');
const Rules = require('./blindDate.rules');

const NAMESPACE = '/ws/blind-dates';
const DEFAULT_ROOMS_PER_DAY = 10;
const STALE_CALL_MS = 3 * 60 * 60 * 1000;
const JOIN_LOCK_SECS = 10;

const userIdFrom = (req) => jwtUtil.getValueFromJwtToken(req.headers['authorization'], 'id');
const roomChannel = (roomId) => `bd:${roomId}`;

const emitToRoom = (roomId, event, payload) => {
    try {
        // Lazy require: ws.js loads the signaling handler, which loads this service.
        const { getSocketIO } = require('../../shared/config/ws');
        getSocketIO()?.of(NAMESPACE).to(roomChannel(roomId)).emit(event, payload);
    } catch (err) {
        logger.error(`blind date emit ${event} failed: ${err}`, { className: filename });
    }
};

const requirePremium = async (userId) => {
    if (!(await PremiumService.isPremium(userId))) throw new BusinessException(c.CODE_ERROR_PREMIUM_REQUIRED);
};

const parseRoomId = (value) => {
    if (!ObjectId.isValid(value)) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_FOUND);
    return new ObjectId(value);
};

/** People I matched with or blocked never see my rooms (and I never see theirs). */
const excludedPeople = async (userId) => {
    const me = new ObjectId(userId);
    const matches = await Match.find({ users: me, status: { $in: ['matched', 'blocked'] } }).select('users').lean();
    const others = matches.flatMap(match => match.users).filter(id => String(id) !== String(userId));
    return [me, ...others];
};

/**
 * Lazily closes rooms left behind by crashed/killed apps, so they never block
 * the user from creating or joining a new one.
 */
const closeStaleRooms = async (userId, now = new Date()) => {
    const me = new ObjectId(userId);
    const mine = { $or: [{ hostId: me }, { guestId: me }] };
    await BlindDate.updateMany(
        { ...mine, status: 'open', created_at: { $lt: new Date(now - Rules.OPEN_ROOM_TTL_MS) } },
        { $set: { status: 'expired', ended_at: now, endedReason: 'expired' } });
    await BlindDate.updateMany(
        { ...mine, status: 'matched', matched_at: { $lt: new Date(now - Rules.HOST_CONNECT_TIMEOUT_MS * 2) } },
        { $set: { status: 'ended', ended_at: now, endedReason: 'host_unavailable' } });
    await BlindDate.updateMany(
        { ...mine, status: 'in_call', call_started_at: { $lt: new Date(now - STALE_CALL_MS) } },
        { $set: { status: 'ended', ended_at: now, endedReason: 'stale' } });
};

const liveRoomOf = (userId) => BlindDate.findOne({
    $or: [{ hostId: new ObjectId(userId) }, { guestId: new ObjectId(userId) }],
    status: { $in: Rules.LIVE_STATUSES }
});

/** View of a room for one of its participants. */
const participantView = async (room, userId) => {
    const isHost = String(room.hostId) === String(userId);
    const peerId = Rules.otherParticipant(room, userId);
    let peerName = isHost ? null : Rules.toPublicRoom(room).hostName;
    if (isHost && peerId) {
        const guest = await UserRepository.findById(peerId, 'userInfo.fullName');
        peerName = String(guest?.userInfo?.fullName || '').trim().split(/\s+/)[0] || null;
    }
    return {
        ...Rules.toPublicRoom(room),
        role: isHost ? 'host' : 'guest',
        status: room.status,
        peerName,
        matched_at: room.matched_at,
        call_started_at: room.call_started_at,
        chatId: room.chatId || null
    };
};

const createRoom = async (req) => {
    const userId = userIdFrom(req);
    await requirePremium(userId);
    await closeStaleRooms(userId);
    if (await liveRoomOf(userId)) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_BUSY);

    const configs = (await ConfigService.getConfigs()).data || [];
    const limit = parseInt(configs.find(cfg => cfg.key === constants.BLIND_DATE_ROOMS_PER_DAY)?.value, 10) || DEFAULT_ROOMS_PER_DAY;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = await BlindDate.countDocuments({ hostId: new ObjectId(userId), created_at: { $gte: startOfDay } });
    if (today >= limit) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_DAILY_LIMIT);

    const host = await UserRepository.findById(userId, 'userInfo.fullName userInfo.gender');
    if (!host) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);
    const now = new Date();
    try {
        const room = await BlindDate.create({
            hostId: new ObjectId(userId),
            hostName: host.userInfo.fullName,
            hostGender: host.userInfo.gender,
            conditions: Rules.normalizeConditions(req.body?.conditions),
            expires_at: new Date(now.getTime() + Rules.ROOM_RETENTION_MS)
        });
        logger.info(`Blind date room created: ${room._id} by ${userId}`, { className: filename, req });
        return new BaseResponse(true, [c.CODE_SUCCESS], await participantView(room, userId));
    } catch (err) {
        // Unique partial index: a concurrent create by the same host.
        if (err?.code === 11000) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_BUSY);
        throw err;
    }
};

const listRooms = async (req) => {
    const userId = userIdFrom(req);
    await requirePremium(userId);
    const me = await UserRepository.findById(userId, 'userInfo preferences musicPreferences');
    if (!me) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);
    const filter = Rules.buildOpenRoomsFilter(me, await excludedPeople(userId));
    const rooms = await BlindDate.find(filter).sort({ created_at: -1 }).limit(50).lean();
    return new BaseResponse(true, [], { results: rooms.map(Rules.toPublicRoom) });
};

const myRoom = async (req) => {
    const userId = userIdFrom(req);
    await closeStaleRooms(userId);
    const room = await liveRoomOf(userId);
    return new BaseResponse(true, [], room ? await participantView(room, userId) : null);
};

/**
 * Joining = claiming the room. Concurrency:
 *  - Many guests → ONE room: the atomic findOneAndUpdate on {status:'open', guestId:null}
 *    lets exactly one request win; the rest get ERROR_BLIND_DATE_TAKEN.
 *  - One guest → many rooms at once: a short Redis NX lock per guest serialises
 *    their joins, then the "already in a live room" check rejects the second.
 */
const joinRoom = async (req) => {
    const userId = userIdFrom(req);
    const roomId = parseRoomId(req.params.id);
    await requirePremium(userId);

    const lockKey = `blindDate:joining:${userId}`;
    const locked = await redis.set(lockKey, String(roomId), { NX: true, EX: JOIN_LOCK_SECS });
    if (!locked) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_BUSY);
    try {
        await closeStaleRooms(userId);
        if (await liveRoomOf(userId)) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_BUSY);

        const room = await BlindDate.findById(roomId).lean();
        if (!room) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_FOUND);
        if (room.status !== 'open' || room.guestId) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_TAKEN);

        const me = await UserRepository.findById(userId, 'userInfo preferences musicPreferences');
        const excluded = (await excludedPeople(userId)).map(String);
        if (!me || excluded.includes(String(room.hostId)) || !Rules.isCompatible(room, me)) {
            throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_COMPATIBLE);
        }

        const now = new Date();
        const claimed = await BlindDate.findOneAndUpdate(
            Rules.buildClaimFilter(roomId, new ObjectId(userId), now),
            { $set: { status: 'matched', guestId: new ObjectId(userId), matched_at: now } },
            { new: true });
        if (!claimed) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_TAKEN);

        logger.info(`Blind date ${roomId} claimed by ${userId}`, { className: filename, req });
        const view = await participantView(claimed, userId);
        const guestName = String(me.userInfo?.fullName || '').trim().split(/\s+/)[0] || null;
        // Host: live socket if the waiting screen is open, push otherwise.
        emitToRoom(roomId, 'bd:guestJoined', { roomId: String(roomId), guestName });
        PushNotification.proccessNotificationsByUser(String(claimed.hostId), constants.WS_EVENT_NEW_BLIND_DATE_GUEST,
            new BaseResponse(true, [], { roomId: String(roomId), url: '/?section=blindDates' }));
        scheduleHostTimeout(roomId, userId, now);
        return new BaseResponse(true, [c.CODE_SUCCESS], view);
    } finally {
        await redis.del(lockKey).catch(() => undefined);
    }
};

/** If the host never starts the call, the guest is released and the room reopens. */
const scheduleHostTimeout = (roomId, guestId, matchedAt) => {
    const timer = setTimeout(async () => {
        try {
            const reopened = await BlindDate.findOneAndUpdate(
                { _id: roomId, status: 'matched', guestId: new ObjectId(guestId), matched_at: matchedAt },
                { $set: { status: 'open', guestId: null }, $unset: { matched_at: 1 } },
                { new: true });
            if (reopened) emitToRoom(roomId, 'bd:hostUnavailable', { roomId: String(roomId) });
        } catch (err) {
            logger.error(`blind date host timeout failed: ${err}`, { className: filename });
        }
    }, Rules.HOST_CONNECT_TIMEOUT_MS);
    timer.unref?.();
};

/**
 * Leave / hang up / cancel:
 *  - host, room still open      → cancelled
 *  - guest before the call      → room reopens for someone else
 *  - anyone during the call     → ended (both get bd:peerLeft)
 */
const leaveRoom = async (req) => {
    const userId = userIdFrom(req);
    const roomId = parseRoomId(req.params.id);
    const room = await endForUser(roomId, userId, 'hangup');
    if (!room) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_FOUND);
    return new BaseResponse(true, [c.CODE_SUCCESS], { status: room.status });
};

const endForUser = async (roomId, userId, reason) => {
    const me = new ObjectId(userId);
    const now = new Date();
    const cancelled = await BlindDate.findOneAndUpdate(
        { _id: roomId, hostId: me, status: 'open' },
        { $set: { status: 'cancelled', ended_at: now, endedReason: 'cancelled' } }, { new: true });
    if (cancelled) return cancelled;

    const reopened = await BlindDate.findOneAndUpdate(
        { _id: roomId, guestId: me, status: 'matched' },
        { $set: { status: 'open', guestId: null }, $unset: { matched_at: 1 } }, { new: true });
    if (reopened) { emitToRoom(roomId, 'bd:peerLeft', { roomId: String(roomId), reopened: true }); return reopened; }

    const ended = await BlindDate.findOneAndUpdate(
        { _id: roomId, $or: [{ hostId: me }, { guestId: me }], status: { $in: ['matched', 'in_call'] } },
        { $set: { status: 'ended', ended_at: now, endedReason: reason } }, { new: true });
    if (ended) { emitToRoom(roomId, 'bd:peerLeft', { roomId: String(roomId) }); return ended; }

    // Already finished: idempotent for the participants.
    const existing = await BlindDate.findById(roomId);
    return Rules.isParticipant(existing, userId) ? existing : null;
};

/** Called by signaling when the guest's answer is relayed: the call is live. */
const markInCall = async (roomId) => BlindDate.updateOne(
    { _id: roomId, status: 'matched' },
    { $set: { status: 'in_call', call_started_at: new Date() } });

/**
 * After the call both answer "match?". When both say yes, exactly one request
 * (guarded by matchState) creates the match + chat through LikesService.matchTasks.
 */
const matchIntent = async (req) => {
    const userId = userIdFrom(req);
    const roomId = parseRoomId(req.params.id);
    const wantsMatch = req.body?.wantsMatch === true;
    const room = await BlindDate.findById(roomId);
    if (!Rules.isParticipant(room, userId) || !room.guestId) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_FOUND);
    if (!['ended', 'in_call'].includes(room.status)) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_FOUND);

    const field = String(room.hostId) === String(userId) ? 'hostWantsMatch' : 'guestWantsMatch';
    const updated = await BlindDate.findOneAndUpdate({ _id: roomId }, { $set: { [field]: wantsMatch } }, { new: true });
    if (!(updated.hostWantsMatch && updated.guestWantsMatch)) {
        const peerField = field === 'hostWantsMatch' ? 'guestWantsMatch' : 'hostWantsMatch';
        const peerAnswered = typeof updated[peerField] === 'boolean';
        return new BaseResponse(true, [c.CODE_SUCCESS], { isMatch: false, waitingForPeer: wantsMatch && !peerAnswered });
    }

    const winner = await BlindDate.findOneAndUpdate(
        { _id: roomId, hostWantsMatch: true, guestWantsMatch: true, matchState: { $exists: false } },
        { $set: { matchState: 'creating' } }, { new: true });
    if (!winner) {
        const done = await BlindDate.findById(roomId);
        return new BaseResponse(true, [c.CODE_SUCCESS], { isMatch: Boolean(done?.chatId), chatId: done?.chatId || null });
    }

    const otherId = String(Rules.otherParticipant(updated, userId));
    const existing = await Match.findOne({ users: { $all: [new ObjectId(userId), new ObjectId(otherId)] } });
    let chatId = existing?._id || null;
    if (!existing) {
        // Pushes newMatch to the other participant, like a regular reciprocal like.
        const data = await LikesService.matchTasks(String(userId), { toUserId: otherId }, { isMatch: true });
        chatId = data.chatId;
    }
    await BlindDate.updateOne({ _id: roomId }, { $set: { matchState: 'done', chatId } });
    return new BaseResponse(true, [c.CODE_SUCCESS], { isMatch: Boolean(chatId), chatId });
};

const turnCredentials = async (req) => {
    const userId = userIdFrom(req);
    await requirePremium(userId);
    const { iceServers, ttlSecs } = await getIceServers(userId);
    return new BaseResponse(true, [], { iceServers, ttlSecs });
};

module.exports = {
    NAMESPACE,
    roomChannel,
    createRoom,
    listRooms,
    myRoom,
    joinRoom,
    leaveRoom,
    endForUser,
    markInCall,
    matchIntent,
    turnCredentials
};
