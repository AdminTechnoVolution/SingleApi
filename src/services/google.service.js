const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const BaseResponse = require('../../shared/util/baseResponse');
const c = require('../../shared/util/constants.frontcodes');
const jwtUtil = require('../../shared/util/jwt');
const util = require('../../shared/util/util');
const googlePayClient = require('../client/googlePay.client');
const EnumSubscriptionNotification = require('../enums/EnumSubscriptionNotification');
const SubscriptionRepository = require('../repository/subscription.repository');
const UserProfileSyncService = require('./userProfileSync.service');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const DataLayerException = require('../../shared/exceptionHandler/DataLayerException');

const subscriptionNotification = async (req) => {
    const message = req.body.message;

    if (!message || !message.data) throw new BusinessException(c.CODE_MALFORMED_BAD_REQUEST);

    const payload = JSON.parse(Buffer.from(message.data, "base64").toString());
    const subscriptionNotification = payload.subscriptionNotification;

    if (!subscriptionNotification) return new BaseResponse(true, [c.CODE_GOOGLE_SUBSCRIPTION_NOT_PROCESSED]);

    const packageName = payload.packageName;
    const { subscriptionId, purchaseToken, notificationType } = subscriptionNotification;

    const enumObject = util.getEnumByValue(EnumSubscriptionNotification, notificationType, 'EnumSubscriptionNotification');
    logger.info({ message: `NotificationType: ${enumObject.key}: value: ${notificationType}, description: ${enumObject.description}`, className: filename, req: req });
    switch (notificationType) {
        case EnumSubscriptionNotification.SUBSCRIPTION_RECOVERED.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_RENEWED.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_RESTARTED.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_CANCELED.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_REVOKED.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_EXPIRED.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_DEFERRED.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_ON_HOLD.value:
        case EnumSubscriptionNotification.SUBSCRIPTION_IN_GRACE_PERIOD.value:
            await updateSubscription(req, subscriptionId, purchaseToken, packageName);
            break;
        default:
            logger.info({ message: `NotificationType DEFAULT CASE`, className: filename, req: req });
            //TODO: Remove this call later if not needed
            await googlePayClient.verifySubscription(req, purchaseToken, subscriptionId, packageName);
    }

    return new BaseResponse(true, [c.CODE_GOOGLE_SUBSCRIPTION_PROCESSED]);
};

const updateSubscription = async (req, subscriptionId, purchaseToken, packageName) => {
    const responseSubscription = await googlePayClient.verifySubscription(req, purchaseToken, subscriptionId, packageName);
    if (!responseSubscription) throw new BusinessException(c.CODE_GOOGLE_SUBSCRIPTION_INVALID);

    const filter = { purchaseToken };
    const existingSubscription = await SubscriptionRepository.findByFilter(filter);
    if (!existingSubscription) throw new BusinessException(c.CODE_ERROR_SUBSCRIPTION_NOTFOUND);

    try {
        existingSubscription.updated_at = new Date();
        existingSubscription.paymentInfo.fromDate = responseSubscription.startTimeMillis;
        existingSubscription.paymentInfo.toDate = responseSubscription.expiryTimeMillis;
        existingSubscription.paymentInfo.priceAmountMicros = responseSubscription.priceAmountMicros;
        existingSubscription.paymentInfo.priceCurrencyCode = responseSubscription.priceCurrencyCode;
        existingSubscription.paymentInfo.countryCode = responseSubscription.countryCode;
        existingSubscription.paymentInfo.paymentState = responseSubscription.paymentState;
        existingSubscription.paymentInfo.cancelReason = responseSubscription.cancelReason;
        existingSubscription.paymentInfo.acknowledgementState = responseSubscription.acknowledgementState;
        existingSubscription.orderId = responseSubscription.orderId;

        await existingSubscription.save();

        const hasActiveSubscription = googlePayClient.isActiveSubscriptionV2(existingSubscription.toObject());
        await UserProfileSyncService.syncUserPassportAndEffectiveLocationByUserId(existingSubscription.userId, hasActiveSubscription);
    } catch (error) {
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
}

module.exports = { subscriptionNotification };
