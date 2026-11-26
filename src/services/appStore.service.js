const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const ObjectId = require('mongoose').Types.ObjectId;
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const c = require('../../shared/util/constants.frontcodes');
const jwtUtil = require('../../shared/util/jwt');
const Rules = require('./appStore.rules');

const defaultDeps = () => ({
    client: require('../client/appStore.client'),
    Subscription: require('../models/subscription.model'),
    env: process.env,
    now: () => Date.now()
});

const entitlementOf = (record, now) => {
    const active = Boolean(record) && ['active', 'trialing'].includes(record.status) && new Date(record.currentPeriodEnd).getTime() > now;
    return {
        premium: active,
        provider: Rules.PROVIDER,
        plan: record?.offerToken || null,
        productId: record?.subscriptionId || null,
        status: record?.status || null,
        expiresAt: record?.currentPeriodEnd || null,
        renewsAt: active && !record.cancelAtPeriodEnd ? record.currentPeriodEnd : null,
        cancelAtPeriodEnd: record?.cancelAtPeriodEnd || false,
        originalTransactionId: record?.originalTransactionId || null,
        environment: record?.environment || null
    };
};

/**
 * POST /api/subscription/apple/verify { signedTransaction }
 * The app sends Transaction.jwsRepresentation after a purchase, a renewal it observes
 * (Transaction.updates) or a restore. The JWS is verified (Apple chain + signature),
 * the productId mapped to a plan, and the subscription stored for the caller.
 * One originalTransactionId belongs to one account (409 otherwise).
 */
const verifyPurchase = async (req, deps = defaultDeps()) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers['authorization'], 'id');
    const now = deps.now();
    let tx;
    try {
        tx = await deps.client.verifyTransaction(req.body.signedTransaction);
    } catch (err) {
        throw new BusinessException(c.CODE_ERROR_APPLE_TRANSACTION_INVALID);
    }
    if (!tx?.originalTransactionId || tx.type !== Rules.AUTO_RENEWABLE) throw new BusinessException(c.CODE_ERROR_APPLE_TRANSACTION_INVALID);

    const plan = Rules.planForProduct(tx.productId, deps.env);
    if (!plan) throw new BusinessException(c.CODE_ERROR_APPLE_PRODUCT_UNKNOWN);

    const key = Rules.recordKey(tx.originalTransactionId);
    const existing = await deps.Subscription.findOne({ externalSubscriptionId: key }).lean();
    if (existing && String(existing.userId) !== String(userId)) {
        logger.error(`App Store transaction ${tx.originalTransactionId} already linked to another account (caller ${userId})`, { className: filename });
        throw new BusinessException(c.CODE_ERROR_APPLE_TRANSACTION_OWNED, 409);
    }

    const update = Rules.buildSubscriptionUpdate(tx, { userId: new ObjectId(userId), plan, now });
    // Replayed older transaction: never shorten a period we already know about (revocations always apply).
    if (existing && update.status !== 'revoked' && existing.currentPeriodEnd && new Date(existing.currentPeriodEnd) > update.currentPeriodEnd) {
        return new BaseResponse(true, [c.CODE_SUCCESS], entitlementOf(existing, now));
    }

    const record = await deps.Subscription.findOneAndUpdate(
        { externalSubscriptionId: key },
        { $set: Rules.compact(update), $setOnInsert: { created_at: new Date(now) } },
        { new: true, upsert: true, setDefaultsOnInsert: true }).lean();
    logger.info(`App Store subscription ${tx.originalTransactionId} (${tx.productId}, ${tx.environment}) → ${update.status} for user ${userId}`, { className: filename, req });
    return new BaseResponse(true, [c.CODE_SUCCESS], entitlementOf(record, now));
};

/**
 * POST /api/subscription/apple/notifications { signedPayload } — App Store Server Notifications v2.
 * Updates subscriptions already linked through /apple/verify (renew, expire, refund, revoke,
 * auto-renew changes). Unknown transactions are acknowledged and ignored.
 * Returns { handled } ; throws only when the signature is invalid.
 */
const processNotification = async (req, deps = defaultDeps()) => {
    const now = deps.now();
    let notification;
    try {
        notification = await deps.client.verifyNotification(req.body?.signedPayload);
    } catch (err) {
        throw new BusinessException(c.CODE_ERROR_APPLE_TRANSACTION_INVALID);
    }
    const { notificationType, subtype, notificationUUID, data } = notification || {};
    if (notificationType === 'TEST') return { handled: false, notificationType };

    const tx = data?.signedTransactionInfo ? await deps.client.verifyTransaction(data.signedTransactionInfo) : null;
    const renewal = data?.signedRenewalInfo ? await deps.client.verifyRenewalInfo(data.signedRenewalInfo) : null;
    const originalTransactionId = tx?.originalTransactionId || renewal?.originalTransactionId;
    if (!originalTransactionId) return { handled: false, notificationType };

    const changes = Rules.applyNotification({ notificationType, subtype }, tx, renewal, now);
    if (!changes) return { handled: false, notificationType };

    const updated = await deps.Subscription.findOneAndUpdate(
        { externalSubscriptionId: Rules.recordKey(originalTransactionId) },
        { $set: Rules.compact({ ...changes, updated_at: new Date(now) }) },
        { new: true }).lean();
    logger.info(`App Store notification ${notificationType}/${subtype || '-'} (${notificationUUID}) for ${originalTransactionId}: ${updated ? 'applied' : 'unknown subscription'}`, { className: filename });
    return { handled: Boolean(updated), notificationType };
};

module.exports = { verifyPurchase, processNotification, entitlementOf };
