const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const ClientException = require('../../shared/exceptionHandler/ClientException');
const EnumCancelReason = require('../enums/EnumCancelReason');
const EnumPaymentState = require('../enums/EnumPaymentState');
const google = require('googleapis').google;
const { OAuth2Client } = require('google-auth-library');
const c = require('../../shared/util/constants.frontcodes');
const googleServiceAccountBase64 = process.env.GOOGLE_SERVICE_ACCOUNT;
const googleServiceAccountBase64Decoded = Buffer.from(googleServiceAccountBase64, "base64").toString("utf8");
const googleServiceAccount = JSON.parse(googleServiceAccountBase64Decoded);
const googleServiceScopes = process.env.GOOGLE_SERVICE_SCOPES;

const googleClientIdBase64 = process.env.GOOGLE_CLIENT_ID;
const googleClientIdDecoded = Buffer.from(googleClientIdBase64, "base64").toString("utf8");
const googleClient = new OAuth2Client(googleClientIdDecoded);

async function verifySubscription(req, purchaseToken, subscriptionId, packageName) {
    try {
        logger.info({ message: `Verifying Google Purchase Subscription`, className: filename, req: req });

        const auth = new google.auth.GoogleAuth({
            credentials: googleServiceAccount,
            scopes: googleServiceScopes.split(',')
        });

        const client = await auth.getClient();

        const playDeveloper = google.androidpublisher({
            version: "v3",
            auth: client,
        });

        const purchaseResponse = await playDeveloper.purchases.subscriptions.get({
            packageName,
            subscriptionId,
            token: purchaseToken,
        });

        logger.info({ message: `Google Purchase Subscription. [HTTP Status]: ${purchaseResponse.status} ${purchaseResponse.statusText} [Response Body]: ${JSON.stringify(purchaseResponse.data)}`, className: filename, req: req });
        return purchaseResponse.data;
    } catch (error) {
        const purchaseResponse = error.response;
        logger.error({ message: `Google Purchase Subscription.[Error Message]: ${error.message} [HTTP Status]: ${purchaseResponse.status} ${purchaseResponse.statusText} [Response Body]: ${JSON.stringify(purchaseResponse.data)}`, className: filename, req: req });
        return undefined;
    }
}

function isActiveSubscription(purchase) {
    const now = Date.now();
    const expiry = Number(purchase.expiryTimeMillis);

    // Active if not expired and payment is valid
    const active = expiry > now &&
        [EnumPaymentState.RECEIVED.value, EnumPaymentState.FREE_TRIAL.value].includes(purchase.paymentState);

    // Also check if it's not canceled before expiry
    const notCanceled = purchase.cancelReason === undefined || purchase.cancelReason === null
        || purchase.cancelReason === EnumCancelReason.USER_CANCELED.value;

    return active && notCanceled;
}

function isActiveSubscriptionV2(subscriptionDB) {
    const now = new Date();
    const expiry = subscriptionDB.paymentInfo.toDate;

    const notExpired = expiry > now;

    const validPayment = [EnumPaymentState.RECEIVED.value, EnumPaymentState.FREE_TRIAL.value].includes(subscriptionDB.paymentInfo.paymentState);

    const isCancelled = subscriptionDB.paymentInfo.cancelReason !== undefined &&
        subscriptionDB.paymentInfo.cancelReason !== null;

    return notExpired && validPayment && !isCancelled;
}

async function loginGoogle(req, socialToken) {
    try {
        logger.info({ message: `Verifying Google Auth Client`, className: filename, req: req });

        const ticket = await googleClient.verifyIdToken({
            idToken: socialToken,
            audience: googleClientIdDecoded,
        });
        const payload = ticket.getPayload();

        logger.info({ message: `Google Auth Client Verified. ${JSON.stringify(payload)}`, className: filename, req: req });
        return {
            email: payload.email,
            socialId: payload.sub,
            name: payload.name,
            isVerified: payload.email_verified
        };
    } catch (error) {
        logger.error({ message: `Google Auth Client Error: ${error}`, className: filename, req: req });
        throw new ClientException(c.CODE_ERROR_SERVICE_UNAVAILABLE, 503);
    }
}

/** Stops a Google Play subscription from renewing (the paid period is kept). Throws on failure. */
async function cancelSubscription(purchaseToken, subscriptionId, packageName) {
    const auth = new google.auth.GoogleAuth({
        credentials: googleServiceAccount,
        scopes: googleServiceScopes.split(',')
    });
    const playDeveloper = google.androidpublisher({ version: "v3", auth: await auth.getClient() });
    await playDeveloper.purchases.subscriptions.cancel({ packageName, subscriptionId, token: purchaseToken });
}

module.exports = { verifySubscription, isActiveSubscription, isActiveSubscriptionV2, loginGoogle, cancelSubscription };
