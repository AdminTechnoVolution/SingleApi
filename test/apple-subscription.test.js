process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'apple-subscription-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const Rules = require('../src/services/appStore.rules');
const AppStoreService = require('../src/services/appStore.service');
const AppStoreClient = require('../src/client/appStore.client');
const Subscription = require('../src/models/subscription.model');
const { appleVerifySchema } = require('../src/validators/subscription.validator');

const USER = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const env = { APPLE_IAP_PRODUCT_PLANS: '{"com.kultura.premium.weekly":"weekly","com.kultura.premium.monthly":"monthly"}' };

const tx = (overrides = {}) => ({
    originalTransactionId: '2000000123456789',
    transactionId: '2000000999999999',
    bundleId: 'com.technovolution.kultura',
    productId: 'com.kultura.premium.monthly',
    purchaseDate: NOW - DAY,
    expiresDate: NOW + 29 * DAY,
    type: 'Auto-Renewable Subscription',
    appAccountToken: '7f0c1c2e-1111-4a2b-9c3d-123456789abc',
    environment: 'Sandbox',
    ...overrides
});

/** Subscription collection double keyed by externalSubscriptionId. */
const store = (initial = []) => {
    const docs = new Map(initial.map(doc => [doc.externalSubscriptionId, doc]));
    return {
        docs,
        findOne: (filter) => ({ lean: async () => docs.get(filter.externalSubscriptionId) || null }),
        findOneAndUpdate: (filter, update, options = {}) => ({
            lean: async () => {
                let doc = docs.get(filter.externalSubscriptionId);
                if (!doc && !options.upsert) return null;
                doc = { ...(doc || { externalSubscriptionId: filter.externalSubscriptionId, ...(update.$setOnInsert || {}) }), ...update.$set };
                docs.set(filter.externalSubscriptionId, doc);
                return doc;
            }
        })
    };
};

const deps = (overrides = {}) => ({
    client: {
        verifyTransaction: async (jws) => { if (jws === 'bad') throw new Error('invalid'); return JSON.parse(jws); },
        verifyRenewalInfo: async (jws) => JSON.parse(jws),
        verifyNotification: async (jws) => { if (jws === 'bad') throw new Error('invalid'); return JSON.parse(jws); }
    },
    Subscription: store(),
    env,
    now: () => NOW,
    ...overrides
});

const req = (userId, body) => ({ headers: { authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET_KEY)}` }, body });

test('model accepts the app_store provider without touching the Google Play contract', () => {
    assert.ok(Subscription.schema.path('provider').enumValues.includes('app_store'));
    for (const field of ['originalTransactionId', 'appAccountToken', 'environment']) assert.ok(Subscription.schema.path(field));
    assert.equal(Subscription.schema.path('purchaseToken').isRequired, true);
});

test('product → plan mapping from env (JSON or "id:plan" list)', () => {
    assert.deepEqual(Rules.parseProductPlans('a.weekly:weekly, a.monthly:monthly'), { 'a.weekly': 'weekly', 'a.monthly': 'monthly' });
    assert.deepEqual(Rules.parseProductPlans('{"a":"quarterly"}'), { a: 'quarterly' });
    assert.deepEqual(Rules.parseProductPlans('{broken'), {});
    assert.equal(Rules.planForProduct('com.kultura.premium.weekly', env), 'weekly');
    assert.equal(Rules.planForProduct('com.other', env), null);
});

test('verify: a valid signed transaction activates premium for the caller', async () => {
    const d = deps();
    const result = await AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx()) }), d);
    assert.equal(result.data.premium, true);
    assert.equal(result.data.provider, 'app_store');
    assert.equal(result.data.plan, 'monthly');
    assert.equal(result.data.originalTransactionId, '2000000123456789');
    const saved = d.Subscription.docs.get('app_store:2000000123456789');
    assert.equal(String(saved.userId), USER);
    assert.equal(saved.status, 'active');
    assert.equal(saved.purchaseToken, 'app_store:2000000123456789');
    assert.equal(saved.appAccountToken, '7f0c1c2e-1111-4a2b-9c3d-123456789abc');
    assert.deepEqual(saved.currentPeriodEnd, new Date(NOW + 29 * DAY));
    for (const required of ['subscriptionId', 'packageName', 'purchaseToken', 'offerToken', 'orderId']) assert.ok(saved[required], required);
});

test('verify: rejects invalid signatures, non-subscriptions, unknown products and other accounts\' transactions', async () => {
    await assert.rejects(AppStoreService.verifyPurchase(req(USER, { signedTransaction: 'bad' }), deps()), { message: 'ERROR_APPLE_TRANSACTION_INVALID' });
    await assert.rejects(AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx({ type: 'Consumable' })) }), deps()), { message: 'ERROR_APPLE_TRANSACTION_INVALID' });
    await assert.rejects(AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx({ productId: 'com.x' })) }), deps()), { message: 'ERROR_APPLE_PRODUCT_UNKNOWN' });
    const owned = deps({ Subscription: store([{ externalSubscriptionId: 'app_store:2000000123456789', userId: OTHER, status: 'active' }]) });
    await assert.rejects(AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx()) }), owned), { message: 'ERROR_APPLE_TRANSACTION_OWNED', statusCode: 409 });
});

test('verify: an expired or revoked transaction does not grant premium; an old replay never shortens the period', async () => {
    const expired = await AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx({ expiresDate: NOW - 1 })) }), deps());
    assert.equal(expired.data.premium, false);
    assert.equal(expired.data.status, 'expired');
    const revoked = await AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx({ revocationDate: NOW - 1000 })) }), deps());
    assert.equal(revoked.data.premium, false);

    const d = deps();
    await AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx({ expiresDate: NOW + 60 * DAY })) }), d);
    const replay = await AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx({ expiresDate: NOW + DAY })) }), d);
    assert.deepEqual(new Date(replay.data.expiresAt), new Date(NOW + 60 * DAY));
});

test('notifications v2: renew, auto-renew off, grace period, expire, refund and revoke', async () => {
    const d = deps();
    await AppStoreService.verifyPurchase(req(USER, { signedTransaction: JSON.stringify(tx()) }), d);
    const record = () => d.Subscription.docs.get('app_store:2000000123456789');
    const notify = (notificationType, { subtype, transaction = tx(), renewal } = {}) => AppStoreService.processNotification({
        body: { signedPayload: JSON.stringify({ notificationType, subtype, notificationUUID: 'n1', data: { signedTransactionInfo: JSON.stringify(transaction), ...(renewal ? { signedRenewalInfo: JSON.stringify(renewal) } : {}) } }) }
    }, d);

    assert.deepEqual(await notify('DID_RENEW', { transaction: tx({ transactionId: 't2', expiresDate: NOW + 59 * DAY }) }), { handled: true, notificationType: 'DID_RENEW' });
    assert.deepEqual(record().currentPeriodEnd, new Date(NOW + 59 * DAY));
    assert.equal(record().orderId, 't2');

    await notify('DID_CHANGE_RENEWAL_STATUS', { renewal: { originalTransactionId: '2000000123456789', autoRenewStatus: 0 } });
    assert.equal(record().cancelAtPeriodEnd, true);

    await notify('DID_FAIL_TO_RENEW', { subtype: 'GRACE_PERIOD', renewal: { originalTransactionId: '2000000123456789', gracePeriodExpiresDate: NOW + 3 * DAY } });
    assert.equal(record().status, 'active');
    assert.deepEqual(record().currentPeriodEnd, new Date(NOW + 3 * DAY));

    await notify('EXPIRED');
    assert.equal(record().status, 'expired');

    await notify('REFUND', { transaction: tx({ revocationDate: NOW - 5 }) });
    assert.equal(record().status, 'refunded');
    await notify('REVOKE');
    assert.equal(record().status, 'revoked');

    assert.equal((await notify('DID_RENEW', { transaction: tx({ originalTransactionId: 'unknown' }) })).handled, false);
    assert.equal((await AppStoreService.processNotification({ body: { signedPayload: JSON.stringify({ notificationType: 'TEST' }) } }, d)).handled, false);
    await assert.rejects(AppStoreService.processNotification({ body: { signedPayload: 'bad' } }, d), { message: 'ERROR_APPLE_TRANSACTION_INVALID' });
});

test('real verifier (Apple library + bundled Apple Root CA G3) rejects forged JWS', async () => {
    const verifiers = AppStoreClient.buildVerifiers({ APPLE_BUNDLE_ID: 'com.technovolution.kultura', APPLE_IAP_ONLINE_CHECKS: 'false' });
    assert.deepEqual(verifiers.map(v => v.environment), ['Sandbox']);
    const forged = [
        Buffer.from(JSON.stringify({ alg: 'ES256', x5c: ['AAAA', 'BBBB', 'CCCC'] })).toString('base64url'),
        Buffer.from(JSON.stringify(tx())).toString('base64url'),
        'c2ln'
    ].join('.');
    await assert.rejects(verifiers[0].verifier.verifyAndDecodeTransaction(forged));
    assert.throws(() => AppStoreClient.buildVerifiers({}), /APPLE_BUNDLE_ID/);
    const withProduction = AppStoreClient.buildVerifiers({ APPLE_BUNDLE_ID: 'b', APPLE_APP_APPLE_ID: '123456789', APPLE_IAP_ALLOW_SANDBOX: 'false' });
    assert.deepEqual(withProduction.map(v => v.environment), ['Production']);
    const root = AppStoreClient.loadRootCertificates({})[0];
    const { X509Certificate } = require('crypto');
    assert.equal(new X509Certificate(root).fingerprint256, '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79');
});

test('verify body requires the signed transaction', () => {
    assert.equal(appleVerifySchema.validate({ signedTransaction: 'eyJ...' }).error, undefined);
    assert.ok(appleVerifySchema.validate({}).error);
});

test('premium checks include active App Store subscriptions', async () => {
    const SubscriptionRepository = require('../src/repository/subscription.repository');
    const original = Subscription.findOne;
    let filter;
    Subscription.findOne = (f) => { filter = f; return { sort: async () => ({ provider: 'app_store' }) }; };
    try {
        const found = await SubscriptionRepository.findActiveStripeForUser(USER);
        assert.equal(found.provider, 'app_store');
    } finally {
        Subscription.findOne = original;
    }
    assert.ok(filter.provider.$in.includes('app_store'));
    assert.deepEqual(filter.status, { $in: ['active', 'trialing'] });
    assert.ok(filter.currentPeriodEnd.$gt instanceof Date);
});
