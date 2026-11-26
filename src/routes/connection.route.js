const express = require('express');
const router = express.Router();
const validateBody = require('../../shared/middlewares/validateBody');
const validateToken = require('../../shared/middlewares/validateToken');
const { nextLevelWishSchema } = require('../validators/connection.validator');
const ConnectionController = require('../controllers/connection.controller');

/**
 * @swagger
 * /api/connections/{chatId}/next-level:
 *   get:
 *     summary: Kultura "Next level" state of a connection (never reveals the other side's wish before unlock)
 *     tags:
 *       - Connections
 *     security:
 *       - Bearer: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: "{ chatId, eligible, iWant, unlocked, unlockedAt }"
 *       404:
 *         description: ERROR_CONNECTION_NOT_FOUND
 *   post:
 *     summary: Privately propose (wants=true) or withdraw (wants=false) "Next level"
 *     tags:
 *       - Connections
 *     security:
 *       - Bearer: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NextLevelWishSchema'
 *     responses:
 *       200:
 *         description: "{ chatId, eligible, iWant, unlocked, unlockedAt }"
 *       403:
 *         description: ERROR_NEXT_LEVEL_NOT_ELIGIBLE
 *       404:
 *         description: ERROR_CONNECTION_NOT_FOUND
 */
router.get('/connections/:chatId/next-level', validateToken, ConnectionController.getNextLevel);
router.post('/connections/:chatId/next-level', validateToken, validateBody(nextLevelWishSchema), ConnectionController.setNextLevel);

module.exports = router;
