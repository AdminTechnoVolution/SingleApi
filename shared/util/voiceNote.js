const constants = require('./constants');

/** Duration sent by the client, clamped to [0, AUDIO_MAX_DURATION_MS]. Invalid → 0. */
const clampDurationMs = (value) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, constants.AUDIO_MAX_DURATION_MS);
};

/** Blob path for a voice note of a chat. */
const voiceNoteBlobPath = (chatId) => `chats/${chatId}/audio/`;

/**
 * A voice note attachment must be a blob we uploaded for this same chat,
 * so a client can't make the other user's app stream arbitrary URLs.
 */
const isOwnVoiceNoteUrl = (url, containerUrl, chatId) => {
    if (typeof url !== 'string' || !containerUrl || !chatId) return false;
    const prefix = containerUrl + voiceNoteBlobPath(chatId);
    return url.startsWith(prefix) && /^[A-Za-z0-9-]+\.m4a$/.test(url.slice(prefix.length));
};

module.exports = { clampDurationMs, voiceNoteBlobPath, isOwnVoiceNoteUrl };
