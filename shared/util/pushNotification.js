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
        case constants.WS_EVENT_NEW_QUICK_MESSAGE:
            // Content stays out of the push: only subscribers may read it in-app.
            title = 'New quick message';
            body = "Someone sent you a quick message!";
            break;
        case constants.WS_EVENT_NEW_BLIND_DATE_GUEST:
            title = 'Blind date';
            body = 'Someone joined your blind date. Tap to start the call!';
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

/**
 * Data-only push to every device of a user (calls). Android handles it natively
 * (full-screen incoming call); the PWA service worker builds the notification.
 * ttlSecs: a ring that cannot be delivered in time is useless, so it expires.
 */
async function sendDataPushToUser(userIdTo, eventType, data = {}, { ttlSecs = 60 } = {}) {
    const resultFCMs = await FCMRepository.findOneByFilter({ userId: new ObjectId(userIdTo) });
    for (const token of resultFCMs?.fcmTokens || []) {
        try {
            const response = await firebase.messaging().send({
                token,
                android: { priority: "high", ttl: ttlSecs * 1000 },
                webpush: { headers: { Urgency: "high", TTL: String(ttlSecs) } },
                data: { type: eventType, payload: JSON.stringify({ data }) }
            });
            logger.info(`Data push ${eventType} sent. FCM Response: ${response}`, { className: filename });
        } catch (error) {
            logger.error(`Error sendDataPushToUser ${eventType}. FCM Error: ${error}`, { className: filename });
            if (["messaging/invalid-registration-token", "messaging/registration-token-not-registered"].includes(error.code)) {
                await FCMRepository.findOneByFilterAndPullToken({ userId: new ObjectId(userIdTo) }, { fcmTokens: token });
            }
        }
    }
}

module.exports = { sendPush, proccessNotificationsByUser, sendDataPushToUser };
