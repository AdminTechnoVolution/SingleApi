const express = require('express');
const router = express.Router();
const validateBody = require('../../shared/middlewares/validateBody');
const validateToken = require('../../shared/middlewares/validateToken');
const { blindDateCreateSchema, blindDateMatchIntentSchema } = require('../validators/blindDate.validator');
const BlindDateController = require('../controllers/blindDate.controller');

/**
 * @swagger
 * /api/blind-dates:
 *   post:
 *     tags: [Blind dates]
 *     summary: Create a blind-date room (Premium). One live room per user.
 *     requestBody:
 *       content: { application/json: { schema: { $ref: '#/components/schemas/BlindDateCreateSchema' } } }
 *     responses:
 *       200: { description: "Room created (role host, status open)" }
 *       400: { description: "ERROR_PREMIUM_REQUIRED | ERROR_BLIND_DATE_BUSY | ERROR_BLIND_DATE_DAILY_LIMIT" }
 *   get:
 *     tags: [Blind dates]
 *     summary: Open rooms I am compatible with (host first name + conditions only).
 */
router.post('/blind-dates', validateToken, validateBody(blindDateCreateSchema), BlindDateController.createRoom);
router.get('/blind-dates', validateToken, BlindDateController.listRooms);

/**
 * @swagger
 * /api/blind-dates/mine:
 *   get:
 *     tags: [Blind dates]
 *     summary: My live room (as host or guest), or null. Used to restore the UI.
 * /api/blind-dates/turn-credentials:
 *   get:
 *     tags: [Blind dates]
 *     summary: Short-lived ICE servers (STUN/TURN) for the WebRTC voice call.
 */
router.get('/blind-dates/mine', validateToken, BlindDateController.myRoom);
router.get('/blind-dates/turn-credentials', validateToken, BlindDateController.turnCredentials);

/**
 * @swagger
 * /api/blind-dates/{id}/join:
 *   post:
 *     tags: [Blind dates]
 *     summary: Claim the room atomically. Exactly one guest wins; others get ERROR_BLIND_DATE_TAKEN.
 * /api/blind-dates/{id}/leave:
 *   post:
 *     tags: [Blind dates]
 *     summary: Cancel (host, open), give up (guest before call → room reopens) or hang up.
 * /api/blind-dates/{id}/match:
 *   post:
 *     tags: [Blind dates]
 *     summary: Post-call answer. When both want it, a match + chat is created.
 *     requestBody:
 *       content: { application/json: { schema: { $ref: '#/components/schemas/BlindDateMatchIntentSchema' } } }
 */
router.post('/blind-dates/:id/join', validateToken, BlindDateController.joinRoom);
router.post('/blind-dates/:id/leave', validateToken, BlindDateController.leaveRoom);
router.post('/blind-dates/:id/match', validateToken, validateBody(blindDateMatchIntentSchema), BlindDateController.matchIntent);

module.exports = router;
