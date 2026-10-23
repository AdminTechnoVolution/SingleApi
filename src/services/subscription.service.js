const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const c = require('../../shared/util/constants.frontcodes');
const jwtUtil = require('../../shared/util/jwt');
const googlePayClient = require('../client/googlePay.client');
const SubscriptionRepository = require('../repository/subscription.repository');
const Subscription = require('../models/subscription.model');
const UserRepository = require('../repository/user.repository');
let stripe;

const getStripe = () => {
    if (!process.env.STRIPE_SECRET_KEY) throw new BusinessException('STRIPE_NOT_CONFIGURED', 503);
    stripe ||= require('stripe')(process.env.STRIPE_SECRET_KEY);
    return stripe;
};

const createSubscription = async (req) => {
    let token = req.headers['authorization'];
    let subscriptionDB;
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');
    let body = req.body;

    const { purchaseToken, subscriptionId, packageName } = body;
    await validateUniquePurchaseToken(purchaseToken);

    const responseSubscription = await googlePayClient.verifySubscription(req, purchaseToken, subscriptionId, packageName);
    if (!responseSubscription) {
        const message = c.CODE_GOOGLE_SUBSCRIPTION_INVALID;
        return new BaseResponse(false, [message]);
    } else {
        const subscription = new Subscription({
            userId: userId,
            provider: 'google_play',
            subscriptionId: body.subscriptionId,
            packageName: body.packageName,
            purchaseToken: body.purchaseToken,
            offerToken: body.offerToken,
            orderId: responseSubscription.orderId,
            paymentInfo: {
                fromDate: new Date(parseInt(responseSubscription.startTimeMillis)),
                toDate: new Date(parseInt(responseSubscription.expiryTimeMillis)),
                priceAmountMicros: parseInt(responseSubscription.priceAmountMicros),
                priceCurrencyCode: responseSubscription.priceCurrencyCode,
                countryCode: responseSubscription.countryCode,
                paymentState: responseSubscription.paymentState,
                cancelReason: responseSubscription.cancelReason,
                acknowledgementState: responseSubscription.acknowledgementState
            }
        });

        subscriptionDB = await SubscriptionRepository.save(subscription);
        subscriptionDB._id = undefined;
        subscriptionDB.userId = undefined;
        subscriptionDB.purchaseToken = undefined;
    }

    message = c.CODE_SUCCESS;
    return new BaseResponse(true, null, subscriptionDB);
};

const getEntitlement = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers.authorization, 'id');
    const now = new Date();
    let subscription = await SubscriptionRepository.findByFilter({
        userId,
        'paymentInfo.fromDate': { $lte: now },
        'paymentInfo.toDate': { $gte: now }
    });
    if (subscription && !googlePayClient.isActiveSubscriptionV2(subscription)) subscription = null;
    if (!subscription) subscription = await SubscriptionRepository.findActiveStripeForUser(userId);
    return new BaseResponse(true, [], {
        premium: Boolean(subscription),
        provider: subscription?.provider || null,
        renewsAt: subscription?.currentPeriodEnd || subscription?.paymentInfo?.toDate || null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || false
    });
};

const createCheckoutSession = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers.authorization, 'id');
    const user = await UserRepository.findById(userId);
    if (!user) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND, 404);
    const checkout = await getStripe().checkout.sessions.create({
        mode: 'subscription',
        customer_email: user.email,
        client_reference_id: userId,
        line_items: [{ price: process.env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
        success_url: process.env.STRIPE_SUCCESS_URL,
        cancel_url: process.env.STRIPE_CANCEL_URL,
        metadata: { userId },
        subscription_data: { metadata: { userId } }
    });
    return new BaseResponse(true, [], { url: checkout.url });
};

const createPortalSession = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers.authorization, 'id');
    const subscription = await SubscriptionRepository.findByFilter({ userId, provider: 'stripe' });
    if (!subscription?.externalCustomerId) throw new BusinessException(c.CODE_ERROR_SUBSCRIPTION_NOTFOUND, 404);
    const portal = await getStripe().billingPortal.sessions.create({
        customer: subscription.externalCustomerId,
        return_url: process.env.STRIPE_PORTAL_RETURN_URL
    });
    return new BaseResponse(true, [], { url: portal.url });
};

const processStripeWebhook = async (req) => {
    const event = getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    if (!event.type.startsWith('customer.subscription.')) return;
    const item = event.data.object;
    const userId = item.metadata?.userId;
    if (!userId) return;
    await SubscriptionRepository.findOneAndUpdate(
        { externalSubscriptionId: item.id },
        {
            $set: {
                userId,
                provider: 'stripe',
                subscriptionId: item.id,
                packageName: 'stripe',
                purchaseToken: `stripe:${item.id}`,
                offerToken: item.items?.data?.[0]?.price?.id || 'stripe',
                orderId: String(item.latest_invoice || item.id),
                externalSubscriptionId: item.id,
                externalCustomerId: String(item.customer),
                status: item.status,
                currentPeriodStart: new Date(item.current_period_start * 1000),
                currentPeriodEnd: new Date(item.current_period_end * 1000),
                cancelAtPeriodEnd: Boolean(item.cancel_at_period_end),
                updated_at: new Date()
            }
        }
    );
};

const validateUniquePurchaseToken = async (purchaseToken) => {
    const filter = { purchaseToken: purchaseToken };
    const existingSubscription = await SubscriptionRepository.findByFilter(filter);

    if (existingSubscription) {
        const message = c.CODE_GOOGLE_SUBSCRIPTION_EXISTS;
        throw new BusinessException(message);
    }
};

module.exports = { createSubscription, getEntitlement, createCheckoutSession, createPortalSession, processStripeWebhook };
