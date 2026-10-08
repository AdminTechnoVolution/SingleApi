const express = require('express');
const router = express.Router();
const { subscriptionSchema } = require('../validators/subscription.validator');
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
router.post('/stripe/checkout', validateToken, SubscriptionController.createCheckoutSession);
router.post('/stripe/portal', validateToken, SubscriptionController.createPortalSession);

module.exports = router;
