/**
 * APNs block for outgoing FCM messages (iOS app "Kultura").
 *
 * The backend sends data-only FCM messages so Android builds its own notifications.
 * On iOS a data-only message is a silent background push and is usually not shown,
 * so every message also carries an `apns` block with a visible alert. FCM ignores
 * the `apns` block for Android tokens, so it is safe for mixed token lists, and we
 * never add a top-level `notification` block (that would change Android behavior).
 *
 * Pure module (no firebase / DB access) so it can be unit tested.
 * iOS copy follows the Kultura concept: never "match", "date", "dating", "cita" or "single".
 */
const constants = require('./constants');

const DEFAULT_LANG = 'es';
const SUPPORTED_LANGS = ['es', 'en'];
// profileConfig.preferredLanguage references the master 'languages' collection (scripts/data.languages.json).
const LANGUAGE_ID_TO_ISO = { '1': 'en', '3': 'es' };
const MAX_BODY_CHARS = 180;
// Bundled in the iOS app (Kultura/Resources/nudge.caf); APNs falls back to the default sound if missing.
const NUDGE_SOUND = 'nudge.caf';

const COPY = {
    es: {
        newMessageTitle: 'Nuevo mensaje',
        newMessageBody: 'Tienes un nuevo mensaje',
        newNudgeTitle: 'Zumbido ⚡️',
        newNudgeBody: (name) => name ? `${name} te envió un zumbido ⚡️` : 'Te enviaron un zumbido ⚡️',
        newLikeTitle: 'Alguien te saludó 👋',
        newLikeBody: 'Abre Kultura para devolver el saludo',
        newQuickMessageTitle: 'Nuevo mensaje rápido',
        newQuickMessageBody: 'Alguien te envió un mensaje rápido',
        newMatchTitle: '¡Nueva conexión!',
        newMatchBody: (name) => name ? `Tú y ${name} ya están conectados. ¡Saluda!` : 'Tienes una nueva conexión. ¡Saluda!',
        nextLevelTitle: '💫 Siguiente nivel desbloqueado',
        nextLevelBody: 'Algo nuevo te espera en una de tus conexiones',
        roomGuestTitle: 'Alguien se unió a tu sala',
        roomGuestBody: 'Toca para empezar la llamada',
        incomingCallTitle: (name) => name ? `${name} te está llamando` : 'Llamada entrante',
        incomingCallBody: (kind) => kind === 'video' ? 'Videollamada entrante' : 'Llamada de voz entrante',
        missedCallTitle: 'Llamada perdida',
        missedCallBody: (name) => name ? `${name} te llamó` : 'Tienes una llamada perdida'
    },
    en: {
        newMessageTitle: 'New message',
        newMessageBody: 'You have a new message',
        newNudgeTitle: 'Nudge ⚡️',
        newNudgeBody: (name) => name ? `${name} sent you a nudge ⚡️` : 'You got a nudge ⚡️',
        newLikeTitle: 'Someone said hi 👋',
        newLikeBody: 'Open Kultura to say hi back',
        newQuickMessageTitle: 'New quick message',
        newQuickMessageBody: 'Someone sent you a quick message',
        newMatchTitle: 'New connection!',
        newMatchBody: (name) => name ? `You and ${name} are now connected. Say hi!` : 'You have a new connection. Say hi!',
        nextLevelTitle: '💫 Next level unlocked',
        nextLevelBody: 'Something new is waiting in one of your connections',
        roomGuestTitle: 'Someone joined your room',
        roomGuestBody: 'Tap to start the call',
        incomingCallTitle: (name) => name ? `${name} is calling you` : 'Incoming call',
        incomingCallBody: (kind) => kind === 'video' ? 'Incoming video call' : 'Incoming voice call',
        missedCallTitle: 'Missed call',
        missedCallBody: (name) => name ? `${name} called you` : 'You have a missed call'
    }
};

/** Push language for a user: profileConfig.preferredLanguage ("1" English, "3" Spanish; populated or not), default es. */
function resolvePushLanguage(user) {
    const pref = user?.profileConfig?.preferredLanguage;
    const id = typeof pref === 'object' && pref !== null ? pref._id : pref;
    if (id === undefined || id === null) return DEFAULT_LANG;
    const raw = String(id).trim().toLowerCase();
    if (LANGUAGE_ID_TO_ISO[raw]) return LANGUAGE_ID_TO_ISO[raw];
    const iso = raw.slice(0, 2);
    return SUPPORTED_LANGS.includes(iso) ? iso : DEFAULT_LANG;
}

const firstName = (fullName) => String(fullName || '').trim().split(/\s+/)[0] || null;

const truncate = (text, max = MAX_BODY_CHARS) => {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const str = (value) => (value === undefined || value === null || value === '') ? undefined : String(value);

/** Title/body/thread for a user-visible push type, or null for silent (sync-only) pushes. */
function alertFor(type, data, lang) {
    const t = COPY[SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG];
    switch (type) {
        case constants.WS_EVENT_NEW_MESSAGE:
            return {
                title: str(data.fullName) || t.newMessageTitle,
                body: truncate(data.content) || t.newMessageBody,
                threadId: str(data.chatId)
            };
        case constants.WS_EVENT_NEW_NUDGE:
            return {
                title: str(data.fullName) || t.newNudgeTitle,
                body: t.newNudgeBody(firstName(data.fullName)),
                threadId: str(data.chatId),
                sound: NUDGE_SOUND,
                timeSensitive: true
            };
        case constants.WS_EVENT_NEW_LIKE:
            return { title: t.newLikeTitle, body: t.newLikeBody, threadId: 'greetings' };
        case constants.WS_EVENT_NEW_QUICK_MESSAGE:
            // Content stays out of the push: only subscribers may read it in-app.
            return { title: t.newQuickMessageTitle, body: t.newQuickMessageBody, threadId: 'greetings' };
        case constants.WS_EVENT_NEW_MATCH:
            return { title: t.newMatchTitle, body: t.newMatchBody(firstName(data.fullName)), threadId: str(data.chatId) };
        case constants.WS_EVENT_NEXT_LEVEL_UNLOCKED:
            return { title: t.nextLevelTitle, body: t.nextLevelBody, threadId: str(data.chatId) };
        case constants.WS_EVENT_NEW_BLIND_DATE_GUEST:
            return { title: t.roomGuestTitle, body: t.roomGuestBody, threadId: str(data.roomId) && `room:${data.roomId}` };
        case constants.WS_EVENT_INCOMING_CALL:
            return {
                title: t.incomingCallTitle(str(data.peerName)),
                body: t.incomingCallBody(data.kind),
                threadId: str(data.chatId),
                collapseId: str(data._id) && `call:${data._id}`,
                timeSensitive: true
            };
        case constants.WS_EVENT_CALL_STATUS:
            // Only an unanswered ring is worth showing; it replaces the "incoming call" alert (same collapse id).
            if (!['missed', 'cancelled'].includes(data.status)) return null;
            return {
                title: t.missedCallTitle,
                body: t.missedCallBody(str(data.peerName)),
                threadId: str(data.chatId),
                collapseId: str(data.callId) && `call:${data.callId}`
            };
        default:
            return null;
    }
}

/**
 * FCM `apns` config for a push.
 * @param {string} type    push type (same value as data.type)
 * @param {object} data    the inner payload data (BaseResponse.data, or the raw call payload)
 * @param {string} recipientLang 'es' | 'en'
 * @param {{ttlSecs?: number, now?: number}} [options] ttlSecs sets apns-expiration (calls)
 */
function buildApnsConfig(type, data = {}, recipientLang = DEFAULT_LANG, { ttlSecs, now = Date.now() } = {}) {
    const alert = alertFor(type, data || {}, recipientLang);
    const expiration = ttlSecs ? { 'apns-expiration': String(Math.floor(now / 1000) + ttlSecs) } : {};

    if (!alert) {
        return {
            headers: { 'apns-priority': '5', 'apns-push-type': 'background', ...expiration },
            payload: { aps: { 'content-available': 1 } }
        };
    }

    const aps = {
        alert: { title: alert.title, body: alert.body },
        sound: alert.sound || 'default',
        'mutable-content': 1
    };
    if (alert.threadId) aps['thread-id'] = alert.threadId;
    if (alert.timeSensitive) aps['interruption-level'] = 'time-sensitive';

    const headers = { 'apns-priority': '10', 'apns-push-type': 'alert', ...expiration };
    if (alert.collapseId) headers['apns-collapse-id'] = alert.collapseId;

    return { headers, payload: { aps } };
}

module.exports = { buildApnsConfig, resolvePushLanguage, DEFAULT_LANG };
