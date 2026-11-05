const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');

const QUICK_MESSAGE_MAX_LENGTH = 280;

/**
 * @swagger
 * components:
 *   schemas:
 *     QuickMessageSchema:
 *       type: object
 *       required:
 *         - toUserId
 *         - content
 *       properties:
 *         toUserId:
 *           type: string
 *           example: 68c490865d8254ec33d4fb5f
 *         content:
 *           type: string
 *           maxLength: 280
 *           example: "Your hiking photos are amazing — favourite trail?"
 */
const quickMessageSchema = Joi.object({
    toUserId: Joi.string().required()
        .messages({
            'any.required': c.CODE_TO_USERID_REQUIRED,
            'string.empty': c.CODE_TO_USERID_REQUIRED
        }),
    content: Joi.string().trim().min(1).max(QUICK_MESSAGE_MAX_LENGTH).required()
        .messages({
            'any.required': c.CODE_CONTENT_REQUIRED,
            'string.empty': c.CODE_CONTENT_REQUIRED,
            'string.min': c.CODE_CONTENT_REQUIRED,
            'string.max': c.CODE_CONTENT_MAX
        })
});

module.exports = { quickMessageSchema, QUICK_MESSAGE_MAX_LENGTH };
