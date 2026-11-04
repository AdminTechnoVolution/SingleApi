const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');

const idList = Joi.array().items(Joi.string().trim().max(64)).max(10).default([]);

/**
 * @swagger
 * components:
 *   schemas:
 *     BlindDateCreateSchema:
 *       type: object
 *       properties:
 *         conditions:
 *           type: object
 *           properties:
 *             genders: { type: array, items: { type: string }, description: "Gender ids (empty = any)" }
 *             ageMin: { type: integer, minimum: 18, maximum: 99, example: 25 }
 *             ageMax: { type: integer, minimum: 18, maximum: 99, example: 35 }
 *             languages: { type: array, items: { type: string } }
 *             musicGenres: { type: array, items: { type: string } }
 *             lookingFor: { type: array, items: { type: string } }
 *     BlindDateMatchIntentSchema:
 *       type: object
 *       required: [wantsMatch]
 *       properties:
 *         wantsMatch: { type: boolean }
 */
const blindDateCreateSchema = Joi.object({
    conditions: Joi.object({
        genders: idList,
        ageMin: Joi.number().integer().min(18).max(99).default(18),
        ageMax: Joi.number().integer().min(18).max(99).default(99),
        languages: idList,
        musicGenres: idList,
        lookingFor: idList
    }).default({})
}).messages({ 'any.invalid': c.CODE_MALFORMED_BAD_REQUEST });

const blindDateMatchIntentSchema = Joi.object({
    wantsMatch: Joi.boolean().required().messages({ 'any.required': c.CODE_MALFORMED_BAD_REQUEST })
});

module.exports = { blindDateCreateSchema, blindDateMatchIntentSchema };
