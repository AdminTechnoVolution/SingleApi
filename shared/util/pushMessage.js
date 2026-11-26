/**
 * Pure builders for the FCM messages sent by pushNotification.js (no firebase / DB access).
 * `data`, `android` and `webpush` are exactly what the clients received before the iOS work;
 * only the `apns` block is new. No top-level `notification` block on purpose: Android keeps
 * receiving data-only messages for its native handler.
 */
const { buildApnsConfig } = require('./apnsConfig');

/** Notification push (messages, greetings, connections, next level, rooms). */
function buildPushMessage(token, eventType, payload = {}, title = '', body = '', lang) {
    return {
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
        // iOS: visible alert (FCM ignores this block for Android tokens).
        apns: buildApnsConfig(eventType, payload?.data || {}, lang),
        data: {
            custom_body: body,
            type: eventType,
            payload: JSON.stringify(payload)
        }
    };
}

/** Call push (incomingCall / callStatus): short-lived, ttlSecs also bounds the APNs delivery. */
function buildDataPushMessage(token, eventType, data = {}, { ttlSecs = 60, lang } = {}) {
    return {
        token,
        android: { priority: "high", ttl: ttlSecs * 1000 },
        webpush: { headers: { Urgency: "high", TTL: String(ttlSecs) } },
        apns: buildApnsConfig(eventType, data || {}, lang, { ttlSecs }),
        data: { type: eventType, payload: JSON.stringify({ data }) }
    };
}

module.exports = { buildPushMessage, buildDataPushMessage };
