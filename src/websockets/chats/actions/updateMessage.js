const path = require('path');
const logger = require('../../../../shared/config/logger');
const filename = path.basename(__filename);
const redis = require('../../../../shared/config/redis');
const util = require('../../../../shared/util/util');
const BaseResponse = require('../../../../shared/util/baseResponse');
const c = require('../../../../shared/util/constants.frontcodes');
const constants = require('../../../../shared/util/constants');
const consCache = require('../../../../shared/util/constants.cache');
const { chatUpdateMessageSchema } = require('../../../validators/chat.validator');
const MatchStatus = require('../../../enums/EnumMatchStatus');
const ConversationRepository = require('../../../repository/conversation.repository');
const ChatRepository = require('../../../repository/chat.repository');
const MatchRepository = require('../../../repository/match.repository');
const UserRepository = require('../../../repository/user.repository');

module.exports = (socket, namespace) => {
    socket.on('updateMessage', async (payload) => {
        try {
            const isValid = util.isValidSocketPayload(socket, constants.WS_EVENT_UPDATE_MESSAGE, chatUpdateMessageSchema, payload);
            if (!isValid) return;

            const userId = socket.userId;
            const conversation = await validateEditChatConversation(payload, userId, constants.WS_EVENT_UPDATE_MESSAGE);
            const match = await validateMatch(payload, constants.WS_EVENT_UPDATE_MESSAGE);

            if (!conversation || !match) return;

            if (match.status !== MatchStatus.MATCHED) return;

            if (conversation.type === constants.CONVERSATION_TYPE_NUDGE) {
                socket.emit(constants.WS_EVENT_UPDATE_MESSAGE, JSON.stringify(new BaseResponse(false, [c.CODE_NUDGE_NOT_EDITABLE])));
                return;
            }

            conversation.content = payload.content;
            conversation.updated = true;

            await conversation.save();

            const chat = await ChatRepository.findOneByFilter({ _id: payload.chatId });

            const timeChatLastMessage = new Date(chat.lastMessage?.created_at).getTime();
            const timeConversation = new Date(conversation.created_at).getTime();
            if (timeChatLastMessage === timeConversation) {
                chat.lastMessage.content = payload.content;
                await chat.save();
            }

            for (const u of chat.users) {
                const userIdStr = u.toString();
                if (userIdStr !== userId) {
                    const targetSockets = await redis.sMembers(`${consCache.REDIS_KEY_USER_SOCKETS}${userIdStr}`);
                    if (targetSockets && targetSockets.length > 0) {
                        for (const sid of targetSockets) {
                            const response = new BaseResponse(true, [], {
                                conversationId: conversation._id,
                                content: conversation.content,
                                updated: true
                            });
                            namespace.to(sid).emit(constants.WS_EVENT_NEW_UPDATE_MESSAGE, JSON.stringify(response));
                        }
                    }
                }
            }

            const ackResponse = new BaseResponse(true);
            socket.emit(constants.WS_EVENT_UPDATE_MESSAGE, JSON.stringify(ackResponse));
        } catch (err) {
            logger.error(`Error in ${constants.WS_EVENT_UPDATE_MESSAGE}. Error: ${err}`, { className: filename });
            const ackResponse = new BaseResponse(false);
            socket.emit(constants.WS_EVENT_UPDATE_MESSAGE, JSON.stringify(ackResponse));
        }
    });

    const validateEditChatConversation = async (body, userId, eventName) => {
        const filter = {
            _id: body.conversationId,
            chatId: body.chatId,
            sender: userId
        };

        const conversationExists = await ConversationRepository.findOneByFilter(filter);
        if (!conversationExists) {
            const response = new BaseResponse(false, [c.CODE_CONVERSATION_NOT_FOUND]);
            socket.emit(eventName, JSON.stringify(response));
        }

        return conversationExists;
    }

    const validateMatch = async (body, eventName) => {
        const filter = {
            _id: body.chatId
        };

        const matchExists = await MatchRepository.findOneByFilter(filter);
        if (!matchExists) {
            const response = new BaseResponse(false, [c.CODE_MATCH_NOT_FOUND]);
            socket.emit(eventName, JSON.stringify(response));
        }

        return matchExists;
    }
};