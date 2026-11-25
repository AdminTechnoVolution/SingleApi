const express = require('express');
const router = express.Router();
const { subscriptionSchema, stripeCheckoutSchema, dlocalGoCheckoutSchema, dlocalGoConfirmSchema, appleVerifySchema } = require('../validators/subscription.validator');
const validateBody = require('../../shared/middlewares/validateBody');
const validateToken = require('../../shared/middlewares/validateToken');
const SubscriptionController = require('../controllers/subscription.controller');

/**
 * @swagger
 * /api/subscription/create-subscription:
 *   post:
 *     summary: Create subscription and validate it in Google Play API
 *     tags:
 *       - Subscription
 *     security:
 *       - Bearer: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization token
 *         example: Bearer eyJhbGciOi
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/SubscriptionSchema'
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 *       400:
 *         description: Bad Request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 *       500:
 *         description: Internal Server Error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 */
router.post('/create-subscription', validateToken, validateBody(subscriptionSchema), SubscriptionController.createSubscription);
router.get('/entitlement', validateToken, SubscriptionController.getEntitlement);
router.get('/stripe/plans', validateToken, SubscriptionController.getStripePlans);
router.post('/stripe/checkout', validateToken, validateBody(stripeCheckoutSchema), SubscriptionController.createCheckoutSession);
router.post('/stripe/portal', validateToken, SubscriptionController.createPortalSession);

/**
 * @swagger
 * /api/subscription/dlocalgo/plans:
 *   get:
 *     summary: dLocal Go Premium plans (weekly, monthly, quarterly) with their price.
 *     tags: [Subscription]
 * /api/subscription/dlocalgo/checkout:
 *   post:
 *     summary: Returns the dLocal Go subscribe URL for a plan, tagged with a signed external_id.
 *     tags: [Subscription]
 * /api/subscription/dlocalgo/confirm:
 *   post:
 *     summary: Links the subscription created at checkout (external_id from the success_url) to the user.
 *     tags: [Subscription]
 * /api/subscription/dlocalgo/cancel:
 *   post:
 *     summary: Cancels the dLocal Go subscription; Premium stays active until the paid period ends.
 *     tags: [Subscription]
 */
router.get('/dlocalgo/plans', validateToken, SubscriptionController.getDlocalGoPlans);
router.post('/dlocalgo/checkout', validateToken, validateBody(dlocalGoCheckoutSchema), SubscriptionController.createDlocalGoCheckout);
router.post('/dlocalgo/confirm', validateToken, validateBody(dlocalGoConfirmSchema), SubscriptionController.confirmDlocalGoCheckout);
router.post('/dlocalgo/cancel', validateToken, SubscriptionController.cancelDlocalGoSubscription);

/**
 * @swagger
 * /api/subscription/apple/verify:
 *   post:
 *     summary: Verify a StoreKit 2 signed transaction (JWS) and activate Premium (provider app_store)
 *     tags:
 *       - Subscription
 *     security:
 *       - Bearer: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signedTransaction]
 *             properties:
 *               signedTransaction:
 *                 type: string
 *                 description: Transaction.jwsRepresentation
 *     responses:
 *       200:
 *         description: Entitlement { premium, provider, plan, productId, status, expiresAt, renewsAt, cancelAtPeriodEnd, originalTransactionId, environment }
 *       400:
 *         description: ERROR_APPLE_TRANSACTION_INVALID | ERROR_APPLE_PRODUCT_UNKNOWN
 *       409:
 *         description: ERROR_APPLE_TRANSACTION_OWNED
 * /api/subscription/apple/notifications:
 *   post:
 *     summary: App Store Server Notifications v2 endpoint (called by Apple)
 *     tags:
 *       - Subscription
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               signedPayload:
 *                 type: string
 *     responses:
 *       200:
 *         description: Received
 */
router.post('/apple/verify', validateToken, validateBody(appleVerifySchema), SubscriptionController.verifyAppleTransaction);
router.post('/apple/notifications', SubscriptionController.appleNotification);

module.exports = router;
