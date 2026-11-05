const express = require('express');
const router = express.Router();
const validateBody = require('../../shared/middlewares/validateBody');
const validateToken = require('../../shared/middlewares/validateToken');
const { callStartSchema } = require('../validators/call.validator');
const CallController = require('../controllers/call.controller');

/**
 * @swagger
 * /api/calls:
 *   post:
 *     tags: [Calls]
 *     summary: Call a match (voice or video). Only Premium users can start calls; anyone can answer.
 *     description: Rings the other user (socket call:incoming + high-priority push). Signaling on /ws/calls.
 *     requestBody:
 *       content: { application/json: { schema: { $ref: '#/components/schemas/CallStartSchema' } } }
 *     responses:
 *       200: { description: "{ call, iceServers }" }
 *       400: { description: "ERROR_PREMIUM_REQUIRED | ERROR_CALL_NOT_ALLOWED | ERROR_CALL_BUSY" }
 * /api/calls/{id}:
 *   get:
 *     tags: [Calls]
 *     summary: Current state of a call (+ ICE servers while it is ringing/accepted).
 * /api/calls/{id}/accept:
 *   post:
 *     tags: [Calls]
 *     summary: Callee answers. ERROR_CALL_ENDED if it was cancelled, missed or answered elsewhere.
 * /api/calls/{id}/decline:
 *   post: { tags: [Calls], summary: Callee rejects a ringing call. }
 * /api/calls/{id}/cancel:
 *   post: { tags: [Calls], summary: Caller gives up before it is answered. }
 * /api/calls/{id}/end:
 *   post: { tags: [Calls], summary: Hang up (works in any phase; idempotent). }
 */
router.post('/calls', validateToken, validateBody(callStartSchema), CallController.startCall);
router.get('/calls/:id', validateToken, CallController.getCall);
router.post('/calls/:id/accept', validateToken, CallController.acceptCall);
router.post('/calls/:id/decline', validateToken, CallController.declineCall);
router.post('/calls/:id/cancel', validateToken, CallController.cancelCall);
router.post('/calls/:id/end', validateToken, CallController.endCall);

module.exports = router;
