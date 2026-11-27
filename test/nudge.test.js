const test = require('node:test');
const assert = require('node:assert/strict');
const constants = require('../shared/util/constants');
const { buildApnsConfig } = require('../shared/util/apnsConfig');
const { buildPushMessage } = require('../shared/util/pushMessage');
const BaseResponse = require('../shared/util/baseResponse');
const { chatSendNudgeSchema } = require('../src/validators/chat.validator');
const Conversation = require('../src/models/conversation.model');
const { nudgeCooldownRemaining } = require('../shared/util/nudge');

const CHAT = '68c400000000000000000001';
const nudgeData = () => ({
    conversationId: 'conv1', chatId: CHAT, content: constants.NUDGE_CONTENT, type: constants.CONVERSATION_TYPE_NUDGE,
    sender: 'u1', fullName: 'Ana López', photos: [], createdAt: '2026-11-26T10:00:00Z'
});

test('nudge cooldown: 30 s per sender per chat', () => {
    const now = Date.parse('2026-11-26T10:00:30Z');
    assert.equal(constants.NUDGE_COOLDOWN_MS, 30000);
    assert.equal(nudgeCooldownRemaining(null, now), 0);
    assert.equal(nudgeCooldownRemaining(undefined, now), 0);
    assert.equal(nudgeCooldownRemaining('2026-11-26T10:00:00Z', now), 0);
    assert.equal(nudgeCooldownRemaining('2026-11-26T10:00:10Z', now), 10000);
    assert.equal(nudgeCooldownRemaining(new Date('2026-11-26T10:00:29Z'), now), 29000);
    assert.equal(nudgeCooldownRemaining('not a date', now), 0);
});

test('sendNudge payload only needs chatId', () => {
    assert.equal(chatSendNudgeSchema.validate({ chatId: CHAT }).error, undefined);
    assert.ok(chatSendNudgeSchema.validate({}).error);
    assert.ok(chatSendNudgeSchema.validate({ chatId: CHAT, content: 'x' }).error);
});

test('conversation type defaults to text and accepts nudge only', () => {
    assert.equal(new Conversation({ chatId: CHAT, content: 'hola' }).type, 'text');
    assert.equal(new Conversation({ chatId: CHAT, type: 'nudge' }).validateSync(), undefined);
    assert.ok(new Conversation({ chatId: CHAT, type: 'other' }).validateSync());
});

test('nudge push: visible, time-sensitive alert with custom sound, chat thread and Kultura copy', () => {
    const es = buildApnsConfig(constants.WS_EVENT_NEW_NUDGE, nudgeData(), 'es');
    assert.equal(es.headers['apns-push-type'], 'alert');
    assert.equal(es.headers['apns-priority'], '10');
    assert.deepEqual(es.payload.aps.alert, { title: 'Ana López', body: 'Ana te envió un zumbido ⚡️' });
    assert.equal(es.payload.aps.sound, 'nudge.caf');
    assert.equal(es.payload.aps['interruption-level'], 'time-sensitive');
    assert.equal(es.payload.aps['thread-id'], CHAT);

    const en = buildApnsConfig(constants.WS_EVENT_NEW_NUDGE, { chatId: CHAT }, 'en');
    assert.deepEqual(en.payload.aps.alert, { title: 'Nudge ⚡️', body: 'You got a nudge ⚡️' });
});

test('nudge push keeps the data-only shape for Android and carries the type', () => {
    const payload = new BaseResponse(true, [], nudgeData());
    const msg = buildPushMessage('tok', constants.WS_EVENT_NEW_NUDGE, payload, 'Ana López', 'sent you a nudge ⚡️', 'es');
    assert.equal(msg.data.type, 'newNudge');
    assert.equal(JSON.parse(msg.data.payload).data.type, 'nudge');
    assert.equal('notification' in msg, false);
});

test('other pushes keep the default sound', () => {
    const apns = buildApnsConfig(constants.WS_EVENT_NEW_MESSAGE, { chatId: CHAT, content: 'hola', fullName: 'Ana' }, 'es');
    assert.equal(apns.payload.aps.sound, 'default');
});
