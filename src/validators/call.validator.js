const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');

/**
 * @swagger
 * components:
 *   schemas:
 *     CallStartSchema:
 *       type: object
 *       required: [chatId, kind]
 *       properties:
 *         chatId: { type: string, description: "Chat (= match) id" }
 *         kind: { type: string, enum: [audio, video] }
 */
const callStartSchema = Joi.object({
    chatId: Joi.string().trim().hex().length(24).required(),
    kind: Joi.string().valid('audio', 'video').required()
}).messages({ 'any.required': c.CODE_MALFORMED_BAD_REQUEST, 'any.only': c.CODE_MALFORMED_BAD_REQUEST, 'string.length': c.CODE_MALFORMED_BAD_REQUEST, 'string.hex': c.CODE_MALFORMED_BAD_REQUEST });

module.exports = { callStartSchema };
