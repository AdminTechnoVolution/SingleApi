const path = require('path');
const logger = require('../config/logger');
const filename = path.basename(__filename);
const constants = require('./constants');
const ObjectId = require("mongoose").Types.ObjectId;
const firebase = require("../config/firebase");
const FCMRepository = require("../../src/repository/fcmToken.repository");
const UserRepository = require("../../src/repository/user.repository");
const { buildPushMessage, buildDataPushMessage } = require("./pushMessage");
const { resolvePushLanguage, DEFAULT_LANG } = require("./apnsConfig");

/** Recipient language for the iOS alert text (never blocks a push). */
async function getPushLanguage(userId) {
    try {
        return resolvePushLanguage(await UserRepository.findById(userId, 'profileConfig.preferredLanguage'));
    } catch (error) {
        logger.error(`Error resolving push language for ${userId}: ${error}`, { className: filename });
        return DEFAULT_LANG;
    }
}

async function proccessNotificationsByUser(userIdTo, event, data) {
    const resultFCMs = await FCMRepository.findOneByFilter({ userId: new ObjectId(userIdTo) })
    try {
        const { title, body } = await getDataForNotification(event, data);
        const lang = resultFCMs?.fcmTokens?.length ? await getPushLanguage(userIdTo) : DEFAULT_LANG;

        for (const fcm of resultFCMs.fcmTokens) {
            const pushResult = await sendPush(
                fcm,
                event,
                data,
                title,
                body,
                '',
                lang
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
        case constants.WS_EVENT_NEW_NUDGE:
            title = data.data.fullName;
            body = 'sent you a nudge ⚡️';
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
        case constants.WS_EVENT_NEXT_LEVEL_UNLOCKED:
            // Neutral copy: the lock screen must not reveal the romantic context.
            title = 'Kultura';
            body = 'Something new is waiting in one of your connections 💫';
            break;
    }

    return { title, body };
}

async function sendPush(token, eventType, payload = {}, title = '', body = '', image = '', lang = DEFAULT_LANG) {
    try {
        const message = buildPushMessage(token, eventType, payload, title, body, lang);

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
 * (full-screen incoming call); the PWA service worker builds the notification;
 * iOS shows the APNs alert (time-sensitive for incomingCall).
 * ttlSecs: a ring that cannot be delivered in time is useless, so it expires.
 */
async function sendDataPushToUser(userIdTo, eventType, data = {}, { ttlSecs = 60 } = {}) {
    const resultFCMs = await FCMRepository.findOneByFilter({ userId: new ObjectId(userIdTo) });
    const lang = resultFCMs?.fcmTokens?.length ? await getPushLanguage(userIdTo) : DEFAULT_LANG;
    for (const token of resultFCMs?.fcmTokens || []) {
        try {
            const response = await firebase.messaging().send(buildDataPushMessage(token, eventType, data, { ttlSecs, lang }));
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
