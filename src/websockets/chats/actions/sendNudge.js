const path = require('path');
const logger = require('../../../../shared/config/logger');
const filename = path.basename(__filename);
const util = require('../../../../shared/util/util');
const BaseResponse = require('../../../../shared/util/baseResponse');
const c = require('../../../../shared/util/constants.frontcodes');
const constants = require('../../../../shared/util/constants');
const { chatSendNudgeSchema } = require('../../../validators/chat.validator');
const PushNotification = require('../../../../shared/util/pushNotification');
const MatchStatus = require('../../../enums/EnumMatchStatus');
const ChatRepository = require('../../../repository/chat.repository');
const ConversationRepository = require('../../../repository/conversation.repository');
const MatchRepository = require('../../../repository/match.repository');
const UserRepository = require('../../../repository/user.repository');
const Conversation = require('../../../models/conversation.model');
const { nudgeCooldownRemaining } = require('../../../../shared/util/nudge');

/**
 * MSN-style "zumbido". Stored as a Conversation (type 'nudge') so it stays in the history,
 * and delivered to the other user by FCM push only (event newNudge), like newMessage.
 * Clients that don't know the type show NUDGE_CONTENT as a normal message.
 */
const sendNudge = (socket, namespace) => {
    const EVENT = constants.WS_EVENT_SEND_NUDGE;
    const fail = (codes = []) => socket.emit(EVENT, JSON.stringify(new BaseResponse(false, codes)));

    socket.on(EVENT, async (payload) => {
        try {
            const isValid = util.isValidSocketPayload(socket, EVENT, chatSendNudgeSchema, payload);
            if (!isValid) return;

            const userId = socket.userId;
            const chat = await ChatRepository.findOneByFilter({ _id: payload.chatId, users: userId });
            if (!chat) return fail([c.CODE_CHAT_NOT_FOUND]);

            const match = await MatchRepository.findOneByFilter({ _id: payload.chatId });
            if (!match) return fail([c.CODE_MATCH_NOT_FOUND]);
            if (match.status !== MatchStatus.MATCHED) return fail();

            const lastNudge = await ConversationRepository.findLatestByFilter({
                chatId: payload.chatId,
                sender: userId,
                type: constants.CONVERSATION_TYPE_NUDGE
            });
            const remainingMs = nudgeCooldownRemaining(lastNudge?.created_at);
            if (remainingMs > 0) {
                const response = new BaseResponse(false, [c.CODE_NUDGE_COOLDOWN], { retryAfterMs: remainingMs });
                return socket.emit(EVENT, JSON.stringify(response));
            }

            const message = await ConversationRepository.save(new Conversation({
                chatId: payload.chatId,
                sender: userId,
                content: constants.NUDGE_CONTENT,
                type: constants.CONVERSATION_TYPE_NUDGE,
                seenBy: [userId]
            }));

            chat.lastMessage = {
                content: constants.NUDGE_CONTENT,
                sender: userId,
                created_at: message.created_at
            };
            for (const uid of chat.users) {
                const userIdStr = uid.toString();
                if (userIdStr !== userId) {
                    chat.unreadCounts.set(userIdStr, (chat.unreadCounts.get(userIdStr) || 0) + 1);
                }
            }
            await chat.save();

            const user = await UserRepository.findById(userId, 'userInfo.fullName photos');
            const photos = (user?.photos || []).filter(photo => photo.isProfile);

            for (const u of chat.users) {
                const userIdStr = u.toString();
                if (userIdStr !== userId) {
                    const data = new BaseResponse(true, [], {
                        conversationId: message._id,
                        chatId: payload.chatId,
                        content: constants.NUDGE_CONTENT,
                        type: constants.CONVERSATION_TYPE_NUDGE,
                        sender: userId,
                        fullName: user?.userInfo?.fullName,
                        photos,
                        createdAt: message.created_at
                    });
                    PushNotification.proccessNotificationsByUser(userIdStr, constants.WS_EVENT_NEW_NUDGE, data);
                }
            }

            const ack = new BaseResponse(true, [], {
                conversationId: message._id,
                chatId: payload.chatId,
                createdAt: message.created_at,
                cooldownMs: constants.NUDGE_COOLDOWN_MS
            });
            socket.emit(EVENT, JSON.stringify(ack));
        } catch (err) {
            logger.error(`Error in ${EVENT}. Error: ${err}`, { className: filename });
            fail();
        }
    });
};

module.exports = sendNudge;
