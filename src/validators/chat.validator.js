const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');

/**
 * @swagger
 * components:
 *   schemas:
 *     ChatUpdateMessageSchema:
 *       type: object
 *       required:
 *         - conversationId
 *         - chatId
 *         - content
 *       properties:
 *         conversationId:
 *           type: string
 *           example: 12c490865d8254ec44d4fb5f
 *         chatId:
 *           type: string
 *           example: 68c490865d8254ec33d4fb5f
 *         content:
 *           type: string
 *           example: Hola, ¿cómo estás?
 * 
 */
const chatUpdateMessageSchema = Joi.object({
    conversationId: Joi.string().required()
        .messages({
            'any.required': c.CODE_CONVERSATIONID_REQUIRED,
            'string.empty': c.CODE_CONVERSATIONID_REQUIRED
        }),
    chatId: Joi.string().required()
        .messages({
            'any.required': c.CODE_CHATID_REQUIRED,
            'string.empty': c.CODE_CHATID_REQUIRED
        }),
    content: Joi.string().required()
        .messages({
            'any.required': c.CODE_CONTENT_REQUIRED,
            'string.empty': c.CODE_CONTENT_REQUIRED
        })
});

/**
 * @swagger
 * components:
 *   schemas:
 *     ChatSendMessageSchema:
 *       type: object
 *       required:
 *         - chatId
 *         - content
 *       properties:
 *         chatId:
 *           type: string
 *           example: 68c490865d8254ec33d4fb5f
 *         content:
 *           type: string
 *           example: Hola, ¿cómo estás?
 *         messageId:
 *           type: string
 *           example: 68c490865d8254ec33d4fb5f

 * 
 */
const chatSendMessageSchema = Joi.object({
    chatId: Joi.string().required()
        .messages({
            'any.required': c.CODE_CHATID_REQUIRED,
            'string.empty': c.CODE_CHATID_REQUIRED
        }),
    content: Joi.string().required()
        .messages({
            'any.required': c.CODE_CONTENT_REQUIRED,
            'string.empty': c.CODE_CONTENT_REQUIRED
        }),
    messageId: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_MESSAGEID_REQUIRED,
        })
});

/** sendNudge payload: only the chat; content is fixed server side. */
const chatSendNudgeSchema = Joi.object({
    chatId: Joi.string().required()
        .messages({
            'any.required': c.CODE_CHATID_REQUIRED,
            'string.empty': c.CODE_CHATID_REQUIRED
        })
});

/**
 * @swagger
 * components:
 *   schemas:
 *     OpenChatSchema:
 *       type: object
 *       required:
 *         - chatId
 *       properties:
 *         chatId:
 *           type: string
 *           example: 68c490865d8254ec33d4fb5f
 * 
 */
const openChatSchema = Joi.object({
    chatId: Joi.string().required()
        .messages({
            'any.required': c.CODE_CHATID_REQUIRED,
            'string.empty': c.CODE_CHATID_REQUIRED
        })
});

module.exports = {
    chatUpdateMessageSchema,
    chatSendMessageSchema,
    chatSendNudgeSchema,
    openChatSchema
};
