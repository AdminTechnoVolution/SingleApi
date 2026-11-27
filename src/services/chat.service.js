const ObjectId = require("mongoose").Types.ObjectId;
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const BasePaginatedResponse = require('../../shared/util/basePaginatedResponse');
const BaseResponse = require('../../shared/util/baseResponse');
const c = require('../../shared/util/constants.frontcodes');
const ChatRepository = require('../repository/chat.repository');
const ConversationRepository = require('../repository/conversation.repository');
const MatchStatus = require('../enums/EnumMatchStatus');
const MatchRepository = require('../repository/match.repository');
const { randomUUID } = require('crypto');
const { getChatAudioUploader } = require('../../shared/util/chatAudioStorage');
const { clampDurationMs, voiceNoteBlobPath } = require('../../shared/util/voiceNote');
const jwtUtil = require('../../shared/util/jwt');
const limitGetChats = Number(process.env.LIMIT_GET_CHATS);
const limitGetConversations = Number(process.env.LIMIT_GET_CONVERSATIONS);

const deleteChatConversation = async (req) => {
    const { chatId } = req.params;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    const chat = await validateUserInChat(chatId, userId);

    chat.deletedAt.set(userId, new Date());

    await chat.save();

    return new BaseResponse(true);
}

const getChatConversations = async (req) => {
    const { chatId } = req.params;
    const { cursor } = req.query;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    const chat = await validateUserInChat(chatId, userId);

    const pipeline = await createPipelineConversations(chat, userId, cursor);

    const conversations = await ConversationRepository.findByPipeline(pipeline);

    const hasMore = conversations.length === limitGetConversations;
    const nextCursor = (hasMore && conversations.length > 0) ? conversations[conversations.length - 1]._id : null;

    const response = new BasePaginatedResponse(
        conversations,
        {
            nextCursor,
            pageSize: conversations.length,
            hasMore
        });

    return new BaseResponse(true, [], response);
}

const messageSeen = async (req) => {
    const { chatId } = req.params;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    const chat = await validateUserInChat(chatId, userId);

    chat.unreadCounts.set(userId, 0);

    await chat.save();

    await ConversationRepository.updateMany(
        { chatId, seenBy: { $ne: userId } },
        { $push: { seenBy: userId } }
    );

    return new BaseResponse(true);
}

const getChats = async (req) => {
    const queryParams = req.query;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    const pipeline = await createPipeline(userId, queryParams);

    let chats = await ChatRepository.findByPipeline(pipeline, true);
    chats = await mapLastMessageWhenDeleted(chats, userId);
    const hasMore = chats.length === limitGetChats;
    const nextCursor = (hasMore && chats.length > 0) ? chats[chats.length - 1]._id : null;

    const response = new BasePaginatedResponse(
        chats,
        {
            nextCursor,
            pageSize: chats.length,
            hasMore
        });

    return new BaseResponse(true, [], response);
};

const mapLastMessageWhenDeleted = async (chats, userId) => {
    chats.forEach(chat => {
        const deletedAt = chat.deletedAt?.[userId];

        if (chat.lastMessage && deletedAt && chat.lastMessage.created_at <= deletedAt) {
            chat.lastMessage = {};
        }
    });
    return chats;
};

/**
 * POST /api/chats/:chatId/audio — stores a voice note blob and returns its URL.
 * The message itself is sent afterwards over the socket (sendMessage with type 'audio').
 */
const uploadChatAudio = async (req) => {
    const { chatId } = req.params;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        throw new BusinessException(c.CODE_AUDIO_REQUIRED);
    }

    await validateUserInChat(chatId, userId);
    const match = await MatchRepository.findOneByFilter({ _id: chatId });
    if (!match) throw new BusinessException(c.CODE_MATCH_NOT_FOUND);
    if (match.status !== MatchStatus.MATCHED) throw new BusinessException(c.CODE_CHAT_NOT_FOUND);

    const uploaded = await getChatAudioUploader().uploadOne(voiceNoteBlobPath(chatId), `${randomUUID()}.m4a`, req.file.buffer);

    return new BaseResponse(true, [], {
        url: uploaded.url,
        durationMs: clampDurationMs(req.body?.durationMs)
    });
};

const createPipelineConversations = async (chat, userId, cursor) => {
    const pipeline = [];
    const cursorObjectId = cursor ? new ObjectId(cursor) : null;
    const deletedAt = chat.deletedAt.get(userId);

    const matchStage = {
        chatId: new ObjectId(chat._id),
        $or: [
            { $expr: { $not: { $ifNull: [deletedAt, false] } } },
            { created_at: { $gt: deletedAt } }
        ]
    };

    if (cursorObjectId) {
        matchStage._id = { ...matchStage._id, $lt: cursorObjectId };
    }

    pipeline.push({ $match: matchStage });

    pipeline.push(
        { $sort: { created_at: -1 } },
        { $limit: limitGetConversations }
    );

    return pipeline;
};

const createPipeline = async (userId, queryParams) => {
    const pipeline = [];
    const cursorObjectId = queryParams.cursor ? new ObjectId(queryParams.cursor) : null;

    const matchStage = {
        users: new ObjectId(userId)
    };

    if (cursorObjectId) {
        matchStage._id = { ...matchStage._id, $gt: cursorObjectId };
    }

    pipeline.push({ $match: matchStage });

    pipeline.push({
        $lookup: {
            from: "matches",
            localField: "_id",
            foreignField: "_id",
            as: "match"
        }
    });

    pipeline.push({ $unwind: "$match" });

    pipeline.push({ $match: { "match.status": MatchStatus.MATCHED } });

    pipeline.push({
        $project: {
            '_id': 1,
            'lastMessage': 1,
            'unreadCounts': 1,
            'deletedAt': 1,
            // Kultura (additive): connection intent and whether "Next level" is unlocked.
            'intent': '$match.intent',
            'nextLevelUnlocked': { $ne: [{ $ifNull: ['$match.nextLevel.unlockedAt', null] }, null] },
            'users': {
                $filter: {
                    input: "$users",
                    as: "u",
                    cond: { $ne: ["$$u", new ObjectId(userId)] }
                }
            }
        }
    });

    pipeline.push({ $sort: { "lastMessage.created_at": -1, "created_at": -1 } });

    return pipeline;
};

const validateUserInChat = async (chatId, userId) => {
    const filter = {
        _id: chatId,
        users: userId
    };

    const chatExists = await ChatRepository.findOneByFilter(filter);
    if (!chatExists) throw new BusinessException(c.CODE_CHAT_NOT_FOUND);

    return chatExists;
}

module.exports = { getChats, messageSeen, getChatConversations, deleteChatConversation, uploadChatAudio, createPipeline };
