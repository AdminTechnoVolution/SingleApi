const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../src/services/call.rules');
const { callStartSchema } = require('../src/validators/call.validator');

const CALLER = '64b000000000000000000001';
const CALLEE = '64b000000000000000000002';
const STRANGER = '64b000000000000000000003';
const call = (status, overrides = {}) => ({ _id: 'c1', chatId: 'm1', caller: CALLER, callee: CALLEE, kind: 'video', status, created_at: new Date('2026-11-04T12:00:00Z'), ...overrides });

test('only the callee accepts or declines a ringing call', () => {
    assert.deepEqual(Rules.transitionFor(call('ringing'), CALLEE, 'accept'), { from: 'ringing', to: 'accepted' });
    assert.deepEqual(Rules.transitionFor(call('ringing'), CALLEE, 'decline'), { from: 'ringing', to: 'declined' });
    assert.equal(Rules.transitionFor(call('ringing'), CALLER, 'accept'), null);
    assert.equal(Rules.transitionFor(call('ringing'), CALLER, 'decline'), null);
});

test('only the caller cancels a ringing call', () => {
    assert.deepEqual(Rules.transitionFor(call('ringing'), CALLER, 'cancel'), { from: 'ringing', to: 'cancelled' });
    assert.equal(Rules.transitionFor(call('ringing'), CALLEE, 'cancel'), null);
});

test('hanging up maps to the right final status for each phase and role', () => {
    assert.deepEqual(Rules.transitionFor(call('ringing'), CALLER, 'end'), { from: 'ringing', to: 'cancelled' });
    assert.deepEqual(Rules.transitionFor(call('ringing'), CALLEE, 'end'), { from: 'ringing', to: 'declined' });
    assert.deepEqual(Rules.transitionFor(call('accepted'), CALLEE, 'end'), { from: 'accepted', to: 'ended' });
    for (const done of Rules.FINAL_STATUSES) assert.equal(Rules.transitionFor(call(done), CALLER, 'end'), null);
});

test('strangers can do nothing with a call', () => {
    for (const action of ['accept', 'decline', 'cancel', 'end']) assert.equal(Rules.transitionFor(call('ringing'), STRANGER, action), null);
    assert.equal(Rules.isParticipant(call('ringing'), STRANGER), false);
});

test('role and peer are resolved for both participants', () => {
    assert.equal(Rules.roleOf(call('ringing'), CALLER), 'caller');
    assert.equal(Rules.peerOf(call('ringing'), CALLER), CALLEE);
    assert.equal(Rules.peerOf(call('ringing'), CALLEE), CALLER);
});

test('stale detection: lost ring timers and crashed calls', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    assert.equal(Rules.isStale(call('ringing', { created_at: new Date(now - 10_000) }), now), false);
    assert.equal(Rules.isStale(call('ringing', { created_at: new Date(now - Rules.RING_TIMEOUT_MS * 3) }), now), true);
    assert.equal(Rules.isStale(call('accepted', { answered_at: new Date(now - Rules.STALE_CALL_MS - 1) }), now), true);
    assert.equal(Rules.isStale(call('ended'), now), false);
});

test('call view shows the peer first name and profile photo, never more', () => {
    const peer = { userInfo: { fullName: 'Ana María López' }, photos: [{ isProfile: false, sizes: [{ size: 'medium', url: 'x' }] }, { isProfile: true, sizes: [{ size: 'large', url: 'big' }, { size: 'medium', url: 'mid' }] }] };
    const view = Rules.toCallView(call('ringing'), CALLEE, peer);
    assert.deepEqual(view, { _id: 'c1', chatId: 'm1', kind: 'video', status: 'ringing', role: 'callee', peerId: CALLER, peerName: 'Ana', peerPhoto: 'mid', created_at: call('ringing').created_at, answered_at: null });
});

test('the ring outcome statuses stop ringing; ended does not', () => {
    assert.deepEqual(Rules.RING_OUTCOMES.sort(), ['accepted', 'cancelled', 'declined', 'missed']);
});

test('start schema: chat id + audio/video only', () => {
    assert.equal(callStartSchema.validate({ chatId: '64b000000000000000000001', kind: 'video' }).error, undefined);
    assert.ok(callStartSchema.validate({ chatId: '64b000000000000000000001', kind: 'screen' }).error);
    assert.ok(callStartSchema.validate({ chatId: 'nope', kind: 'audio' }).error);
    assert.ok(callStartSchema.validate({ kind: 'audio' }).error);
});
