const crypto = require('crypto');

/**
 * ICE servers for WebRTC voice calls. Credentials are short-lived and minted
 * per request — never shipped inside the apps.
 *
 * Providers (first configured wins):
 *  1. Cloudflare Realtime TURN (managed):  TURN_PROVIDER_KEY_ID + TURN_PROVIDER_API_TOKEN
 *  2. Any TURN with the standard REST/HMAC scheme (coturn, Metered…):
 *     TURN_URLS (comma separated) + TURN_SHARED_SECRET
 *  3. Nothing configured → public STUN only (most Wi-Fi calls work, some mobile
 *     carriers/NATs will not connect).
 */
const DEFAULT_STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const DEFAULT_TTL_SECS = 3600;

/** Standard TURN REST API credentials (draft-uberti-behave-turn-rest): user = "<expiry>:<id>", pass = HMAC-SHA1. */
const hmacIceServers = ({ urls, secret, userId, ttlSecs = DEFAULT_TTL_SECS, now = Date.now() }) => {
    const username = `${Math.floor(now / 1000) + ttlSecs}:${userId}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    return [...DEFAULT_STUN, { urls, username, credential }];
};

const cloudflareIceServers = async ({ keyId, apiToken, ttlSecs = DEFAULT_TTL_SECS, fetchImpl = fetch }) => {
    const response = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: ttlSecs })
    });
    if (!response.ok) throw new Error(`TURN provider responded ${response.status}`);
    const body = await response.json();
    const servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
    return servers.filter(Boolean);
};

const getIceServers = async (userId, env = process.env) => {
    const ttlSecs = Number(env.TURN_CREDENTIALS_TTL_SECS) || DEFAULT_TTL_SECS;
    if (env.TURN_PROVIDER_KEY_ID && env.TURN_PROVIDER_API_TOKEN) {
        return { provider: 'cloudflare', ttlSecs, iceServers: await cloudflareIceServers({ keyId: env.TURN_PROVIDER_KEY_ID, apiToken: env.TURN_PROVIDER_API_TOKEN, ttlSecs }) };
    }
    if (env.TURN_URLS && env.TURN_SHARED_SECRET) {
        const urls = env.TURN_URLS.split(',').map(url => url.trim()).filter(Boolean);
        return { provider: 'hmac', ttlSecs, iceServers: hmacIceServers({ urls, secret: env.TURN_SHARED_SECRET, userId, ttlSecs }) };
    }
    return { provider: 'stun-only', ttlSecs, iceServers: DEFAULT_STUN };
};

module.exports = { getIceServers, hmacIceServers, cloudflareIceServers, DEFAULT_STUN };
