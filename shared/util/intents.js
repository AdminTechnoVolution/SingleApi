/**
 * Kultura intents — pure helpers (unit-tested, no DB).
 *
 * Backward compatibility rule: a client/user WITHOUT intents is a legacy
 * Single client/user and keeps the dating behaviour exactly as before.
 */
const Intent = require('../../src/enums/EnumIntent');

const INTENTS = Object.values(Intent);
/** lookingFor master id "New friends or chats". */
const LOOKING_FOR_FRIENDS_ID = '5';

const isValidIntent = (value) => INTENTS.includes(value);

const normalizeIntents = (values) =>
    [...new Set((Array.isArray(values) ? values : []).map(String).filter(isValidIntent))];

/** True when intents are absent (legacy) or include 'dating': the dating fields are required. */
const requiresDatingProfile = (intents) => {
    if (intents === undefined || intents === null) return true;
    const list = normalizeIntents(intents);
    return list.length === 0 || list.includes(Intent.DATING);
};

/** Intents for a user that registered before Kultura (backfill + legacy registrations). */
const legacyIntentsFor = (lookingFor) =>
    (String(lookingFor ?? '') === LOOKING_FOR_FRIENDS_ID ? [Intent.FRIENDS] : [Intent.DATING]);

const isIosClient = (headers = {}) =>
    String(headers['x-app-platform'] ?? '').trim().toLowerCase() === 'ios';

/**
 * Intent requested by a client (discover, like):
 *  - explicit ?intent= / body.intent (must be valid, else `invalid: true`);
 *  - none + iOS client → language_exchange;
 *  - none otherwise → null (legacy: exactly the old behaviour).
 */
const resolveRequestedIntent = (explicit, headers = {}) => {
    if (explicit !== undefined && explicit !== null && explicit !== '') {
        const value = String(explicit).trim().toLowerCase();
        return isValidIntent(value) ? { intent: value, legacy: false } : { intent: null, legacy: false, invalid: true };
    }
    if (isIosClient(headers)) return { intent: Intent.LANGUAGE_EXCHANGE, legacy: false };
    return { intent: null, legacy: true };
};

/**
 * Intent of a new connection from both likes. Undefined = legacy (dating).
 * Non-dating wins over dating (dating is only ever unlocked via Next level);
 * language_exchange wins over friends.
 */
const resolveMatchIntent = (a, b) => {
    const values = [a, b].filter(isValidIntent);
    if (values.length === 0) return undefined;
    if (values.length === 1 || values[0] === values[1]) return values[0];
    if (values.includes(Intent.LANGUAGE_EXCHANGE)) return Intent.LANGUAGE_EXCHANGE;
    return Intent.FRIENDS;
};

module.exports = {
    INTENTS,
    LOOKING_FOR_FRIENDS_ID,
    isValidIntent,
    normalizeIntents,
    requiresDatingProfile,
    legacyIntentsFor,
    isIosClient,
    resolveRequestedIntent,
    resolveMatchIntent
};
