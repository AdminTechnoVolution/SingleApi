const path = require('path');
const logger = require('../config/logger');
const filename = path.basename(__filename);
const constants = require('./constants');
const ObjectId = require("mongoose").Types.ObjectId;
const firebase = require("../config/firebase");
const FCMRepository = require("../../src/repository/fcmToken.repository");

async function proccessNotificationsByUser(userIdTo, event, data) {
    const resultFCMs = await FCMRepository.findOneByFilter({ userId: new ObjectId(userIdTo) })
    try {
        const { title, body } = await getDataForNotification(event, data);

        for (const fcm of resultFCMs.fcmTokens) {
            const pushResult = await sendPush(
                fcm,
                event,
                data,
                title,
                body
            );
            if (!pushResult.success && pushResult.removeToken) {
                await FCMRepository.findOneByFilterAndPullToken(
                    { userId: new ObjectId(userIdTo) },
                    { fcmTokens: fcm }
                );
            }
        }
    } catch (error) {
        logger.error(`Error processing notifications to ${userIdTo}, data: ${JSON.stringify(data)}: ${error}`, { className: filename });
    }
}

async function getDataForNotification(event, data) {
    let title;
    let body;
    switch (event) {
        case constants.WS_EVENT_NEW_MESSAGE:
            title = data.data.fullName;
            body = data.data.content;
            break;
        case constants.WS_EVENT_NEW_LIKE:
            title = 'New like';
            body = "You've got a new like!";
            break;
        case constants.WS_EVENT_NEW_MATCH:
            title = 'New Match';
            body = 'Open Chat';
            break;
    }

    return { title, body };
}

async function sendPush(token, eventType, payload = {}, title = '', body = '', image = '') {
    try {
        const message = {
            token,
            // Keep the visible notification payload web-specific so Android
            // continues receiving data-only messages for its native handler.
            webpush: {
                headers: {
                    Urgency: "high"
                },
                notification: {
                    title,
                    body,
                    icon: "/icon-192.png",
                    badge: "/icon-192.png",
                    tag: payload?.data?.chatId || payload?.data?.matchId || eventType || "single"
                }
            },
            android: {
                priority: "high"
            },
            data: {
                custom_body: body,
                type: eventType,
                payload: JSON.stringify(payload)
            }
        };

        const response = await firebase.messaging().send(message);

        logger.info(`Notification sent. FCM Response: ${response}`, { className: filename });
        return { success: true, response };
    } catch (error) {
        logger.error(`Error sendPush. FCM Error: ${error}`, { className: filename });

        if (
            error.code === "messaging/invalid-registration-token" ||
            error.code === "messaging/registration-token-not-registered" ||
            error.code === "messaging/invalid-argument"
        ) {
            return { success: false, removeToken: true };
        }

        return { success: false, error };
    }
}

module.exports = { sendPush, proccessNotificationsByUser };
