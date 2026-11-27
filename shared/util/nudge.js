const constants = require('./constants');

/** Milliseconds left before the sender may nudge this chat again (0 = allowed). Pure, unit tested. */
const nudgeCooldownRemaining = (lastNudgeAt, now = Date.now(), cooldownMs = constants.NUDGE_COOLDOWN_MS) => {
    if (!lastNudgeAt) return 0;
    const elapsed = now - new Date(lastNudgeAt).getTime();
    if (Number.isNaN(elapsed)) return 0;
    return Math.max(0, cooldownMs - elapsed);
};

module.exports = { nudgeCooldownRemaining };
