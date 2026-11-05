const test = require('node:test');
const assert = require('node:assert/strict');
const UserActivity = require('../src/services/userActivity.service');

const capture = () => {
  const writes = [];
  UserActivity._reset();
  UserActivity._setWriter(async (id, at) => { writes.push({ id, at }); });
  return writes;
};
const flush = () => new Promise(resolve => setImmediate(resolve));

test.after(() => UserActivity._setWriter(null));

test('records the first activity of a user with the current date', async () => {
  const writes = capture();
  assert.equal(UserActivity.recordActivity('u1', 1_000), true);
  await flush();
  assert.deepEqual(writes, [{ id: 'u1', at: new Date(1_000) }]);
});

test('throttles writes for the same user inside the interval', async () => {
  const writes = capture();
  UserActivity.recordActivity('u1', 0);
  assert.equal(UserActivity.recordActivity('u1', UserActivity.WRITE_INTERVAL_MS - 1), false);
  assert.equal(UserActivity.recordActivity('u2', 10), true);
  assert.equal(UserActivity.recordActivity('u1', UserActivity.WRITE_INTERVAL_MS), true);
  await flush();
  assert.deepEqual(writes.map(w => w.id), ['u1', 'u2', 'u1']);
});

test('ignores requests without a user id', () => {
  capture();
  assert.equal(UserActivity.recordActivity(undefined), false);
  assert.equal(UserActivity.recordActivity(''), false);
});

test('a failed write is retried on the next request instead of waiting the interval', async () => {
  UserActivity._reset();
  let calls = 0;
  UserActivity._setWriter(async () => { calls += 1; if (calls === 1) throw new Error('mongo down'); });
  UserActivity.recordActivity('u1', 0);
  await flush(); await flush();
  assert.equal(UserActivity.recordActivity('u1', 1), true);
  await flush();
  assert.equal(calls, 2);
});
