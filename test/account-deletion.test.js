const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../src/services/accountDeletion.rules');

const USER = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
const NOW = new Date('2026-11-05T12:00:00Z');
const LATER = new Date('2026-12-05T12:00:00Z');
const EARLIER = new Date('2026-10-05T12:00:00Z');

test('reports are deleted with the account except child-safety ones', () => {
    const filter = Rules.deletableReportsOfUser(USER);
    assert.deepEqual(filter.$or, [{ reporterUserId: USER }, { reportedUserId: USER }]);
    assert.deepEqual(filter.reportReason, { $ne: 'minor_safety' });
});

test('a legal hold is required only when the user was reported for child safety', () => {
    assert.equal(Rules.requiresLegalHold([], USER), false);
    assert.equal(Rules.requiresLegalHold([{ reportReason: 'spam', reportedUserId: USER }], USER), false);
    // The user reported someone else: that evidence is about the other account.
    assert.equal(Rules.requiresLegalHold([{ reportReason: 'minor_safety', reporterUserId: USER, reportedUserId: OTHER }], USER), false);
    assert.equal(Rules.requiresLegalHold([{ reportReason: 'minor_safety', reporterUserId: OTHER, reportedUserId: USER }], USER), true);
});

test('every size of every photo is listed for storage deletion', () => {
    const user = { photos: [
        { path: 'u1/a', sizes: [{ name: '_sm.webp' }, { name: '_lg.webp' }] },
        { path: 'u1/b', sizes: [{ name: '_sm.webp' }] }
    ] };
    assert.deepEqual(Rules.photoBlobNames(user), ['u1/a_sm.webp', 'u1/a_lg.webp', 'u1/b_sm.webp']);
    assert.deepEqual(Rules.photoBlobNames(null), []);
    assert.deepEqual(Rules.photoBlobNames({ photos: [{ path: 'x' }] }), []);
});

test('only subscriptions that still renew are cancelled at the provider', () => {
    assert.equal(Rules.needsProviderCancel({ provider: 'google_play', paymentInfo: { toDate: LATER } }, NOW), true);
    assert.equal(Rules.needsProviderCancel({ provider: 'google_play', paymentInfo: { toDate: LATER, cancelReason: 0 } }, NOW), false);
    assert.equal(Rules.needsProviderCancel({ provider: 'google_play', paymentInfo: { toDate: EARLIER } }, NOW), false);
    assert.equal(Rules.needsProviderCancel({ provider: 'dlocalgo', status: 'active' }, NOW), true);
    assert.equal(Rules.needsProviderCancel({ provider: 'dlocalgo', status: 'active', cancelAtPeriodEnd: true }, NOW), false);
    assert.equal(Rules.needsProviderCancel({ provider: 'dlocalgo', status: 'canceled' }, NOW), false);
});
