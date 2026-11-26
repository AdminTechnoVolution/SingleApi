const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const ObjectId = require('mongoose').Types.ObjectId;
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const consCache = require('../../shared/util/constants.cache');
const jwtUtil = require('../../shared/util/jwt');
const MatchStatus = require('../enums/EnumMatchStatus');
const Rules = require('./nextLevel.rules');

const CHATS_NAMESPACE = '/ws/chats';

/** Real dependencies; tests inject fakes (same pattern as relationship.service). */
const defaultDeps = () => ({
    Match: require('../models/match.model'),
    User: require('../models/user.model'),
    Conversation: require('../models/conversation.model'),
    Call: require('../models/call.model'),
    emitToUser: emitToUserOnChats,
    pushToUser: pushNextLevelUnlocked
});

/** Emits to every /ws/chats socket of a user (socket ids are tracked in Redis, like openChat). */
async function emitToUserOnChats(userId, event, payload) {
    try {
        // Lazy require: ws.js loads the chat handlers.
        const { getSocketIO } = require('../../shared/config/ws');
        const redis = require('../../shared/config/redis');
        const nsp = getSocketIO()?.of(CHATS_NAMESPACE);
        if (!nsp) return;
        const sockets = await redis.sMembers(`${consCache.REDIS_KEY_USER_SOCKETS}${userId}`);
        for (const sid of sockets || []) nsp.to(sid).emit(event, payload);
    } catch (err) {
        logger.error(`next level emit ${event} to ${userId} failed: ${err}`, { className: filename });
    }
}

function pushNextLevelUnlocked(userId, data) {
    try {
        // Lazy require: firebase-admin initialises on load.
        const PushNotification = require('../../shared/util/pushNotification');
        PushNotification.proccessNotificationsByUser(String(userId), constants.WS_EVENT_NEXT_LEVEL_UNLOCKED, new BaseResponse(true, [], data))
            .catch(err => logger.error(`next level push failed: ${err}`, { className: filename }));
    } catch (err) {
        logger.error(`next level push failed: ${err}`, { className: filename });
    }
}

const userIdFrom = (req) => jwtUtil.getValueFromJwtToken(req.headers['authorization'], 'id');

const loadConnection = async (chatId, userId, deps) => {
    if (!ObjectId.isValid(chatId)) throw new BusinessException(c.CODE_ERROR_CONNECTION_NOT_FOUND, 404);
    const match = await deps.Match.findOne({ _id: new ObjectId(chatId), users: new ObjectId(userId), status: MatchStatus.MATCHED }).lean();
    if (!match) throw new BusinessException(c.CODE_ERROR_CONNECTION_NOT_FOUND, 404);
    return match;
};

const peerOf = (match, userId) => (match.users || []).map(String).find(id => id !== String(userId));

/** Evaluates eligibility for the requester (cheap: counts are capped). */
const computeEligible = async (match, userId, deps) => {
    const peerId = peerOf(match, userId);
    const people = await deps.User.find({ _id: { $in: [new ObjectId(userId), new ObjectId(peerId)] } }, 'profileConfig.openToDating').lean();
    const openOf = (id) => people.find(p => String(p._id) === String(id))?.profileConfig?.openToDating === true;
    const meOpenToDating = openOf(userId);
    if (!meOpenToDating) return false;
    const peerOpenToDating = openOf(peerId);
    if (peerOpenToDating) return true;
    const messageCount = await deps.Conversation.countDocuments({ chatId: match._id }, { limit: Rules.MIN_MESSAGES });
    if (Rules.isEligible({ meOpenToDating, peerOpenToDating, messageCount })) return true;
    const completedCalls = await deps.Call.countDocuments(
        { chatId: match._id, status: 'ended', answered_at: { $exists: true } }, { limit: Rules.MIN_COMPLETED_CALLS });
    return Rules.isEligible({ meOpenToDating, peerOpenToDating, messageCount, completedCalls });
};

/** GET /api/connections/:chatId/next-level */
const getStatus = async (req, deps = defaultDeps()) => {
    const userId = userIdFrom(req);
    const match = await loadConnection(req.params.chatId, userId, deps);
    const eligible = Rules.isUnlocked(match) || await computeEligible(match, userId, deps);
    return new BaseResponse(true, [], Rules.viewFor(match, userId, eligible));
};

/**
 * POST /api/connections/:chatId/next-level { wants }
 *  - wants=true requires eligibility; wants=false (withdraw) is always allowed before unlock.
 *  - Once unlocked it stays unlocked (wants is ignored).
 *  - When both want it: exactly one request sets unlockedAt, then both users get the
 *    socket event `connection:nextLevel` on /ws/chats and the push `nextLevelUnlocked`.
 */
const setWish = async (req, deps = defaultDeps()) => {
    const userId = userIdFrom(req);
    const wants = req.body?.wants === true;
    let match = await loadConnection(req.params.chatId, userId, deps);
    if (Rules.isUnlocked(match)) return new BaseResponse(true, [c.CODE_SUCCESS], Rules.viewFor(match, userId, true));

    const eligible = await computeEligible(match, userId, deps);
    if (wants && !eligible) throw new BusinessException(c.CODE_ERROR_NEXT_LEVEL_NOT_ELIGIBLE, 403);

    match = await deps.Match.findOneAndUpdate(
        { _id: match._id, status: MatchStatus.MATCHED },
        { $set: { [`nextLevel.users.${userId}`]: wants } },
        { new: true }).lean();
    if (!match) throw new BusinessException(c.CODE_ERROR_CONNECTION_NOT_FOUND, 404);

    if (wants && Rules.bothWant(match) && !Rules.isUnlocked(match)) {
        const unlocked = await deps.Match.findOneAndUpdate(
            Rules.buildUnlockFilter(match),
            { $set: { 'nextLevel.unlockedAt': new Date() } },
            { new: true }).lean();
        if (unlocked) {
            match = unlocked;
            await notifyUnlocked(unlocked, deps);
        } else {
            // The peer's concurrent request won the unlock.
            match = await deps.Match.findOne({ _id: match._id }).lean() || match;
        }
    }

    logger.info(`Next level wish: chat ${match._id} user ${userId} wants ${wants} unlocked ${Rules.isUnlocked(match)}`, { className: filename, req });
    return new BaseResponse(true, [c.CODE_SUCCESS], Rules.viewFor(match, userId, eligible));
};

const notifyUnlocked = async (match, deps) => {
    const payload = { chatId: String(match._id), unlockedAt: match.nextLevel.unlockedAt };
    for (const id of (match.users || []).map(String)) {
        await deps.emitToUser(id, constants.WS_EVENT_CONNECTION_NEXT_LEVEL, JSON.stringify(new BaseResponse(true, [], payload)));
        deps.pushToUser(id, payload);
    }
};

module.exports = { getStatus, setWish, computeEligible };
