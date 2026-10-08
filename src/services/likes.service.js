const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const BasePaginatedResponse = require('../../shared/util/basePaginatedResponse');
const ObjectId = require("mongoose").Types.ObjectId;
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const jwtUtil = require('../../shared/util/jwt');
const ConfigService = require('./config.service');
const LikeRepository = require('../repository/likes.repository');
const ChatRepository = require('../repository/chat.repository');
const MatchRepository = require('../repository/match.repository');
const UserRepository = require('../repository/user.repository');
const SubscriptionRepository = require('../repository/subscription.repository');
const Likes = require('../models/likes.model');
const Chat = require('../models/chat.model');
const Match = require('../models/match.model');
const PushNotification = require('../../shared/util/pushNotification');
const limitGetLikesReceived = Number(process.env.LIMIT_GET_LIKES_RECEIVED);

const sendLike = async (req) => {
    let token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');
    let body = req.body;
    await validateSendLike(body, userId);
    await validateLikesPerDay(userId);

    const like = new Likes({
        fromUserId: userId,
        toUserId: body.toUserId
    });

    await LikeRepository.save(like);

    const isMatch = await validateIsMatch(body, userId);
    logger.info(`Like sent: fromUserId: ${userId}, toUserId: ${body.toUserId}, isMatch: ${isMatch}`, { className: filename, req: req });
    let data = {
        isMatch
    };

    if (isMatch) {
        data = await matchTasks(userId, body, data);
    } else {
        data = await likeTasks(body);
    }

    message = c.CODE_SUCCESS;
    return new BaseResponse(true, [message], data);
};

const likeTasks = async (body) => {
    const data = new BaseResponse(true);
    PushNotification.proccessNotificationsByUser(body.toUserId, constants.WS_EVENT_NEW_LIKE, data);
}

const matchTasks = async (userId, body, data) => {
    const orderedUsers = [userId, body.toUserId].sort();
    let match = new Match({
        users: orderedUsers
    });

    match = await MatchRepository.save(match);

    let chat = new Chat({
        _id: match._id,
        users: orderedUsers,
        unreadCounts: {
            [userId]: 0,
            [body.toUserId]: 0
        },
        lastMessage: {}
    });

    chat = await ChatRepository.save(chat);

    data.matchId = match._id;
    data.chatId = chat._id;

    const filter = { fromUserId: new ObjectId(userId), toUserId: new ObjectId(body.toUserId) };
    const filterOpposite = { fromUserId: new ObjectId(body.toUserId), toUserId: new ObjectId(userId) };

    await LikeRepository.deleteByFilter(filter);
    await LikeRepository.deleteByFilter(filterOpposite);

    for (const u of chat.users) {
        const userIdStr = u.toString();
        if (userIdStr !== userId) {
            const userFound = await UserRepository.findById(userId, 'userInfo.fullName photos');
            const data = new BaseResponse(true, [], {
                chatId: chat._id,
                matchWith: userFound._id,
                fullName: userFound.userInfo.fullName,
                photos: userFound.photos
            });
            PushNotification.proccessNotificationsByUser(userIdStr, constants.WS_EVENT_NEW_MATCH, data);
        }
    }
    return data;
}

const likesReceived = async (req) => {
    const queryParams = req.query;
    let token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');

    const pipeline = await createPipeline(userId, queryParams);

    let likesReceived = await LikeRepository.findByPipeline(pipeline);

    const hasMore = likesReceived.length === limitGetLikesReceived;
    const nextCursor = (hasMore && likesReceived.length > 0) ? likesReceived[likesReceived.length - 1]._id : null;

    const response = new BasePaginatedResponse(
        likesReceived,
        {
            nextCursor,
            pageSize: likesReceived.length,
            hasMore
        });

    return new BaseResponse(true, [], response);
}

const createPipeline = async (userId, queryParams) => {
    // Precompute my data
    const cursorObjectId = queryParams.cursor ? new ObjectId(queryParams.cursor) : null;
    const pipeline = [];

    // Find by user and only matched status
    const matchStage = {
        toUserId: new ObjectId(userId),
        //status: constants.STATUS_DESC_LIKED
    };

    // Filter by cursor to paginate results
    if (cursorObjectId) {
        matchStage._id = { ...matchStage._id, $gt: cursorObjectId };
    }

    pipeline.push({ $match: matchStage });

    // Lookup to get user details
    pipeline.push({
        $lookup: {
            from: "users",
            localField: "fromUserId",
            foreignField: "_id",
            as: "users"
        }
    });

    // Unwind the users array to get a single user object
    pipeline.push({ $unwind: "$users" });

    // keep only the fields we want + filter isProfile photo
    pipeline.push({
        $project: {
            _id: 1,
            "user._id": "$users._id",
            "user.fullName": "$users.userInfo.fullName",
            "user.photos": {
                $filter: {
                    input: "$users.photos",
                    as: "photo",
                    cond: { $eq: ["$$photo.isProfile", true] }
                }
            }
        }
    });

    // Sort and limit for pagination
    pipeline.push(
        { $sort: { _id: -1 } },
        { $limit: limitGetLikesReceived }
    );

    return pipeline;
};

const validateIsMatch = async (body, userId) => {
    const isReciprocal = await LikeRepository.findByAnyFilter({ fromUserId: body.toUserId, toUserId: userId });
    return Array.isArray(isReciprocal) && isReciprocal.length > 0;
}

const validateSendLike = async (body, userId) => {
    if (body.toUserId === userId) throw new BusinessException(c.CODE_ERROR_USER_CANNOT_LIKE_SELF);

    const existingToUser = await UserRepository.findOneByFilter({ _id: body.toUserId, status: constants.STATUS_DESC_ACTIVE });
    if (!existingToUser) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);
};

const validateLikesPerDay = async (userId) => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const filter = {
        userId: new ObjectId(userId),
        'paymentInfo.fromDate': { $lte: now },
        'paymentInfo.toDate': { $gte: now }
    };

    let subscriptionDB = await SubscriptionRepository.findByFilter(filter);
    if (!subscriptionDB) {
        subscriptionDB = await SubscriptionRepository.findActiveStripeForUser(new ObjectId(userId));
    }
    if (!subscriptionDB) {
        const configResponse = await ConfigService.getConfigs();
        const configs = configResponse.data;
        const likesPerDayConfig = configs.find(c => c.key === constants.BASIC_PLAN_LIKES_PER_DAY);
        const likesPerDayLimit = parseInt(likesPerDayConfig.value);

        const filterLikes = {
            fromUserId: new ObjectId(userId),
            created_at: { $gte: start, $lte: end }
        };

        const likesSentToday = await LikeRepository.countLikesByFilter(filterLikes);
        if (likesSentToday >= likesPerDayLimit) throw new BusinessException(c.CODE_ERROR_LIKES_PER_DAY_EXCEEDED);
    }
};

module.exports = { sendLike, likesReceived };
