const express = require('express');
const router = express.Router();

const InterestController = require('../controllers/interest.controller');

/**
 * @swagger
 * /api/master/interest:
 *   get:
 *     summary: Get interests (conversation topics)
 *     tags:
 *       - Master Data
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
router.get('/interest', InterestController.getInterests);

module.exports = router;