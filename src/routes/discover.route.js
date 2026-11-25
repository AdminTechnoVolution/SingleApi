const express = require('express');
const router = express.Router();
const validateToken = require('../../shared/middlewares/validateToken');
const DiscoverController = require('../controllers/discover.controller');

/**
 * @swagger
 * /api/user/discover:
 *   get:
 *     summary: Get users to discover
 *     tags:
 *       - Discover
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
 *       - in: query
 *         name: cursor
 *         required: false
 *         example: 60d21b4667d0d8992e610c85
 *         schema:
 *           type: string
 *         description: Cursor for pagination
 *       - in: query
 *         name: intent
 *         required: false
 *         schema:
 *           type: string
 *           enum: [friends, language_exchange, dating]
 *         description: >
 *           Kultura feed. Absent + header X-App-Platform ios → language_exchange.
 *           Absent otherwise → legacy dating feed (unchanged). dating requires profileConfig.openToDating.
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
 *       500:
 *         description: Internal Server Error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 */
router.get('/discover', validateToken, DiscoverController.getUsersDiscover);

module.exports = router;