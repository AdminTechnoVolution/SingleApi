const express = require('express');
const router = express.Router();
const { quickMessageSchema } = require('../validators/quickMessage.validator');
const validateBody = require('../../shared/middlewares/validateBody');
const validateToken = require('../../shared/middlewares/validateToken');
const QuickMessageController = require('../controllers/quickMessage.controller');

/**
 * @swagger
 * /api/actions/quick-message:
 *   post:
 *     summary: Send a quick message (premium only). Also counts as a like.
 *     description: >
 *       Fails with ERROR_PREMIUM_REQUIRED without an active subscription,
 *       ERROR_ALREADY_MATCHED if the users already share a match, and
 *       ERROR_QUICK_MESSAGE_ALREADY_SENT if one was already sent to this user.
 *       Returns { isMatch, chatId? } like /like.
 *     tags:
 *       - Likes & Dislikes
 *     security:
 *       - Bearer: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/QuickMessageSchema'
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 */
router.post('/quick-message', validateToken, validateBody(quickMessageSchema), QuickMessageController.sendQuickMessage);

/**
 * @swagger
 * /api/actions/quick-messages/received:
 *   get:
 *     summary: Quick messages received. Content is only returned to premium users (locked otherwise).
 *     tags:
 *       - Likes & Dislikes
 *     security:
 *       - Bearer: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 */
router.get('/quick-messages/received', validateToken, QuickMessageController.quickMessagesReceived);

module.exports = router;
