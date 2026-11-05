const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const BaseResponse = require('../../shared/util/baseResponse');
const BasePaginatedResponse = require('../../shared/util/basePaginatedResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const ObjectId = require("mongoose").Types.ObjectId;
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const jwtUtil = require('../../shared/util/jwt');
const PushNotification = require('../../shared/util/pushNotification');
const PremiumService = require('./premium.service');
const ClientVersionService = require('./clientVersion.service');
const { buildReceivedPipeline } = require('./quickMessage.pipeline');
const LikesService = require('./likes.service');
const QuickMessageRepository = require('../repository/quickMessage.repository');
const LikeRepository = require('../repository/likes.repository');
const DislikesRepository = require('../repository/dislikes.repository');
const MatchRepository = require('../repository/match.repository');
const MatchStatus = require('../enums/EnumMatchStatus');
const RelationshipService = require('./relationship.service');
const UserRepository = require('../repository/user.repository');
const QuickMessage = require('../models/quickMessage.model');
const Likes = require('../models/likes.model');

const DEFAULT_PAGE_SIZE = 20;
const pageSize = () => Number(process.env.LIMIT_GET_QUICK_MESSAGES_RECEIVED) || DEFAULT_PAGE_SIZE;

/**
 * POST /api/actions/quick-message — premium only.
 * Sends a short note to someone you have not matched with yet. It also counts
 * as a like: if they had already liked you, it is an instant match and the
 * note becomes the first message of the new chat.
 */
const sendQuickMessage = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers['authorization'], 'id');
    const { toUserId, content } = req.body;

    await validateSendQuickMessage(userId, toUserId);

    await QuickMessageRepository.save(new QuickMessage({ fromUserId: userId, toUserId, content }));

    // Quick message implies a like (premium: no daily limit applies).
    const existingLike = await LikeRepository.findByAnyFilter({ fromUserId: userId, toUserId });
    if (!existingLike.length) {
        await LikeRepository.save(new Likes({ fromUserId: userId, toUserId }));
    }
    // Like and dislike are exclusive: the latest action wins.
    await DislikesRepository.deleteManyByFilter({ fromUserId: new ObjectId(userId), toUserId: new ObjectId(toUserId) });

    const isMatch = await LikesService.validateIsMatch({ toUserId }, userId);
    let data = { isMatch };
    if (isMatch) {
        // matchTasks moves this quick message into the new chat.
        data = await LikesService.matchTasks(userId, { toUserId }, data);
    } else {
        await notifyRecipient(userId, toUserId);
    }

    logger.info(`Quick message sent: fromUserId: ${userId}, toUserId: ${toUserId}, isMatch: ${isMatch}`, { className: filename, req });
    return new BaseResponse(true, [c.CODE_SUCCESS], data);
};

/**
 * Recipients on an app that can show quick messages get `newQuickMessage`.
 * Legacy apps silently ignore unknown push types, so they get `newLike`
 * instead — accurate, since a quick message also creates a like, and it shows
 * up in their "Likes you". Once they update, the quick message is waiting.
 */
const notifyRecipient = async (userId, toUserId) => {
    try {
        if (await ClientVersionService.userSupportsQuickMessages(toUserId)) {
            const sender = await UserRepository.findById(userId, 'userInfo.fullName');
            // No content in the payload: the recipient may not be premium.
            const notification = new BaseResponse(true, [], { fromUserId: userId, fullName: sender?.userInfo?.fullName });
            PushNotification.proccessNotificationsByUser(toUserId, constants.WS_EVENT_NEW_QUICK_MESSAGE, notification);
        } else {
            PushNotification.proccessNotificationsByUser(toUserId, constants.WS_EVENT_NEW_LIKE, new BaseResponse(true));
        }
    } catch (err) {
        logger.error(`Error notifying quick message recipient ${toUserId}: ${err}`, { className: filename });
    }
};

const validateSendQuickMessage = async (userId, toUserId) => {
    if (toUserId === userId) throw new BusinessException(c.CODE_ERROR_USER_CANNOT_LIKE_SELF);
    if (!ObjectId.isValid(toUserId)) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);

    if (!(await PremiumService.isPremium(userId))) throw new BusinessException(c.CODE_ERROR_PREMIUM_REQUIRED);

    const target = await UserRepository.findOneByFilter({ _id: toUserId, status: constants.STATUS_DESC_ACTIVE });
    if (!target) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);

    // A live match or a block closes this channel. Legacy "unmatched" records
    // (from before unmatch deleted everything) are cleaned up instead.
    const match = await MatchRepository.findOneByFilter({ users: { $all: [new ObjectId(userId), new ObjectId(toUserId)] } });
    if (match?.status === MatchStatus.UNMATCHED) await RelationshipService.purgeRelationship(userId, toUserId);
    else if (match) throw new BusinessException(c.CODE_ERROR_ALREADY_MATCHED);

    const alreadySent = await QuickMessageRepository.findOneByFilter({ fromUserId: userId, toUserId });
    if (alreadySent) throw new BusinessException(c.CODE_ERROR_QUICK_MESSAGE_ALREADY_SENT);
};

/**
 * GET /api/actions/quick-messages/received?cursor=
 * Everyone gets the list (count + sender teaser, like "likes received"), but the
 * message text is only projected out of MongoDB for premium users; free users
 * receive `content: null, locked: true`.
 */
const quickMessagesReceived = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers['authorization'], 'id');
    const canRead = await PremiumService.isPremium(userId);
    const limit = pageSize();

    const pipeline = buildReceivedPipeline(userId, req.query.cursor, canRead, limit);
    const results = await QuickMessageRepository.findByPipeline(pipeline);

    const hasMore = results.length === limit;
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    return new BaseResponse(true, [], new BasePaginatedResponse(results, {
        nextCursor,
        pageSize: results.length,
        hasMore
    }));
};

module.exports = { sendQuickMessage, quickMessagesReceived };
