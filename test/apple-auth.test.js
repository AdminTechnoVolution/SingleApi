const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const AppleClient = require('../src/client/apple.client');
const { loginSchema } = require('../src/validators/auth.validator');
const { registerUserSchema } = require('../src/validators/user.validator');

const BUNDLE = 'com.technovolution.kultura';
const env = { APPLE_BUNDLE_ID: `${BUNDLE},com.technovolution.kultura.web` };
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'apple-kid-1', alg: 'RS256', use: 'sig' };

const sign = (claims = {}, { kid = 'apple-kid-1', key = privateKey, expiresIn = 600 } = {}) => jwt.sign(
    { iss: 'https://appleid.apple.com', aud: BUNDLE, sub: '001234.abcdef.1234', email: 'xyz@privaterelay.appleid.com', email_verified: 'true', is_private_email: 'true', ...claims },
    key, { algorithm: 'RS256', keyid: kid, expiresIn });

const jwksFetch = (keys = [jwk]) => {
    const calls = [];
    const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ keys }) }; };
    return { fetchImpl, calls };
};

test('valid identity token: verified against Apple JWKS, returns subject and email', async () => {
    AppleClient.resetJwksCache();
    const { fetchImpl, calls } = jwksFetch();
    const identity = await AppleClient.verifyIdentityToken(sign(), { env, fetchImpl });
    assert.deepEqual(identity, { email: 'xyz@privaterelay.appleid.com', socialId: '001234.abcdef.1234', isVerified: true, isPrivateEmail: true });
    assert.deepEqual(calls, ['https://appleid.apple.com/auth/keys']);
    // Keys are cached.
    await AppleClient.verifyIdentityToken(sign(), { env, fetchImpl });
    assert.equal(calls.length, 1);
});

test('a Services ID audience (web) is also accepted when configured', async () => {
    AppleClient.resetJwksCache();
    const identity = await AppleClient.verifyIdentityToken(sign({ aud: 'com.technovolution.kultura.web' }), { env, fetchImpl: jwksFetch().fetchImpl });
    assert.equal(identity.socialId, '001234.abcdef.1234');
});

test('rejects wrong audience, wrong issuer, expired tokens and foreign signatures', async () => {
    const { fetchImpl } = jwksFetch();
    const reject = (token) => assert.rejects(AppleClient.verifyIdentityToken(token, { env, fetchImpl }), { message: 'ERROR_LOGIN', statusCode: 401 });
    await reject(sign({ aud: 'com.attacker.app' }));
    await reject(sign({ iss: 'https://accounts.google.com' }));
    await reject(sign({}, { expiresIn: -10 }));
    await reject(sign({}, { key: otherKeys.privateKey }));
    await reject('not-a-jwt');
    await reject(jwt.sign({ sub: 'x' }, 'hmac-secret', { algorithm: 'HS256', keyid: 'apple-kid-1' }));
});

test('unknown kid refreshes the JWKS once (key rotation), then fails if still unknown', async () => {
    AppleClient.resetJwksCache();
    const first = jwksFetch();
    await AppleClient.verifyIdentityToken(sign(), { env, fetchImpl: first.fetchImpl });
    const rotated = { ...otherKeys.publicKey.export({ format: 'jwk' }), kid: 'apple-kid-2', alg: 'RS256' };
    const second = jwksFetch([jwk, rotated]);
    const identity = await AppleClient.verifyIdentityToken(sign({}, { kid: 'apple-kid-2', key: otherKeys.privateKey }), { env, fetchImpl: second.fetchImpl });
    assert.equal(identity.socialId, '001234.abcdef.1234');
    assert.equal(second.calls.length, 1);
    await assert.rejects(AppleClient.verifyIdentityToken(sign({}, { kid: 'apple-kid-3' }), { env, fetchImpl: second.fetchImpl }), { statusCode: 401 });
});

test('not configured (no APPLE_BUNDLE_ID) → service unavailable, never accepted', async () => {
    await assert.rejects(AppleClient.verifyIdentityToken(sign(), { env: {}, fetchImpl: jwksFetch().fetchImpl }), { message: 'ERROR_SERVICE_UNAVAILABLE', statusCode: 503 });
});

test('login contract: Apple may omit the email; Google and password still require it', () => {
    assert.equal(loginSchema.validate({ authMethod: 'apple', socialToken: 'identity-token', platform: 'iOS' }).error, undefined);
    assert.equal(loginSchema.validate({ email: 'a@b.com', authMethod: 'apple', socialToken: 'identity-token' }).error, undefined);
    assert.ok(loginSchema.validate({ authMethod: 'google', socialToken: 'google-token' }).error);
    assert.ok(loginSchema.validate({ password: 'secret123' }).error);
});

test('registration accepts authMethod apple with the identity token', () => {
    const body = {
        email: 'xyz@privaterelay.appleid.com',
        authMethod: 'apple',
        socialToken: 'identity-token',
        userInfo: { fullName: 'Kenji Sato', birthdate: '1994-05-06', gender: 'M' },
        preferences: { intents: ['language_exchange'] },
        location: { coordinates: [139.69, 35.68] }
    };
    assert.equal(registerUserSchema.validate(body).error, undefined);
});

test('Apple users are found by subject first, then linked by the verified token email only', async () => {
    process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'x';
    const { findAppleUser } = require('../src/services/auth.service');
    const filters = [];
    const repo = (results) => ({ findOneByFilter: async (filter) => { filters.push(filter); return results.shift() ?? null; } });

    const bySubject = await findAppleUser({ socialId: 'sub-1', email: 'a@b.com', isVerified: true }, repo([{ _id: 'u1' }]));
    assert.equal(bySubject._id, 'u1');
    assert.deepEqual(filters.at(-1), { 'auth.method': 'apple', 'auth.socialId': 'sub-1' });

    const byEmail = await findAppleUser({ socialId: 'sub-2', email: 'a@b.com', isVerified: true }, repo([null, { _id: 'u2' }]));
    assert.equal(byEmail._id, 'u2');
    assert.deepEqual(filters.at(-1), { email: 'a@b.com' });

    assert.equal(await findAppleUser({ socialId: 'sub-3', email: 'a@b.com', isVerified: false }, repo([null, { _id: 'u3' }])), null);
    assert.equal(await findAppleUser({ socialId: 'sub-4' }, repo([null])), null);
});
