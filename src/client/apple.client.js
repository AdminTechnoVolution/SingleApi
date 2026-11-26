const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const ClientException = require('../../shared/exceptionHandler/ClientException');
const c = require('../../shared/util/constants.frontcodes');

/**
 * Sign in with Apple: verifies the identityToken (JWT RS256) the iOS app gets from
 * ASAuthorizationAppleIDCredential against Apple's public keys (JWKS), checking
 * signature, iss, aud (our bundle id) and exp.
 *
 * Env: APPLE_BUNDLE_ID — audience(s); comma-separated to also accept a Services ID (web).
 */
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = { keys: null, fetchedAt: 0 };

const audiences = (env = process.env) =>
    String(env.APPLE_BUNDLE_ID || '').split(',').map(value => value.trim()).filter(Boolean);

const fetchJwks = async (fetchImpl = globalThis.fetch) => {
    const response = await fetchImpl(APPLE_JWKS_URL);
    if (!response.ok) throw new Error(`Apple JWKS HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.keys)) throw new Error('Apple JWKS without keys');
    return body.keys;
};

/** Public key for `kid`; refreshes the cached JWKS once when the kid is unknown (key rotation). */
const getPublicKey = async (kid, { fetchImpl, now = Date.now() } = {}) => {
    const fresh = jwksCache.keys && now - jwksCache.fetchedAt < JWKS_TTL_MS;
    let jwk = fresh ? jwksCache.keys.find(key => key.kid === kid) : null;
    if (!jwk) {
        jwksCache = { keys: await fetchJwks(fetchImpl), fetchedAt: now };
        jwk = jwksCache.keys.find(key => key.kid === kid);
    }
    if (!jwk) throw new Error(`Apple key ${kid} not found`);
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
};

/** Apple sends booleans as strings ("true") in some claims. */
const claimTrue = (value) => value === true || value === 'true';

/**
 * Verifies an Apple identity token. Returns { email, socialId, isVerified, isPrivateEmail }.
 * Throws ClientException(ERROR_LOGIN, 401) on any invalid token, 503 if not configured.
 */
const verifyIdentityToken = async (identityToken, { env = process.env, fetchImpl, now } = {}) => {
    const audience = audiences(env);
    if (audience.length === 0) {
        logger.error({ message: 'APPLE_BUNDLE_ID is not configured', className: filename });
        throw new ClientException(c.CODE_ERROR_SERVICE_UNAVAILABLE, 503);
    }
    try {
        const decoded = jwt.decode(identityToken, { complete: true });
        if (!decoded?.header?.kid || decoded.header.alg !== 'RS256') throw new Error('Malformed Apple identity token');
        const key = await getPublicKey(decoded.header.kid, { fetchImpl, now });
        const payload = jwt.verify(identityToken, key, {
            algorithms: ['RS256'],
            issuer: APPLE_ISSUER,
            audience,
            ...(now ? { clockTimestamp: Math.floor(now / 1000) } : {})
        });
        if (!payload.sub) throw new Error('Apple identity token without sub');
        return {
            email: payload.email ? String(payload.email).toLowerCase() : undefined,
            socialId: payload.sub,
            isVerified: claimTrue(payload.email_verified),
            isPrivateEmail: claimTrue(payload.is_private_email)
        };
    } catch (error) {
        if (error instanceof ClientException) throw error;
        logger.error({ message: `Apple identity token rejected: ${error.message}`, className: filename });
        throw new ClientException(c.CODE_ERROR_LOGIN, 401);
    }
};

/** Tests only: forget cached keys. */
const resetJwksCache = () => { jwksCache = { keys: null, fetchedAt: 0 }; };

module.exports = { verifyIdentityToken, resetJwksCache, APPLE_ISSUER, APPLE_JWKS_URL };
