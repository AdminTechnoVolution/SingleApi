const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');

/**
 * @swagger
 * components:
 *   schemas:
 *     SubscriptionSchema:
 *       type: object
 *       required:
 *         - subscriptionId
 *         - packageName
 *         - purchaseToken
 *       properties:
 *         subscriptionId: 
 *           type: string
 *           example: premium_monthly
 *           description: Identifier of the subscription product.
 *         packageName:
 *           type: string
 *           example: com.app.subscription.premium
 *           description: Application package name.
 *         purchaseToken:
 *           type: string
 *           example: ya29.a0AfH6SMB...
 *           description: Purchase token provided by the app store.
 *         offerToken:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *           description: Offer token provided by the app store.
 * 
 */
const subscriptionSchema = Joi.object({
    subscriptionId: Joi.string().required()
        .messages({
            'any.required': c.CODE_SUBSCRIPTIONID_REQUIRED,
            'string.empty': c.CODE_SUBSCRIPTIONID_REQUIRED
        }),
    packageName: Joi.string().required()
        .messages({
            'any.required': c.CODE_PKGNAME_REQUIRED,
            'string.empty': c.CODE_PKGNAME_REQUIRED
        }),
    purchaseToken: Joi.string().required()
        .messages({
            'any.required': c.CODE_PURCHASETOKEN_REQUIRED,
            'string.empty': c.CODE_PURCHASETOKEN_REQUIRED
        }),
    offerToken: Joi.string().required()
        .messages({
            'any.required': c.CODE_OFFERTOKEN_REQUIRED,
            'string.empty': c.CODE_OFFERTOKEN_REQUIRED
        }),
});

const stripeCheckoutSchema = Joi.object({
    plan: Joi.string().valid('weekly', 'monthly', 'quarterly').required()
});

module.exports = {
    subscriptionSchema,
    stripeCheckoutSchema
};
