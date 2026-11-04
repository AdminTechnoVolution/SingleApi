const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseClientVersion,
  supportsQuickMessages,
  buildVersionPolicy
} = require('../shared/util/appVersion');

const configs = [
  { key: 'ANDROID_MIN_VERSION_CODE', value: 105 },
  { key: 'ANDROID_LATEST_VERSION_CODE', value: '107' }
];

test('legacy clients without headers are unknown', () => {
  assert.deepEqual(parseClientVersion({}), { versionCode: null, platform: null });
});

test('parses well-formed headers and rejects garbage', () => {
  assert.deepEqual(parseClientVersion({ 'x-app-version': '107', 'x-app-platform': 'Android' }), { versionCode: 107, platform: 'android' });
  assert.deepEqual(parseClientVersion({ 'x-app-version': '1.0.7', 'x-app-platform': 'symbian' }), { versionCode: null, platform: null });
});

test('only Android builds at or above the threshold support quick messages', () => {
  assert.equal(supportsQuickMessages(undefined, 107), false);
  assert.equal(supportsQuickMessages({ platform: 'android', appVersionCode: 106 }, 107), false);
  assert.equal(supportsQuickMessages({ platform: 'android', appVersionCode: 107 }, 107), true);
  assert.equal(supportsQuickMessages({ platform: 'web', appVersionCode: 999 }, 107), false);
});

test('version policy flags required and available updates from configs', () => {
  assert.equal(buildVersionPolicy(configs, { versionCode: 104, platform: 'android' }).updateRequired, true);
  const soft = buildVersionPolicy(configs, { versionCode: 106, platform: 'android' });
  assert.equal(soft.updateRequired, false);
  assert.equal(soft.updateAvailable, true);
  const current = buildVersionPolicy(configs, { versionCode: 107, platform: 'android' });
  assert.equal(current.updateAvailable, false);
});

test('missing configs or unknown versions never block anyone', () => {
  const policy = buildVersionPolicy([], { versionCode: 1, platform: 'android' });
  assert.equal(policy.updateRequired, false);
  assert.equal(policy.updateAvailable, false);
  assert.equal(buildVersionPolicy(configs, { versionCode: null, platform: null }).updateRequired, false);
});
