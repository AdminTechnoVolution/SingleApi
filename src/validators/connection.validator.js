const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');

/**
 * @swagger
 * components:
 *   schemas:
 *     NextLevelWishSchema:
 *       type: object
 *       required:
 *         - wants
 *       properties:
 *         wants:
 *           type: boolean
 *           example: true
 */
const nextLevelWishSchema = Joi.object({
    wants: Joi.boolean().strict().required()
        .messages({ 'any.required': c.CODE_MALFORMED_BAD_REQUEST, 'boolean.base': c.CODE_MALFORMED_BAD_REQUEST })
});

module.exports = { nextLevelWishSchema };
