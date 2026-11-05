const express = require('express');
const router = express.Router();
const ClientVersionService = require('../services/clientVersion.service');

/**
 * @swagger
 * /api/app/version-policy:
 *   get:
 *     summary: Update policy for the calling client (public)
 *     description: >
 *       Reads X-App-Version / X-App-Platform headers and the
 *       <PLATFORM>_MIN_VERSION_CODE / <PLATFORM>_LATEST_VERSION_CODE configs.
 *       Returns { platform, minVersionCode, latestVersionCode, updateRequired, updateAvailable }.
 *     tags:
 *       - App
 *     parameters:
 *       - in: header
 *         name: X-App-Version
 *         schema:
 *           type: integer
 *         example: 107
 *       - in: header
 *         name: X-App-Platform
 *         schema:
 *           type: string
 *         example: android
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 */
router.get('/app/version-policy', async (req, res, next) => {
    try {
        res.status(200).json(await ClientVersionService.getVersionPolicy(req));
    } catch (err) {
        next(err);
    }
});

module.exports = router;
