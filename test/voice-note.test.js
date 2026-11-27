const test = require('node:test');
const assert = require('node:assert/strict');
const constants = require('../shared/util/constants');
const { chatSendMessageSchema } = require('../src/validators/chat.validator');
const Conversation = require('../src/models/conversation.model');
const AzureUploader = require('../shared/util/AzureUploader');
const uploadAudio = require('../shared/config/multerAudioConfig');
const { clampDurationMs, voiceNoteBlobPath, isOwnVoiceNoteUrl } = require('../shared/util/voiceNote');

const CHAT = '68c400000000000000000001';
const OTHER_CHAT = '68c400000000000000000002';
const CONTAINER = 'https://acct.blob.core.windows.net/single/';
const url = (chatId = CHAT, name = '0b5d7c1e-1111-4a2b-9c3d-123456789abc.m4a') => CONTAINER + voiceNoteBlobPath(chatId) + name;

test('sendMessage: text payload is unchanged', () => {
    assert.equal(chatSendMessageSchema.validate({ chatId: CHAT, content: 'hola' }).error, undefined);
    assert.equal(chatSendMessageSchema.validate({ chatId: CHAT, content: 'hola', type: 'text' }).error, undefined);
    assert.ok(chatSendMessageSchema.validate({ chatId: CHAT, content: 'hola', attachments: [url()] }).error, 'attachments only with audio');
    assert.ok(chatSendMessageSchema.validate({ chatId: CHAT, content: 'hola', durationMs: 10 }).error, 'durationMs only with audio');
});

test('sendMessage: audio needs exactly one attachment URL', () => {
    const ok = { chatId: CHAT, content: constants.AUDIO_CONTENT, type: 'audio', attachments: [url()], durationMs: 4200 };
    assert.equal(chatSendMessageSchema.validate(ok).error, undefined);
    assert.ok(chatSendMessageSchema.validate({ ...ok, attachments: undefined }).error);
    assert.ok(chatSendMessageSchema.validate({ ...ok, attachments: [] }).error);
    assert.ok(chatSendMessageSchema.validate({ ...ok, attachments: [url(), url()] }).error);
    assert.ok(chatSendMessageSchema.validate({ ...ok, attachments: ['not a url'] }).error);
    assert.ok(chatSendMessageSchema.validate({ ...ok, type: 'nudge' }).error, 'nudges go through sendNudge');
});

test('voice note URL must be our blob for the same chat', () => {
    assert.equal(isOwnVoiceNoteUrl(url(), CONTAINER, CHAT), true);
    assert.equal(isOwnVoiceNoteUrl(url(OTHER_CHAT), CONTAINER, CHAT), false);
    assert.equal(isOwnVoiceNoteUrl('https://evil.example.com/a.m4a', CONTAINER, CHAT), false);
    assert.equal(isOwnVoiceNoteUrl(url(CHAT, '../x.m4a'), CONTAINER, CHAT), false);
    assert.equal(isOwnVoiceNoteUrl(url(CHAT, 'a.mp3'), CONTAINER, CHAT), false);
    assert.equal(isOwnVoiceNoteUrl(undefined, CONTAINER, CHAT), false);
    assert.equal(isOwnVoiceNoteUrl(url(), '', CHAT), false);
});

test('durationMs is clamped to 0..60 s', () => {
    assert.equal(clampDurationMs(4200), 4200);
    assert.equal(clampDurationMs('4200'), 4200);
    assert.equal(clampDurationMs(999999), constants.AUDIO_MAX_DURATION_MS);
    assert.equal(clampDurationMs(-5), 0);
    assert.equal(clampDurationMs('abc'), 0);
    assert.equal(clampDurationMs(undefined), 0);
});

test('conversation accepts audio with durationMs', () => {
    const doc = new Conversation({ chatId: CHAT, content: constants.AUDIO_CONTENT, type: 'audio', attachments: [url()], durationMs: 4200 });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.durationMs, 4200);
});

test('m4a blobs are stored as audio/mp4', () => {
    assert.equal(AzureUploader.prototype.getMimeType('chats/x/audio/a.m4a'), 'audio/mp4');
    assert.equal(AzureUploader.prototype.getMimeType('a.png'), 'image/png');
});

test('audio upload accepts only audio mimes, max 2 MB', async () => {
    assert.ok(uploadAudio.allowedMimes.includes('audio/mp4'));
    assert.equal(constants.AUDIO_MAX_BYTES, 2 * 1024 * 1024);

    const express = require('express');
    const multer = require('multer');
    const app = express();
    app.post('/a', uploadAudio.single('audio'), (req, res) => res.json({ size: req.file.size }));
    app.use((err, req, res, next) => res.status(400).json({ code: err instanceof multer.MulterError ? err.code : err.message }));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/a`;
    const post = (blob, name) => { const f = new FormData(); f.append('audio', blob, name); return fetch(base, { method: 'POST', body: f }).then(async r => ({ status: r.status, body: await r.json() })); };
    try {
        const ok = await post(new Blob([Buffer.alloc(1000)], { type: 'audio/mp4' }), 'a.m4a');
        assert.deepEqual(ok, { status: 200, body: { size: 1000 } });
        const wrong = await post(new Blob([Buffer.alloc(10)], { type: 'image/png' }), 'a.png');
        assert.deepEqual(wrong, { status: 400, body: { code: 'audio.onlyAudio' } });
        const big = await post(new Blob([Buffer.alloc(constants.AUDIO_MAX_BYTES + 1)], { type: 'audio/mp4' }), 'a.m4a');
        assert.deepEqual(big, { status: 400, body: { code: 'LIMIT_FILE_SIZE' } });
    } finally {
        server.close();
    }
});
