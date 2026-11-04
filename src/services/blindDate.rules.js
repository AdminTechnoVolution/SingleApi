/**
 * Blind dates — pure rules (unit-tested, no DB).
 */

/** An open room with no guest after this long is closed as "expired". */
const OPEN_ROOM_TTL_MS = 30 * 60 * 1000;
/** Host must start the call this long after a guest claims the room, else it reopens. */
const HOST_CONNECT_TIMEOUT_MS = 45 * 1000;
/** Room documents are purged (Mongo TTL) a day after creation. */
const ROOM_RETENTION_MS = 24 * 60 * 60 * 1000;
const LIVE_STATUSES = ['open', 'matched', 'in_call'];

const ageFrom = (birthdate, now = new Date()) => {
    const born = new Date(birthdate);
    if (Number.isNaN(born.getTime())) return null;
    let age = now.getFullYear() - born.getFullYear();
    const beforeBirthday = now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
    if (beforeBirthday) age--;
    return age;
};

const ids = (values) => (Array.isArray(values) ? values : []).filter(Boolean).map(String);
const intersects = (wanted, actual) => wanted.length === 0 || ids(actual).some(value => wanted.includes(value));

/** Normalises user-provided conditions (dedupe, ordered age range). */
const normalizeConditions = (conditions = {}) => {
    let ageMin = Number.isInteger(conditions.ageMin) ? conditions.ageMin : 18;
    let ageMax = Number.isInteger(conditions.ageMax) ? conditions.ageMax : 99;
    if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
    const unique = (values) => [...new Set(ids(values))];
    return {
        genders: unique(conditions.genders),
        ageMin: Math.max(18, ageMin),
        ageMax: Math.min(99, ageMax),
        languages: unique(conditions.languages),
        musicGenres: unique(conditions.musicGenres),
        lookingFor: unique(conditions.lookingFor)
    };
};

/**
 * Does `guest` (a user document) satisfy the room?
 * Mutual: the guest must also be looking for the host's gender.
 * Empty condition lists mean "any".
 */
const isCompatible = (room, guest, now = new Date()) => {
    const c = normalizeConditions(room.conditions || {});
    const info = guest?.userInfo || {};
    const age = ageFrom(info.birthdate, now);
    if (age === null || age < c.ageMin || age > c.ageMax) return false;
    if (c.genders.length && !c.genders.includes(String(info.gender))) return false;
    if (!intersects(c.languages, info.languages)) return false;
    if (!intersects(c.musicGenres, guest?.musicPreferences?.musicGenres)) return false;
    if (c.lookingFor.length && !c.lookingFor.includes(String(guest?.preferences?.lookingFor))) return false;
    if (room.hostGender && !ids(guest?.preferences?.preferences).includes(String(room.hostGender))) return false;
    return true;
};

/**
 * Mongo filter for the open rooms `me` can see (DB-side version of isCompatible).
 * `excludedHostIds`: myself + people I matched/blocked.
 */
const buildOpenRoomsFilter = (me, excludedHostIds = [], now = new Date()) => {
    const info = me?.userInfo || {};
    const age = ageFrom(info.birthdate, now) ?? 0;
    const emptyOr = (field, values) => ({ $or: [{ [field]: { $size: 0 } }, { [field]: { $exists: false } }, { [field]: { $in: ids(values) } }] });
    return {
        status: 'open',
        guestId: null,
        hostId: { $nin: excludedHostIds },
        created_at: { $gte: new Date(now.getTime() - OPEN_ROOM_TTL_MS) },
        'conditions.ageMin': { $lte: age },
        'conditions.ageMax': { $gte: age },
        $and: [
            emptyOr('conditions.genders', [info.gender]),
            emptyOr('conditions.languages', info.languages),
            emptyOr('conditions.musicGenres', me?.musicPreferences?.musicGenres),
            emptyOr('conditions.lookingFor', [me?.preferences?.lookingFor]),
            { hostGender: { $in: ids(me?.preferences?.preferences) } }
        ]
    };
};

/**
 * THE race-condition guard: a single atomic findOneAndUpdate on this filter.
 * Only one concurrent request can match `status:'open', guestId:null`.
 */
const buildClaimFilter = (roomId, guestId, now = new Date()) => ({
    _id: roomId,
    status: 'open',
    guestId: null,
    hostId: { $ne: guestId },
    created_at: { $gte: new Date(now.getTime() - OPEN_ROOM_TTL_MS) }
});

/** Safe public view of a room for guests: host's first name + conditions only. */
const toPublicRoom = (room) => ({
    _id: room._id,
    hostName: String(room.hostName || '').trim().split(/\s+/)[0] || '',
    conditions: normalizeConditions(room.conditions || {}),
    created_at: room.created_at
});

const isParticipant = (room, userId) =>
    Boolean(room) && [room.hostId, room.guestId].filter(Boolean).map(String).includes(String(userId));

const otherParticipant = (room, userId) =>
    String(room.hostId) === String(userId) ? room.guestId : room.hostId;

module.exports = {
    OPEN_ROOM_TTL_MS,
    HOST_CONNECT_TIMEOUT_MS,
    ROOM_RETENTION_MS,
    LIVE_STATUSES,
    ageFrom,
    normalizeConditions,
    isCompatible,
    buildOpenRoomsFilter,
    buildClaimFilter,
    toPublicRoom,
    isParticipant,
    otherParticipant
};
