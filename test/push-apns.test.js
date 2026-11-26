const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
// Internal module (not in the package exports): firebase-admin's offline message validation.
const { validateMessage } = require(path.join(path.dirname(require.resolve('firebase-admin/messaging')), 'messaging-internal.js'));
const constants = require('../shared/util/constants');
const { buildApnsConfig, resolvePushLanguage } = require('../shared/util/apnsConfig');
const { buildPushMessage, buildDataPushMessage } = require('../shared/util/pushMessage');
const BaseResponse = require('../shared/util/baseResponse');

const TOKEN = 'fcm-token';
const CHAT = '68c400000000000000000001';
const FORBIDDEN = /match|date|dating|cita|single/i;

/** firebase-admin's own (offline) validation: a malformed apns block would fail every send. */
const assertValidForFcm = (message) => assert.doesNotThrow(() => validateMessage(structuredClone(message)));

const messagePayload = () => new BaseResponse(true, [], {
    conversationId: 'conv1', chatId: CHAT, content: 'Hola, ¿practicamos inglés hoy?', messageId: 'm1',
    sender: 'u1', fullName: 'Ana López', photos: [], createdAt: '2026-11-26T10:00:00Z'
});

test('notification push keeps the exact data/android/webpush payload and adds no top-level notification', () => {
    const payload = messagePayload();
    const msg = buildPushMessage(TOKEN, constants.WS_EVENT_NEW_MESSAGE, payload, 'Ana López', payload.data.content, 'es');
    assert.deepEqual(msg.data, {
        custom_body: payload.data.content,
        type: constants.WS_EVENT_NEW_MESSAGE,
        payload: JSON.stringify(payload)
    });
    assert.deepEqual(msg.android, { priority: 'high' });
    assert.equal(msg.webpush.notification.tag, CHAT);
    assert.equal('notification' in msg, false);
    assert.deepEqual(Object.keys(msg).sort(), ['android', 'apns', 'data', 'token', 'webpush']);
    assertValidForFcm(msg);
});

test('new message: visible alert with sender name, preview and chat thread', () => {
    const apns = buildApnsConfig(constants.WS_EVENT_NEW_MESSAGE, messagePayload().data, 'es');
    assert.equal(apns.headers['apns-priority'], '10');
    assert.equal(apns.headers['apns-push-type'], 'alert');
    assert.deepEqual(apns.payload.aps.alert, { title: 'Ana López', body: 'Hola, ¿practicamos inglés hoy?' });
    assert.equal(apns.payload.aps.sound, 'default');
    assert.equal(apns.payload.aps['mutable-content'], 1);
    assert.equal(apns.payload.aps['thread-id'], CHAT);
    assert.equal('content-available' in apns.payload.aps, false);
});

test('long message previews are truncated', () => {
    const apns = buildApnsConfig(constants.WS_EVENT_NEW_MESSAGE, { chatId: CHAT, fullName: 'Ana', content: 'a'.repeat(500) }, 'es');
    assert.ok(apns.payload.aps.alert.body.length <= 180);
    assert.ok(apns.payload.aps.alert.body.endsWith('…'));
});

test('every user-visible type gets an alert in es and en, with Kultura copy', () => {
    const cases = [
        [constants.WS_EVENT_NEW_LIKE, {}, 'Alguien te saludó 👋', 'Someone said hi 👋'],
        [constants.WS_EVENT_NEW_QUICK_MESSAGE, { fromUserId: 'u1', fullName: 'Ana' }, 'Nuevo mensaje rápido', 'New quick message'],
        [constants.WS_EVENT_NEW_MATCH, { chatId: CHAT, fullName: 'Ana López' }, '¡Nueva conexión!', 'New connection!'],
        [constants.WS_EVENT_NEXT_LEVEL_UNLOCKED, { chatId: CHAT }, '💫 Siguiente nivel desbloqueado', '💫 Next level unlocked'],
        [constants.WS_EVENT_NEW_BLIND_DATE_GUEST, { roomId: 'r1' }, 'Alguien se unió a tu sala', 'Someone joined your room']
    ];
    for (const [type, data, es, en] of cases) {
        for (const [lang, title] of [['es', es], ['en', en]]) {
            const apns = buildApnsConfig(type, data, lang);
            assert.equal(apns.headers['apns-push-type'], 'alert', type);
            assert.equal(apns.headers['apns-priority'], '10', type);
            assert.equal(apns.payload.aps.alert.title, title, `${type}/${lang}`);
            assert.ok(apns.payload.aps.alert.body, `${type}/${lang}`);
            assert.doesNotMatch(apns.payload.aps.alert.title, FORBIDDEN);
            assert.doesNotMatch(apns.payload.aps.alert.body, FORBIDDEN);
            assertValidForFcm(buildPushMessage(TOKEN, type, new BaseResponse(true, [], data), 't', 'b', lang));
        }
    }
});

test('quick message alert never leaks the content', () => {
    const apns = buildApnsConfig(constants.WS_EVENT_NEW_QUICK_MESSAGE, { fromUserId: 'u1', fullName: 'Ana', content: 'secret' }, 'es');
    assert.doesNotMatch(JSON.stringify(apns), /secret/);
});

test('connection and next level alerts are threaded by chat', () => {
    assert.equal(buildApnsConfig(constants.WS_EVENT_NEW_MATCH, { chatId: CHAT }, 'es').payload.aps['thread-id'], CHAT);
    assert.equal(buildApnsConfig(constants.WS_EVENT_NEXT_LEVEL_UNLOCKED, { chatId: CHAT }, 'es').payload.aps['thread-id'], CHAT);
});

test('incoming call: time-sensitive alert, priority 10, expires with the ring, data unchanged', () => {
    const incoming = { _id: 'call1', chatId: CHAT, kind: 'video', status: 'ringing', role: 'callee', peerId: 'u1', peerName: 'Ana', peerPhoto: null };
    const msg = buildDataPushMessage(TOKEN, constants.WS_EVENT_INCOMING_CALL, incoming, { ttlSecs: 30, lang: 'es' });
    assert.deepEqual(msg.data, { type: constants.WS_EVENT_INCOMING_CALL, payload: JSON.stringify({ data: incoming }) });
    assert.deepEqual(msg.android, { priority: 'high', ttl: 30000 });
    assert.deepEqual(msg.webpush, { headers: { Urgency: 'high', TTL: '30' } });
    assert.equal('notification' in msg, false);
    assert.equal(msg.apns.headers['apns-priority'], '10');
    assert.equal(msg.apns.headers['apns-push-type'], 'alert');
    assert.equal(msg.apns.headers['apns-collapse-id'], 'call:call1');
    assert.ok(Number(msg.apns.headers['apns-expiration']) > Date.now() / 1000);
    assert.equal(msg.apns.payload.aps['interruption-level'], 'time-sensitive');
    assert.deepEqual(msg.apns.payload.aps.alert, { title: 'Ana te está llamando', body: 'Videollamada entrante' });
    assertValidForFcm(msg);
    assert.equal(buildApnsConfig(constants.WS_EVENT_INCOMING_CALL, { ...incoming, kind: 'audio' }, 'en').payload.aps.alert.title, 'Ana is calling you');
});

test('call status: missed/cancelled replace the ring with a missed-call alert, others are silent', () => {
    for (const status of ['missed', 'cancelled']) {
        const apns = buildApnsConfig(constants.WS_EVENT_CALL_STATUS, { callId: 'call1', chatId: CHAT, status, peerName: 'Ana' }, 'es');
        assert.equal(apns.headers['apns-push-type'], 'alert');
        assert.equal(apns.headers['apns-collapse-id'], 'call:call1');
        assert.deepEqual(apns.payload.aps.alert, { title: 'Llamada perdida', body: 'Ana te llamó' });
        assert.equal('interruption-level' in apns.payload.aps, false);
    }
    for (const status of ['accepted', 'declined']) {
        const msg = buildDataPushMessage(TOKEN, constants.WS_EVENT_CALL_STATUS, { callId: 'call1', chatId: CHAT, status }, { ttlSecs: 60, lang: 'es' });
        assert.equal(msg.apns.headers['apns-priority'], '5');
        assert.equal(msg.apns.headers['apns-push-type'], 'background');
        assert.deepEqual(msg.apns.payload, { aps: { 'content-available': 1 } });
        assertValidForFcm(msg);
    }
});

test('unknown (sync-only) types get a silent background config', () => {
    const msg = buildPushMessage(TOKEN, 'someSyncEvent', new BaseResponse(true), '', '', 'es');
    assert.deepEqual(msg.apns, {
        headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
        payload: { aps: { 'content-available': 1 } }
    });
    assert.equal('notification' in msg, false);
    assertValidForFcm(msg);
});

test('push language comes from profileConfig.preferredLanguage, default es', () => {
    assert.equal(resolvePushLanguage(null), 'es');
    assert.equal(resolvePushLanguage({}), 'es');
    assert.equal(resolvePushLanguage({ profileConfig: { preferredLanguage: '1' } }), 'en');
    assert.equal(resolvePushLanguage({ profileConfig: { preferredLanguage: '3' } }), 'es');
    assert.equal(resolvePushLanguage({ profileConfig: { preferredLanguage: { _id: '1' } } }), 'en');
    assert.equal(resolvePushLanguage({ profileConfig: { preferredLanguage: 'en-US' } }), 'en');
    assert.equal(resolvePushLanguage({ profileConfig: { preferredLanguage: '42' } }), 'es');
    assert.equal(buildApnsConfig(constants.WS_EVENT_NEW_LIKE, {}, 'fr').payload.aps.alert.title, 'Alguien te saludó 👋');
});
