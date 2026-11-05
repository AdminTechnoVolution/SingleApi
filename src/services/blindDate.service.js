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
const BlindDatePreference = require('../models/blindDatePreference.model');
const MatchStatus = require('../enums/EnumMatchStatus');
const Match = require('../models/match.model');
const UserRepository = require('../repository/user.repository');
const User = require('../models/user.model');
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
/** Users browsing the room list. Not prefixed "bd:" (that prefix means "a room" for peerOffline). */
const LOBBY_CHANNEL = 'lobby:blind-dates';

const emitToRoom = (roomId, event, payload) => {
    try {
        // Lazy require: ws.js loads the signaling handler, which loads this service.
        const { getSocketIO } = require('../../shared/config/ws');
        getSocketIO()?.of(NAMESPACE).to(roomChannel(roomId)).emit(event, payload);
    } catch (err) {
        logger.error(`blind date emit ${event} failed: ${err}`, { className: filename });
    }
};

/**
 * Lobby: the list changed. Only ids travel; each client re-fetches GET /api/blind-dates,
 * which applies the compatibility filter server-side (no conditions leak to incompatible users).
 */
const emitLobby = (event, roomId) => {
    try {
        const { getSocketIO } = require('../../shared/config/ws');
        getSocketIO()?.of(NAMESPACE).to(LOBBY_CHANNEL).emit(event, { roomId: String(roomId) });
    } catch (err) {
        logger.error(`blind date lobby ${event} failed: ${err}`, { className: filename });
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

/**
 * Full public profiles of both participants (same projection as GET /api/users/:id).
 * Only called once the match is mutual. Lazy require: user.service pulls in heavy clients.
 */
const loadRevealProfile = async (userId) => {
    try {
        const UserService = require('./user.service');
        return (await UserService.getUserById({ params: { userId: String(userId) } })).data || null;
    } catch (err) {
        logger.error(`blind date reveal profile ${userId} failed: ${err}`, { className: filename });
        return null;
    }
};

const buildReveal = async (room) => {
    if (!room?.chatId || !room.guestId) return null;
    const [host, guest] = await Promise.all([loadRevealProfile(room.hostId), loadRevealProfile(room.guestId)]);
    return { chatId: String(room.chatId), host, guest };
};

/** View of a room for one of its participants. */
const participantView = async (room, userId) => {
    const isHost = String(room.hostId) === String(userId);
    const peerId = Rules.otherParticipant(room, userId);
    let peerName = isHost ? null : Rules.toPublicRoom(room).hostName;
    if (isHost && peerId) {
        const guest = await UserRepository.findById(peerId, 'userInfo.fullName');
        peerName = String(guest?.userInfo?.fullName || '').trim().split(/\s+/)[0] || null;
    }
    const { iWantMatch, peerWantsMatch, revealed } = Rules.matchFlagsFor(room, userId);
    return {
        ...Rules.toPublicRoom(room),
        role: isHost ? 'host' : 'guest',
        status: room.status,
        peerName,
        matched_at: room.matched_at,
        call_started_at: room.call_started_at,
        chatId: revealed ? String(room.chatId) : null,
        iWantMatch,
        peerWantsMatch,
        reveal: revealed ? await buildReveal(room) : null
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

    const host = await UserRepository.findById(userId, 'userInfo.fullName userInfo.gender userInfo.birthdate');
    if (!host) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);
    const now = new Date();
    try {
        const room = await BlindDate.create({
            hostId: new ObjectId(userId),
            hostName: host.userInfo.fullName,
            hostGender: host.userInfo.gender,
            hostAge: Rules.ageFrom(host.userInfo.birthdate, now) ?? undefined,
            conditions: Rules.normalizeConditions(req.body?.conditions),
            expires_at: new Date(now.getTime() + Rules.ROOM_RETENTION_MS)
        });
        logger.info(`Blind date room created: ${room._id} by ${userId}`, { className: filename, req });
        await savePreferences(userId, room.conditions);
        emitLobby('bd:roomOpened', room._id);
        return new BaseResponse(true, [c.CODE_SUCCESS], await participantView(room, userId));
    } catch (err) {
        // Unique partial index: a concurrent create by the same host.
        if (err?.code === 11000) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_BUSY);
        throw err;
    }
};

/** Fills `hostAge` from the hosts' birthdates (rooms created before it was stored on the room). */
const withHostAges = async (rooms, now = new Date()) => {
    const missing = [...new Set(rooms.filter(room => !Number.isInteger(room.hostAge)).map(room => String(room.hostId)))];
    if (missing.length === 0) return rooms;
    const hosts = await User.find({ _id: { $in: missing.map(id => new ObjectId(id)) } }, 'userInfo.birthdate').lean();
    const ages = new Map(hosts.map(host => [String(host._id), Rules.ageFrom(host.userInfo?.birthdate, now)]));
    return rooms.map(room => (Number.isInteger(room.hostAge) ? room : { ...room, hostAge: ages.get(String(room.hostId)) ?? null }));
};

const listRooms = async (req) => {
    const userId = userIdFrom(req);
    await requirePremium(userId);
    const me = await UserRepository.findById(userId, 'userInfo preferences musicPreferences');
    if (!me) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);
    const filter = Rules.buildOpenRoomsFilter(me, await excludedPeople(userId));
    const rooms = await withHostAges(await BlindDate.find(filter).sort({ created_at: -1 }).limit(50).lean());
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
        emitLobby('bd:roomClosed', roomId);
        const view = await participantView(claimed, userId);
        const guestName = String(me.userInfo?.fullName || '').trim().split(/\s+/)[0] || null;
        // Host: live socket if the waiting screen is open, push ONLY when they are not in the room.
        emitToRoom(roomId, 'bd:guestJoined', { roomId: String(roomId), guestName });
        notifyHostIfAway(roomId, claimed.hostId);
        scheduleHostTimeout(roomId, userId, now);
        return new BaseResponse(true, [c.CODE_SUCCESS], view);
    } finally {
        await redis.del(lockKey).catch(() => undefined);
    }
};

/** True when one of the user's sockets is joined to the room channel (waiting screen open). */
const isInRoom = async (roomId, userId) => {
    try {
        const { getSocketIO } = require('../../shared/config/ws');
        const sockets = await getSocketIO()?.of(NAMESPACE).in(roomChannel(roomId)).fetchSockets();
        return (sockets || []).some(socket => String(socket.data?.userId) === String(userId));
    } catch (err) {
        logger.error(`blind date presence check failed: ${err}`, { className: filename });
        return false; // when unsure, notify
    }
};

const notifyHostIfAway = async (roomId, hostId) => {
    if (await isInRoom(roomId, hostId)) return;
    PushNotification.proccessNotificationsByUser(String(hostId), constants.WS_EVENT_NEW_BLIND_DATE_GUEST,
        new BaseResponse(true, [], { roomId: String(roomId), url: '/?section=blindDates' }));
};

/** If the host never starts the call, the guest is released and the room reopens. */
const scheduleHostTimeout = (roomId, guestId, matchedAt) => {
    const timer = setTimeout(async () => {
        try {
            const reopened = await BlindDate.findOneAndUpdate(
                { _id: roomId, status: 'matched', guestId: new ObjectId(guestId), matched_at: matchedAt },
                { $set: { status: 'open', guestId: null }, $unset: { matched_at: 1 } },
                { new: true });
            if (reopened) { emitToRoom(roomId, 'bd:hostUnavailable', { roomId: String(roomId) }); emitLobby('bd:roomOpened', roomId); }
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
    if (cancelled) { emitLobby('bd:roomClosed', roomId); return cancelled; }

    const reopened = await BlindDate.findOneAndUpdate(
        { _id: roomId, guestId: me, status: 'matched' },
        { $set: { status: 'open', guestId: null }, $unset: { matched_at: 1 } }, { new: true });
    if (reopened) { emitToRoom(roomId, 'bd:peerLeft', { roomId: String(roomId), reopened: true }); emitLobby('bd:roomOpened', roomId); return reopened; }

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
 * "Match" can be pressed during the call or answered after it.
 *  - One yes → the other participant gets bd:peerWantsMatch (shown as a hint).
 *  - Both yes → exactly one request (guarded by matchState) creates the match + chat
 *    through LikesService.matchTasks; then both profiles are revealed (bd:matched + REST).
 */
const matchIntent = async (req) => {
    const userId = userIdFrom(req);
    const roomId = parseRoomId(req.params.id);
    const wantsMatch = req.body?.wantsMatch === true;
    const room = await BlindDate.findById(roomId);
    if (!Rules.isParticipant(room, userId) || !room.guestId) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_FOUND);
    if (!['ended', 'in_call'].includes(room.status)) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_FOUND);

    const role = Rules.roleOf(room, userId);
    const field = role === 'host' ? 'hostWantsMatch' : 'guestWantsMatch';
    const updated = await BlindDate.findOneAndUpdate({ _id: roomId }, { $set: { [field]: wantsMatch } }, { new: true });
    if (!(updated.hostWantsMatch && updated.guestWantsMatch)) {
        const peerField = field === 'hostWantsMatch' ? 'guestWantsMatch' : 'hostWantsMatch';
        const peerAnswered = typeof updated[peerField] === 'boolean';
        if (wantsMatch) emitToRoom(roomId, 'bd:peerWantsMatch', { roomId: String(roomId), by: role });
        return new BaseResponse(true, [c.CODE_SUCCESS], { isMatch: false, waitingForPeer: wantsMatch && !peerAnswered, reveal: null });
    }

    const winner = await BlindDate.findOneAndUpdate(
        { _id: roomId, hostWantsMatch: true, guestWantsMatch: true, matchState: { $exists: false } },
        { $set: { matchState: 'creating' } }, { new: true });
    if (!winner) {
        // The peer's request is creating (or created) the match: wait briefly for it.
        const done = await waitForMatchDone(roomId);
        const reveal = await buildReveal(done);
        return new BaseResponse(true, [c.CODE_SUCCESS], { isMatch: Boolean(reveal), chatId: reveal?.chatId || null, reveal });
    }

    const otherId = String(Rules.otherParticipant(updated, userId));
    let existing = await Match.findOne({ users: { $all: [new ObjectId(userId), new ObjectId(otherId)] } });
    if (existing && existing.status !== 'matched') {
        // Legacy unmatched record: start clean so the new match gets a fresh chat.
        await require('./relationship.service').purgeRelationship(userId, otherId);
        existing = null;
    }
    let chatId = existing?._id || null;
    if (!existing) {
        // Pushes newMatch to the other participant, like a regular reciprocal like.
        const data = await LikesService.matchTasks(String(userId), { toUserId: otherId }, { isMatch: true });
        chatId = data.chatId;
    }
    const finished = await BlindDate.findOneAndUpdate({ _id: roomId }, { $set: { matchState: 'done', chatId } }, { new: true });
    const reveal = await buildReveal(finished);
    if (reveal) emitToRoom(roomId, 'bd:matched', { roomId: String(roomId), ...reveal });
    return new BaseResponse(true, [c.CODE_SUCCESS], { isMatch: Boolean(reveal), chatId: reveal?.chatId || null, reveal });
};

const MATCH_WAIT_ATTEMPTS = 10;
const MATCH_WAIT_STEP_MS = 300;
const waitForMatchDone = async (roomId) => {
    for (let attempt = 0; attempt < MATCH_WAIT_ATTEMPTS; attempt++) {
        const room = await BlindDate.findById(roomId);
        if (!room || room.matchState === 'done') return room;
        await new Promise(resolve => setTimeout(resolve, MATCH_WAIT_STEP_MS));
    }
    // Still creating: the bd:matched event will deliver the reveal.
    return null;
};

const savePreferences = async (userId, conditions) => {
    try {
        await BlindDatePreference.updateOne(
            { userId: new ObjectId(userId) },
            { $set: { conditions: Rules.normalizeConditions(conditions || {}), updated_at: new Date() } },
            { upsert: true });
    } catch (err) {
        // Preferences are a convenience: never fail the room creation for them.
        logger.error(`blind date preferences save failed: ${err}`, { className: filename });
    }
};

/** Filters used last time, to pre-select them in the "create room" screen (null = never created one). */
const getPreferences = async (req) => {
    const userId = userIdFrom(req);
    const pref = await BlindDatePreference.findOne({ userId: new ObjectId(userId) }).lean();
    return new BaseResponse(true, [], pref ? Rules.normalizeConditions(pref.conditions || {}) : null);
};

/**
 * Report and/or block the other participant from inside the call. The guest never
 * learns the host id (and vice versa) before a match, so the server resolves it.
 * Blocking stores a "blocked" match record: they never meet again (discover,
 * blind dates, quick messages). The call ends for both.
 */
const reportPeer = async (req) => {
    const userId = userIdFrom(req);
    const roomId = parseRoomId(req.params.id);
    const { reportReason, message, block } = req.body || {};
    const room = await BlindDate.findById(roomId).lean();
    if (!Rules.isParticipant(room, userId) || !room.guestId) throw new BusinessException(c.CODE_ERROR_BLIND_DATE_NOT_FOUND);
    const otherId = String(Rules.otherParticipant(room, userId));

    if (reportReason) {
        const ReportService = require('./report.service');
        await ReportService.report({ headers: req.headers, body: { reportedUserId: otherId, reportReason, message } });
    }
    if (block) await blockPair(userId, otherId);

    await endForUser(roomId, userId, block ? 'blocked' : 'reported');
    logger.info(`Blind date ${roomId}: ${userId} reported=${Boolean(reportReason)} blocked=${Boolean(block)}`, { className: filename, req });
    return new BaseResponse(true, [c.CODE_SUCCESS], { blocked: Boolean(block), reported: Boolean(reportReason) });
};

const blockPair = async (userId, otherId) => {
    const me = new ObjectId(userId);
    const other = new ObjectId(otherId);
    // Start clean (likes, quick messages, a previous chat), then keep only the block.
    await require('./relationship.service').purgeRelationship(userId, otherId);
    await Match.updateOne(
        { users: { $all: [me, other] } },
        { $set: { status: MatchStatus.BLOCKED, lastUpdatedBy: me, updated_at: new Date() }, $setOnInsert: { users: [me, other].sort((a, b) => String(a).localeCompare(String(b))) } },
        { upsert: true });
    await require('./call.service').endCallsBetween(userId, otherId);
};

const turnCredentials = async (req) => {
    const userId = userIdFrom(req);
    await requirePremium(userId);
    const { iceServers, ttlSecs } = await getIceServers(userId);
    return new BaseResponse(true, [], { iceServers, ttlSecs });
};

module.exports = {
    NAMESPACE,
    LOBBY_CHANNEL,
    roomChannel,
    getPreferences,
    reportPeer,
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
