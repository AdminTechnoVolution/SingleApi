/**
 * App Store subscriptions — pure rules (unit-tested, no DB, no network).
 *
 * A subscription is stored with provider 'app_store' and the "web" shape used by
 * Stripe/dLocal Go (status + currentPeriodEnd), so premium.service honours it.
 */
const PROVIDER = 'app_store';
const AUTO_RENEWABLE = 'Auto-Renewable Subscription';

/**
 * productId → plan mapping from APPLE_IAP_PRODUCT_PLANS:
 *   JSON  {"com.kultura.premium.weekly":"weekly", ...}
 *   or    "com.kultura.premium.weekly:weekly,com.kultura.premium.monthly:monthly"
 */
const parseProductPlans = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return {};
    if (text.startsWith('{')) {
        try {
            const parsed = JSON.parse(text);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }
    return Object.fromEntries(text.split(',')
        .map(pair => pair.split(':').map(part => part.trim()))
        .filter(([productId, plan]) => productId && plan));
};

const planForProduct = (productId, env = process.env) => parseProductPlans(env.APPLE_IAP_PRODUCT_PLANS)[productId] || null;

const recordKey = (originalTransactionId) => `${PROVIDER}:${originalTransactionId}`;

/** Status from a decoded StoreKit transaction. */
const statusOf = (tx, now = Date.now()) => {
    if (tx.revocationDate) return 'revoked';
    if (!tx.expiresDate || Number(tx.expiresDate) <= now) return 'expired';
    return 'active';
};

/** $set for the subscription record of a decoded transaction. */
const buildSubscriptionUpdate = (tx, { userId, plan, now = Date.now() }) => {
    const status = statusOf(tx, now);
    const key = recordKey(tx.originalTransactionId);
    return {
        userId,
        provider: PROVIDER,
        subscriptionId: tx.productId,
        packageName: tx.bundleId,
        purchaseToken: key,
        offerToken: plan,
        orderId: String(tx.transactionId),
        externalSubscriptionId: key,
        originalTransactionId: String(tx.originalTransactionId),
        ...(tx.appAccountToken ? { appAccountToken: tx.appAccountToken } : {}),
        environment: tx.environment,
        status,
        currentPeriodStart: tx.purchaseDate ? new Date(Number(tx.purchaseDate)) : undefined,
        currentPeriodEnd: status === 'revoked'
            ? new Date(Number(tx.revocationDate))
            : (tx.expiresDate ? new Date(Number(tx.expiresDate)) : new Date(now)),
        updated_at: new Date(now)
    };
};

/**
 * Applies an App Store Server Notification v2 to the stored record fields.
 * Returns the $set to apply (null = nothing to change).
 */
const applyNotification = ({ notificationType, subtype }, tx, renewal, now = Date.now()) => {
    switch (notificationType) {
        case 'SUBSCRIBED':
        case 'DID_RENEW':
        case 'OFFER_REDEEMED':
        case 'DID_CHANGE_RENEWAL_PREF':
        case 'RENEWAL_EXTENDED':
        case 'REFUND_REVERSED':
            if (!tx) return null;
            return {
                status: statusOf(tx, now),
                currentPeriodEnd: tx.expiresDate ? new Date(Number(tx.expiresDate)) : undefined,
                orderId: tx.transactionId ? String(tx.transactionId) : undefined,
                subscriptionId: tx.productId,
                ...(renewal ? { cancelAtPeriodEnd: Number(renewal.autoRenewStatus) === 0 } : {})
            };
        case 'DID_CHANGE_RENEWAL_STATUS':
            return renewal ? { cancelAtPeriodEnd: Number(renewal.autoRenewStatus) === 0 } : null;
        case 'DID_FAIL_TO_RENEW':
            // Grace period: keep access until it ends; otherwise billing retry without access.
            if (subtype === 'GRACE_PERIOD' && renewal?.gracePeriodExpiresDate) {
                return { status: 'active', currentPeriodEnd: new Date(Number(renewal.gracePeriodExpiresDate)) };
            }
            return { status: 'billing_retry' };
        case 'EXPIRED':
        case 'GRACE_PERIOD_EXPIRED':
            return { status: 'expired', cancelAtPeriodEnd: true };
        case 'REFUND':
        case 'REVOKE':
            return {
                status: notificationType === 'REFUND' ? 'refunded' : 'revoked',
                currentPeriodEnd: tx?.revocationDate ? new Date(Number(tx.revocationDate)) : new Date(now)
            };
        default:
            return null;
    }
};

/** Drops undefined values (so $set never unsets fields). */
const compact = (object) => Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== undefined));

module.exports = {
    PROVIDER,
    AUTO_RENEWABLE,
    parseProductPlans,
    planForProduct,
    recordKey,
    statusOf,
    buildSubscriptionUpdate,
    applyNotification,
    compact
};
