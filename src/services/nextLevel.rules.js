/**
 * Kultura "Next level" — pure rules (unit-tested, no DB).
 *
 * A connection (match, chatId === matchId) can be taken to the next level
 * (romantic features) only by mutual consent. Each participant's wish is private:
 * the other side never learns it until both want it (unlock).
 */

/** Messages exchanged in the chat (both senders) that make a connection eligible. */
const MIN_MESSAGES = Number(process.env.NEXT_LEVEL_MIN_MESSAGES) || 20;
/** Completed (answered and ended) calls between the pair that make it eligible. */
const MIN_COMPLETED_CALLS = 1;

/**
 * Eligible when the requester has "Open to something more" on AND
 * (both have it on OR enough messages OR a completed call).
 */
const isEligible = ({ meOpenToDating, peerOpenToDating, messageCount = 0, completedCalls = 0 }) =>
    meOpenToDating === true && (
        peerOpenToDating === true ||
        messageCount >= MIN_MESSAGES ||
        completedCalls >= MIN_COMPLETED_CALLS
    );

const wishesOf = (match) => {
    const users = match?.nextLevel?.users;
    if (!users) return new Map();
    return users instanceof Map ? users : new Map(Object.entries(users));
};

const iWantFor = (match, userId) => wishesOf(match).get(String(userId)) === true;

const isUnlocked = (match) => Boolean(match?.nextLevel?.unlockedAt);

/** True when every participant wants it (2 users). */
const bothWant = (match) => {
    const users = (match?.users || []).map(String);
    return users.length >= 2 && users.every(id => wishesOf(match).get(id) === true);
};

/**
 * What the requester may see. NEVER includes the peer's wish before unlock
 * (and after unlock it is implied: both wanted it).
 */
const viewFor = (match, userId, eligible) => ({
    chatId: String(match._id),
    eligible: Boolean(eligible) || isUnlocked(match),
    iWant: iWantFor(match, userId),
    unlocked: isUnlocked(match),
    unlockedAt: match?.nextLevel?.unlockedAt || null
});

/** Atomic "unlock once" filter: only one concurrent request can set unlockedAt. */
const buildUnlockFilter = (match) => {
    const filter = { _id: match._id, status: 'matched', 'nextLevel.unlockedAt': { $exists: false } };
    (match.users || []).map(String).forEach(id => { filter[`nextLevel.users.${id}`] = true; });
    return filter;
};

module.exports = {
    MIN_MESSAGES,
    MIN_COMPLETED_CALLS,
    isEligible,
    iWantFor,
    isUnlocked,
    bothWant,
    viewFor,
    buildUnlockFilter
};
