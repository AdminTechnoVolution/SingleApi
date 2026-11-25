const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');

/**
 * @swagger
 * components:
 *   schemas:
 *     LikesSchema:
 *       type: object
 *       required:
 *         - toUserId
 *       properties:
 *         toUserId:
 *           type: string
 *           example: 68c490865d8254ec33d4fb5f
 * 
 */
const likesSchema = Joi.object({
    toUserId: Joi.string().required()
        .messages({
            'any.required': c.CODE_TO_USERID_REQUIRED,
            'string.empty': c.CODE_TO_USERID_REQUIRED
        }),
    // Kultura: feed intent of the profile being greeted (optional; absent = legacy dating like).
    intent: Joi.string().valid(...Object.values(require('../enums/EnumIntent'))).optional()
        .messages({ 'any.only': c.CODE_INTENT_INVALID })
});

module.exports = {
    likesSchema
};
