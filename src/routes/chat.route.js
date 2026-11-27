const express = require('express');
const router = express.Router();
const { chatSendMessageSchema } = require('../validators/chat.validator');
const validateBody = require('../../shared/middlewares/validateBody');
const validateToken = require('../../shared/middlewares/validateToken');
const ChatController = require('../controllers/chat.controller');
const uploadAudio = require('../../shared/config/multerAudioConfig');
const requestLogger = require('../../shared/middlewares/requestLogger');

/**
 * @swagger
 * /api/chats:
 *   get:
 *     summary: Get user chats
 *     tags:
 *       - Chats
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
router.get('/chats', validateToken, ChatController.getChats);

/**
 * @swagger
 * /api/chats/{chatId}/conversations:
 *   delete:
 *     summary: Delete the chat conversation or messages information for an specific user
 *     tags:
 *       - Chats
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
 *       - in: path
 *         name: chatId
 *         required: true
 *         example: 079d4159d15644e8b0104886
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
router.delete('/chats/:chatId/conversations', validateToken, ChatController.deleteChatConversation);

/**
 * @swagger
 * /api/chats/{chatId}/conversations:
 *   get:
 *     summary: Get chat conversation or messages information when a user open the chat
 *     tags:
 *       - Chats
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
 *       - in: path
 *         name: chatId
 *         required: true
 *         example: 079d4159d15644e8b0104886
 *       - in: query
 *         name: cursor
 *         required: false
 *         example: 60d21b4667d0d8992e610c85
 *         schema:
 *           type: string
 *         description: Cursor for pagination
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
router.get('/chats/:chatId/conversations', validateToken, ChatController.getChatConversations);

/**
 * @swagger
 * /api/chats/{chatId}/audio:
 *   post:
 *     summary: Upload a voice note (m4a, max 2 MB / 60 s). Returns { url, durationMs }; then send it with socket sendMessage type 'audio'.
 *     tags:
 *       - Chats
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *               durationMs:
 *                 type: integer
 *                 example: 4200
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 *       400:
 *         description: Bad Request (audio.required, audio.onlyAudio, LIMIT_FILE_SIZE, chat.notFound)
 */
router.post('/chats/:chatId/audio', validateToken, uploadAudio.single('audio'), requestLogger, ChatController.uploadChatAudio);

module.exports = router;