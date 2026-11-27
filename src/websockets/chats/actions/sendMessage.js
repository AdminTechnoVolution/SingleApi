const path = require('path');
const logger = require('../../../../shared/config/logger');
const filename = path.basename(__filename);
const util = require('../../../../shared/util/util');
const BaseResponse = require('../../../../shared/util/baseResponse');
const c = require('../../../../shared/util/constants.frontcodes');
const constants = require('../../../../shared/util/constants');
const { chatSendMessageSchema } = require('../../../validators/chat.validator');
const PushNotification = require('../../../../shared/util/pushNotification');
const MatchStatus = require('../../../enums/EnumMatchStatus');
const ChatRepository = require('../../../repository/chat.repository');
const ConversationRepository = require('../../../repository/conversation.repository');
const MatchRepository = require('../../../repository/match.repository');
const UserRepository = require('../../../repository/user.repository');
const Conversation = require('../../../models/conversation.model');
const { getChatAudioUploader } = require('../../../../shared/util/chatAudioStorage');
const { clampDurationMs, isOwnVoiceNoteUrl } = require('../../../../shared/util/voiceNote');

module.exports = (socket, namespace) => {
    socket.on('sendMessage', async (payload) => {
        try {
            const isValid = util.isValidSocketPayload(socket, constants.WS_EVENT_SEND_MESSAGE, chatSendMessageSchema, payload);
            if (!isValid) return;

            const userId = socket.userId;
            const chat = await validateSendMessage(payload, socket, constants.WS_EVENT_SEND_MESSAGE);
            const match = await validateMatch(payload, constants.WS_EVENT_SEND_MESSAGE);

            if (!chat || !match) return;

            if (match.status !== MatchStatus.MATCHED) return;

            const isAudio = payload.type === constants.CONVERSATION_TYPE_AUDIO;
            if (isAudio && !isOwnVoiceNoteUrl(payload.attachments[0], getChatAudioUploader().containerUrl, payload.chatId)) {
                const response = new BaseResponse(false, [c.CODE_AUDIO_URL_INVALID]);
                return socket.emit(constants.WS_EVENT_SEND_MESSAGE, JSON.stringify(response));
            }
            // Old clients / Android show `content` as text, so a voice note carries a fixed label.
            const content = isAudio ? constants.AUDIO_CONTENT : payload.content;
            const audioFields = isAudio ? {
                type: constants.CONVERSATION_TYPE_AUDIO,
                attachments: payload.attachments,
                durationMs: clampDurationMs(payload.durationMs)
            } : {};

            const conversation = new Conversation({
                chatId: payload.chatId,
                sender: userId,
                content,
                messageId: payload.messageId,
                seenBy: [userId],
                ...audioFields
            });

            const message = await ConversationRepository.save(conversation);

            chat.lastMessage = {
                content,
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

            const selectFields = 'userInfo.fullName photos';
            const user = await UserRepository.findById(userId, selectFields);
            user.photos = user.photos.filter(photo => photo.isProfile);

            for (const u of chat.users) {
                const userIdStr = u.toString();
                if (userIdStr !== userId) {
                    const data = new BaseResponse(true, [], {
                        conversationId: message._id,
                        chatId: payload.chatId,
                        content,
                        messageId: payload.messageId,
                        ...audioFields,
                        sender: userId,
                        fullName: user.userInfo.fullName,
                        photos: user.photos,
                        createdAt: message.created_at
                    });
                    PushNotification.proccessNotificationsByUser(userIdStr, constants.WS_EVENT_NEW_MESSAGE, data);
                }
            }

            const data = { conversationId: message._id };
            const ackResponse = new BaseResponse(true, [], data);
            socket.emit(constants.WS_EVENT_SEND_MESSAGE, JSON.stringify(ackResponse));
        } catch (err) {
            logger.error(`Error in ${constants.WS_EVENT_SEND_MESSAGE}. Error: ${err}`, { className: filename });
            const ackResponse = new BaseResponse(false);
            socket.emit(constants.WS_EVENT_UPDATE_MESSAGE, JSON.stringify(ackResponse));
        }
    });

    const validateSendMessage = async (body, socket, eventName) => {
        const filter = {
            _id: body.chatId,
            users: socket.userId
        };

        const chatExists = await ChatRepository.findOneByFilter(filter);
        if (!chatExists) {
            const response = new BaseResponse(false, [c.CODE_CHAT_NOT_FOUND]);
            socket.emit(eventName, JSON.stringify(response));
        }

        return chatExists;
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