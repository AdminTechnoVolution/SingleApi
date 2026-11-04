const ObjectId = require("mongoose").Types.ObjectId;
const SubscriptionRepository = require('../repository/subscription.repository');

/**
 * Returns the user's currently active subscription (Google Play window or
 * Stripe), or null. Single source of truth for premium-gated features.
 */
const findActiveSubscription = async (userId) => {
    const now = new Date();
    const filter = {
        userId: new ObjectId(userId),
        'paymentInfo.fromDate': { $lte: now },
        'paymentInfo.toDate': { $gte: now }
    };
    const subscription = await SubscriptionRepository.findByFilter(filter);
    if (subscription) return subscription;
    return await SubscriptionRepository.findActiveStripeForUser(new ObjectId(userId));
};

const isPremium = async (userId) => Boolean(await findActiveSubscription(userId));

module.exports = { findActiveSubscription, isPremium };
