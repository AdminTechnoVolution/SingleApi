/**
 * Calls between matched users — pure rules (unit-tested, no DB).
 */

/** Nobody answered after this long → missed. */
const RING_TIMEOUT_MS = 30 * 1000;
/** A call still "accepted" after this long is considered dead (crashed apps). */
const STALE_CALL_MS = 4 * 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ['ringing', 'accepted'];
const FINAL_STATUSES = ['declined', 'missed', 'cancelled', 'ended'];
const KINDS = ['audio', 'video'];
/** Statuses that end the ringing phase (the callee's ring must stop on every device). */
const RING_OUTCOMES = ['accepted', 'declined', 'missed', 'cancelled'];

const same = (a, b) => a != null && b != null && String(a) === String(b);
const isParticipant = (call, userId) => Boolean(call) && (same(call.caller, userId) || same(call.callee, userId));
const roleOf = (call, userId) => same(call?.caller, userId) ? 'caller' : same(call?.callee, userId) ? 'callee' : null;
const peerOf = (call, userId) => roleOf(call, userId) === 'caller' ? call.callee : roleOf(call, userId) === 'callee' ? call.caller : null;

/**
 * What a user action does to the call: { from, to } (the status it must currently
 * have, and the new one), or null when the action is not allowed for that user.
 *  accept  — callee, ringing → accepted
 *  decline — callee, ringing → declined
 *  cancel  — caller, ringing → cancelled
 *  end     — anyone: ringing → cancelled/declined (by role), accepted → ended
 */
const transitionFor = (call, userId, action) => {
    const role = roleOf(call, userId);
    if (!role) return null;
    switch (action) {
        case 'accept': return role === 'callee' ? { from: 'ringing', to: 'accepted' } : null;
        case 'decline': return role === 'callee' ? { from: 'ringing', to: 'declined' } : null;
        case 'cancel': return role === 'caller' ? { from: 'ringing', to: 'cancelled' } : null;
        case 'end':
            if (call.status === 'ringing') return { from: 'ringing', to: role === 'caller' ? 'cancelled' : 'declined' };
            if (call.status === 'accepted') return { from: 'accepted', to: 'ended' };
            return null;
        default: return null;
    }
};

/** True when an "active" call was left behind (ring timeout lost on a restart, crashed app). */
const isStale = (call, now = new Date()) => {
    if (!call) return false;
    if (call.status === 'ringing') return now - new Date(call.created_at) > RING_TIMEOUT_MS * 2;
    if (call.status === 'accepted') return now - new Date(call.answered_at || call.created_at) > STALE_CALL_MS;
    return false;
};

/** Best photo url of a user document (profile photo first, medium-ish size first). */
const photoUrlOf = (user) => {
    const photos = Array.isArray(user?.photos) ? user.photos : [];
    const photo = photos.find(p => p?.isProfile) || photos[0];
    if (!photo) return null;
    const sizes = Array.isArray(photo.sizes) ? photo.sizes : [];
    const preferred = sizes.find(s => /medium|md|small|sm/i.test(String(s?.size))) || sizes[0];
    return preferred?.url || null;
};

const firstName = (user) => String(user?.userInfo?.fullName || '').trim().split(/\s+/)[0] || null;

/** What one participant sees of a call. */
const toCallView = (call, userId, peer = null) => ({
    _id: String(call._id),
    chatId: String(call.chatId),
    kind: call.kind,
    status: call.status,
    role: roleOf(call, userId),
    peerId: peerOf(call, userId) ? String(peerOf(call, userId)) : null,
    peerName: peer ? firstName(peer) : null,
    peerPhoto: peer ? photoUrlOf(peer) : null,
    created_at: call.created_at,
    answered_at: call.answered_at || null
});

module.exports = {
    RING_TIMEOUT_MS, STALE_CALL_MS, RETENTION_MS, ACTIVE_STATUSES, FINAL_STATUSES, KINDS, RING_OUTCOMES,
    isParticipant, roleOf, peerOf, transitionFor, isStale, photoUrlOf, firstName, toCallView
};
