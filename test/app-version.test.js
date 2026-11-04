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

test('only the new Android app sends explicit dislikes (legacy swiped = dislike)', () => {
    const { sendsExplicitDislikes, parseClientVersion } = require('../shared/util/appVersion');
    assert.strictEqual(sendsExplicitDislikes(parseClientVersion({ 'x-app-version': '107', 'x-app-platform': 'android' })), true);
    assert.strictEqual(sendsExplicitDislikes(parseClientVersion({ 'x-app-version': '106', 'x-app-platform': 'android' })), false);
    assert.strictEqual(sendsExplicitDislikes(parseClientVersion({})), false); // old app / PWA: no headers
});

test('the new PWA (web ≥ 200) gets explicit dislikes and quick messages; old PWA does not', () => {
    const { sendsExplicitDislikes, supportsQuickMessages, parseClientVersion } = require('../shared/util/appVersion');
    const pwaNew = parseClientVersion({ 'x-app-version': '200', 'x-app-platform': 'web' });
    assert.strictEqual(sendsExplicitDislikes(pwaNew), true);
    assert.strictEqual(sendsExplicitDislikes(parseClientVersion({ 'x-app-version': '199', 'x-app-platform': 'web' })), false);
    assert.strictEqual(supportsQuickMessages({ platform: 'web', appVersionCode: 200 }, { android: 107, web: 200 }), true);
    assert.strictEqual(supportsQuickMessages({ platform: 'web', appVersionCode: 200 }, 107), false); // number = Android only
    assert.strictEqual(supportsQuickMessages(null, { android: 107, web: 200 }), false);
});
