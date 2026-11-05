const express = require('express');
const router = express.Router();
const { subscriptionSchema, stripeCheckoutSchema, dlocalGoCheckoutSchema, dlocalGoConfirmSchema } = require('../validators/subscription.validator');
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

module.exports = router;
