/**
 * Client version helpers (pure, unit-tested).
 *
 * Clients from v2 on send:
 *   X-App-Version:  integer versionCode (Android) / build number
 *   X-App-Platform: "android" | "ios" | "web"
 * Legacy clients send neither, which is how we recognise them.
 */

const HEADER_VERSION = 'x-app-version';
const HEADER_PLATFORM = 'x-app-platform';
const PLATFORMS = ['android', 'ios', 'web'];

/** Fallback when the ANDROID_QUICK_MESSAGES_MIN_VERSION_CODE config is missing. */
const DEFAULT_QUICK_MESSAGES_MIN_VERSION_CODE = 107;
/** PWA build number (SinglePwa lib/config.ts APP_VERSION_CODE) with reels + quick messages. */
const DEFAULT_WEB_QUICK_MESSAGES_MIN_VERSION_CODE = 200;
// From these builds on, scrolling past a profile sends nothing: a dislike can
// only come from an explicit tap (✕, 😞, report).
const EXPLICIT_DISLIKE_MIN_VERSION_CODE = { android: 107, web: 200 };

const parseClientVersion = (headers = {}) => {
    const rawVersion = headers[HEADER_VERSION];
    const versionCode = /^\d{1,9}$/.test(String(rawVersion ?? '').trim()) ? parseInt(rawVersion, 10) : null;
    const rawPlatform = String(headers[HEADER_PLATFORM] ?? '').trim().toLowerCase();
    const platform = PLATFORMS.includes(rawPlatform) ? rawPlatform : null;
    return { versionCode, platform };
};

const configNumber = (configs, key, fallback) => {
    const entry = (configs || []).find((c) => c.key === key);
    const value = parseInt(entry?.value, 10);
    return Number.isFinite(value) ? value : fallback;
};

/**
 * Can this user's last-seen client display quick messages?
 * Unknown/legacy clients (no clientInfo) → false.
 */
const supportsQuickMessages = (clientInfo, minVersionCode) => {
    // A number is the Android minimum (original signature); an object maps platform → minimum.
    const minimums = typeof minVersionCode === 'number' ? { android: minVersionCode } : (minVersionCode || {});
    const min = minimums[clientInfo?.platform];
    return Number.isInteger(min) &&
        Number.isInteger(clientInfo?.appVersionCode) &&
        clientInfo.appVersionCode >= min;
};

/**
 * Update policy for a client. Both thresholds come from the `configs`
 * collection, so forcing/suggesting an update needs no new release.
 * 0 (or a missing config) disables the corresponding prompt.
 */
const buildVersionPolicy = (configs, { versionCode, platform }) => {
    const prefix = (platform || 'android').toUpperCase();
    const minVersionCode = configNumber(configs, `${prefix}_MIN_VERSION_CODE`, 0);
    const latestVersionCode = configNumber(configs, `${prefix}_LATEST_VERSION_CODE`, 0);
    const known = Number.isInteger(versionCode);
    return {
        platform: platform || 'android',
        minVersionCode,
        latestVersionCode,
        updateRequired: known && minVersionCode > 0 && versionCode < minVersionCode,
        updateAvailable: known && latestVersionCode > 0 && versionCode < latestVersionCode
    };
};

/** True when this client only sends dislikes on an explicit tap (never on swipe). */
const sendsExplicitDislikes = ({ platform, versionCode, appVersionCode } = {}) =>
    supportsQuickMessages({ platform, appVersionCode: appVersionCode ?? versionCode }, EXPLICIT_DISLIKE_MIN_VERSION_CODE);

module.exports = {
    parseClientVersion,
    sendsExplicitDislikes,
    supportsQuickMessages,
    buildVersionPolicy,
    configNumber,
    DEFAULT_QUICK_MESSAGES_MIN_VERSION_CODE,
    DEFAULT_WEB_QUICK_MESSAGES_MIN_VERSION_CODE
};
