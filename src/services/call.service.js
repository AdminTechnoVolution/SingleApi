const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const ObjectId = require('mongoose').Types.ObjectId;
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const jwtUtil = require('../../shared/util/jwt');
const { getIceServers } = require('../../shared/util/turnCredentials');
const Call = require('../models/call.model');
const Match = require('../models/match.model');
const BlindDate = require('../models/blindDate.model');
const MatchStatus = require('../enums/EnumMatchStatus');
const UserRepository = require('../repository/user.repository');
const PremiumService = require('./premium.service');
const Rules = require('./call.rules');

const NAMESPACE = '/ws/calls';
const PEER_FIELDS = 'userInfo.fullName photos';

const userIdFrom = (req) => jwtUtil.getValueFromJwtToken(req.headers['authorization'], 'id');
/** Every socket of a user joins this channel on /ws/calls (all their devices ring). */
const userChannel = (userId) => `user:${userId}`;

const emitToUsers = (userIds, event, payload) => {
    try {
        // Lazy require: ws.js loads the signaling handler, which loads this service.
        const { getSocketIO } = require('../../shared/config/ws');
        const nsp = getSocketIO()?.of(NAMESPACE);
        if (!nsp) return;
        userIds.filter(Boolean).forEach(id => nsp.to(userChannel(String(id))).emit(event, payload));
    } catch (err) {
        logger.error(`call emit ${event} failed: ${err}`, { className: filename });
    }
};

/** Data-only push (Android rings natively; the PWA service worker builds the notification). */
const pushToUser = (userId, type, data, ttlSecs) => {
    try {
        // Lazy require: firebase-admin initialises on load.
        const PushNotification = require('../../shared/util/pushNotification');
        PushNotification.sendDataPushToUser(String(userId), type, data, { ttlSecs }).catch(err =>
            logger.error(`call push ${type} failed: ${err}`, { className: filename }));
    } catch (err) {
        logger.error(`call push ${type} failed: ${err}`, { className: filename });
    }
};

const parseId = (value) => {
    if (!ObjectId.isValid(value)) throw new BusinessException(c.CODE_ERROR_CALL_NOT_FOUND);
    return new ObjectId(value);
};

const loadPeer = (userId) => UserRepository.findById(userId, PEER_FIELDS);

const viewFor = async (call, userId) => Rules.toCallView(call, userId, await loadPeer(Rules.peerOf(call, userId)));

/** Closes calls left "active" by crashed apps or a server restart (lost ring timer). */
const closeStale = async (userIds, now = new Date()) => {
    const people = userIds.map(id => new ObjectId(String(id)));
    const mine = { $or: [{ caller: { $in: people } }, { callee: { $in: people } }] };
    await Call.updateMany(
        { ...mine, status: 'ringing', created_at: { $lt: new Date(now - Rules.RING_TIMEOUT_MS * 2) } },
        { $set: { status: 'missed', ended_at: now } });
    await Call.updateMany(
        { ...mine, status: 'accepted', answered_at: { $lt: new Date(now - Rules.STALE_CALL_MS) } },
        { $set: { status: 'ended', ended_at: now } });
};

const activeCallOf = (userId) => Call.findOne({
    $or: [{ caller: new ObjectId(String(userId)) }, { callee: new ObjectId(String(userId)) }],
    status: { $in: Rules.ACTIVE_STATUSES }
});

const inBlindDate = (userId) => BlindDate.exists({
    $or: [{ hostId: new ObjectId(String(userId)) }, { guestId: new ObjectId(String(userId)) }],
    status: { $in: ['matched', 'in_call'] }
});

/**
 * POST /api/calls {chatId, kind}. Only Premium users start calls; anyone answers.
 * The callee rings on every device: socket call:incoming (app open) + a
 * high-priority data push (app closed → full-screen incoming call on Android).
 */
const startCall = async (req) => {
    const userId = userIdFrom(req);
    const { chatId, kind } = req.body;
    if (!(await PremiumService.isPremium(userId))) throw new BusinessException(c.CODE_ERROR_PREMIUM_REQUIRED);

    const matchId = parseId(chatId);
    const match = await Match.findOne({ _id: matchId, users: new ObjectId(userId), status: MatchStatus.MATCHED }).lean();
    if (!match) throw new BusinessException(c.CODE_ERROR_CALL_NOT_ALLOWED);
    const calleeId = match.users.map(String).find(id => id !== String(userId));
    if (!calleeId) throw new BusinessException(c.CODE_ERROR_CALL_NOT_ALLOWED);

    await closeStale([userId, calleeId]);
    // Starting a call means any older call of mine is dead (one call per person).
    const mine = await activeCallOf(userId);
    if (mine) await finish(mine, userId, Rules.transitionFor(mine, userId, 'end'));
    if (await activeCallOf(calleeId) || await inBlindDate(calleeId)) throw new BusinessException(c.CODE_ERROR_CALL_BUSY);

    const now = new Date();
    const call = await Call.create({
        chatId: matchId,
        caller: new ObjectId(userId),
        callee: new ObjectId(calleeId),
        kind,
        created_at: now,
        expires_at: new Date(now.getTime() + Rules.RETENTION_MS)
    });
    logger.info(`Call ${call._id} (${kind}) ${userId} → ${calleeId}`, { className: filename, req });

    const caller = await loadPeer(userId);
    const incoming = Rules.toCallView(call, calleeId, caller);
    emitToUsers([calleeId], 'call:incoming', incoming);
    pushToUser(calleeId, constants.WS_EVENT_INCOMING_CALL, incoming, Math.round(Rules.RING_TIMEOUT_MS / 1000));
    scheduleRingTimeout(call._id);

    const { iceServers } = await getIceServers(userId);
    return new BaseResponse(true, [c.CODE_SUCCESS], { call: await viewFor(call, userId), iceServers });
};

const scheduleRingTimeout = (callId) => {
    const timer = setTimeout(async () => {
        try {
            const call = await Call.findOneAndUpdate(
                { _id: callId, status: 'ringing' }, { $set: { status: 'missed', ended_at: new Date() } }, { new: true });
            if (call) notifyFinished(call);
        } catch (err) {
            logger.error(`call ring timeout failed: ${err}`, { className: filename });
        }
    }, Rules.RING_TIMEOUT_MS);
    timer.unref?.();
};

/** Both participants (all devices) learn the new status; the callee's ringing push is withdrawn. */
const notifyFinished = (call, by = null) => {
    const payload = { callId: String(call._id), chatId: String(call.chatId), status: call.status, by: by ? String(by) : null };
    emitToUsers([call.caller, call.callee], 'call:status', payload);
    if (Rules.RING_OUTCOMES.includes(call.status)) {
        // The ring ended: stop it on the callee's devices (cancelled/missed → "missed call").
        loadPeer(call.caller).then(caller => pushToUser(call.callee, constants.WS_EVENT_CALL_STATUS,
            { ...payload, kind: call.kind, peerName: Rules.firstName(caller) }, 60))
            .catch(() => undefined);
    }
};

/** Atomic transition: only one of accept/cancel/timeout wins a ringing call. */
const finish = async (call, userId, transition) => {
    const now = new Date();
    const set = { status: transition.to };
    if (transition.to === 'accepted') set.answered_at = now;
    else { set.ended_at = now; set.endedBy = new ObjectId(String(userId)); }
    const updated = await Call.findOneAndUpdate({ _id: call._id, status: transition.from }, { $set: set }, { new: true });
    if (updated) notifyFinished(updated, userId);
    return updated;
};

const act = (action) => async (req) => {
    const userId = userIdFrom(req);
    const call = await Call.findById(parseId(req.params.id));
    if (!Rules.isParticipant(call, userId)) throw new BusinessException(c.CODE_ERROR_CALL_NOT_FOUND);
    const transition = Rules.transitionFor(call, userId, action);
    const updated = transition ? await finish(call, userId, transition) : null;
    if (!updated) {
        // Lost the race (cancelled / timed out / answered elsewhere): report the real status.
        const current = await Call.findById(call._id);
        if (action === 'accept') throw new BusinessException(c.CODE_ERROR_CALL_ENDED);
        return new BaseResponse(true, [c.CODE_SUCCESS], { call: await viewFor(current, userId) });
    }
    const data = { call: await viewFor(updated, userId) };
    if (action === 'accept') data.iceServers = (await getIceServers(userId)).iceServers;
    return new BaseResponse(true, [c.CODE_SUCCESS], data);
};

/** GET /api/calls/:id — fresh state (opening the app from the push) + ICE servers while active. */
const getCall = async (req) => {
    const userId = userIdFrom(req);
    const call = await Call.findById(parseId(req.params.id));
    if (!Rules.isParticipant(call, userId)) throw new BusinessException(c.CODE_ERROR_CALL_NOT_FOUND);
    if (Rules.isStale(call)) await closeStale([userId]);
    const fresh = await Call.findById(call._id);
    const data = { call: await viewFor(fresh, userId) };
    if (Rules.ACTIVE_STATUSES.includes(fresh.status)) data.iceServers = (await getIceServers(userId)).iceServers;
    return new BaseResponse(true, [], data);
};

/** Used by the socket: is this an accepted call the user takes part in? Returns the peer id. */
const peerInAcceptedCall = async (callId, userId) => {
    if (!ObjectId.isValid(callId)) return null;
    const call = await Call.findById(callId).lean();
    if (!call || call.status !== 'accepted' || !Rules.isParticipant(call, userId)) return null;
    return String(Rules.peerOf(call, userId));
};

const endById = async (callId, userId) => {
    if (!ObjectId.isValid(callId)) return null;
    const call = await Call.findById(callId);
    const transition = Rules.isParticipant(call, userId) ? Rules.transitionFor(call, userId, 'end') : null;
    return transition ? finish(call, userId, transition) : null;
};

/** Unmatch / block: a call between the two must not survive. */
const endCallsBetween = async (userA, userB, byUserId = userA) => {
    try {
        const a = new ObjectId(String(userA));
        const b = new ObjectId(String(userB));
        const calls = await Call.find({ $or: [{ caller: a, callee: b }, { caller: b, callee: a }], status: { $in: Rules.ACTIVE_STATUSES } });
        for (const call of calls) {
            const transition = Rules.transitionFor(call, byUserId, 'end');
            if (transition) await finish(call, byUserId, transition);
        }
    } catch (err) {
        logger.error(`endCallsBetween failed: ${err}`, { className: filename });
    }
};

module.exports = {
    NAMESPACE,
    userChannel,
    startCall,
    acceptCall: act('accept'),
    declineCall: act('decline'),
    cancelCall: act('cancel'),
    endCall: act('end'),
    getCall,
    peerInAcceptedCall,
    endById,
    endCallsBetween
};
