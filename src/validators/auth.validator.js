const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');

/**
 * @swagger
 * components:
 *   schemas:
 *     RefreshTokenSchema:
 *       type: object
 *       required:
 *         - refreshToken
 *       properties:
 *         refreshToken:
 *           type: string
 *           example: eyJhbGciOi
*/
const refreshTokenSchema = Joi.object({
    refreshToken: Joi.string().trim().required()
        .messages({
            'any.required': c.CODE_REFRESH_TOKEN_REQUIRED,
            'string.empty': c.CODE_REFRESH_TOKEN_REQUIRED
        })
});

/**
 * @swagger
 * components:
 *   schemas:
 *     LogoutSchema:
 *       type: object
 *       required:
 *         - accessToken
 *         - refreshToken
 *       properties:
 *         accessToken:
 *           type: string
 *           example: eyJhbGciOiAcc
 *         refreshToken:
 *           type: string
 *           example: eyJhbGciOiRef
 *         fcmToken:
 *           type: string
 *           example: eyJhbGciOiFcm
*/
const logoutSchema = Joi.object({
    accessToken: Joi.string().trim().required()
        .messages({
            'any.required': c.CODE_REFRESH_TOKEN_REQUIRED,
            'string.empty': c.CODE_REFRESH_TOKEN_REQUIRED
        }),
    refreshToken: Joi.string().trim().required()
        .messages({
            'any.required': c.CODE_REFRESH_TOKEN_REQUIRED,
            'string.empty': c.CODE_REFRESH_TOKEN_REQUIRED
        }),
    fcmToken: Joi.string().allow('').optional()
        .messages({
            'any.required': c.CODE_FCM_TOKEN_REQUIRED,
            'string.empty': c.CODE_FCM_TOKEN_REQUIRED
        })
});

/**
 * @swagger
 * components:
 *   schemas:
 *     LoginSchema:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           example: johndoe@example.com
 *         password:
 *           type: string
 *           example: StrongPassword123
 *         socialToken:
 *           type: string
 *           example: 1234567890
 *         authMethod:
 *           type: string
 *           example: google/apple
 *         fcmToken:
 *           type: string
 *           example: eyJhbGciOi...
*/
const loginSchema = Joi.object({
    email: Joi.string().trim().max(256).email().required()
        .messages({
            'any.required': c.CODE_EMAIL_REQUIRED,
            'string.empty': c.CODE_EMAIL_REQUIRED,
            'string.max': c.CODE_EMAIL_MAX,
            'string.email': c.CODE_EMAIL_INVALID
        }),
    password: Joi.string().trim().max(256)
        .messages({
            'string.empty': c.CODE_PASSWORD_REQUIRED,
            'string.max': c.CODE_PASSWORD_MAX
        }),
    authMethod: Joi.string().max(256)
        .messages({
            'string.max': c.CODE_AUTH_METHOD_MAX
        }),
    socialToken: Joi.string().max(2048)
        .messages({
            'string.max': c.CODE_SOCIAL_TOKEN_MAX
        }),
    fcmToken: Joi.string().allow('').optional()
        .messages({
            'any.required': c.CODE_FCM_TOKEN_REQUIRED,
            'string.empty': c.CODE_FCM_TOKEN_REQUIRED
        })
}).xor('password', 'socialToken').messages({
    'object.missing': c.CODE_ONLY_PASSWORD_OR_SOCIAL_TOKEN,
    'object.xor': c.CODE_ONLY_PASSWORD_OR_SOCIAL_TOKEN
});

/**
 * @swagger
 * components:
 *   schemas:
 *     SendPasswordResetCodeSchema:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           example: johndoe@example.com
*/
const sendPasswordResetCodeSchema = Joi.object({
    email: Joi.string().trim().max(256).email().required()
        .messages({
            'any.required': c.CODE_EMAIL_REQUIRED,
            'string.empty': c.CODE_EMAIL_REQUIRED,
            'string.max': c.CODE_EMAIL_MAX,
            'string.email': c.CODE_EMAIL_INVALID
        })
});

/**
 * @swagger
 * components:
 *   schemas:
 *     VerifyResetCodeSchema:
 *       type: object
 *       required:
 *         - email
 *         - verificationCode
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           example: johndoe@example.com
 *         verificationCode:
 *           type: string
 *           example: 123456
 *         password:
 *           type: string
 *           example: StrongPassword123
*/
const verifyResetCodeSchema = Joi.object({
    email: Joi.string().trim().max(256).email().required()
        .messages({
            'any.required': c.CODE_EMAIL_REQUIRED,
            'string.empty': c.CODE_EMAIL_REQUIRED,
            'string.max': c.CODE_EMAIL_MAX,
            'string.email': c.CODE_EMAIL_INVALID
        }),
    verificationCode: Joi.string().max(64).pattern(/^\d+$/).required()
        .messages({
            'any.required': c.CODE_VERIFICATION_TOKEN_REQUIRED,
            'string.empty': c.CODE_VERIFICATION_TOKEN_REQUIRED,
            'string.pattern.base': c.CODE_VERIFICATION_TOKEN_NUMBER,
            'string.max': c.CODE_VERIFICATION_TOKEN_MAX
        }),
    password: Joi.string().trim().max(256).required()
        .messages({
            'any.required': c.CODE_PASSWORD_REQUIRED,
            'string.empty': c.CODE_PASSWORD_REQUIRED,
            'string.max': c.CODE_PASSWORD_MAX
        })
});

module.exports = { loginSchema, refreshTokenSchema, sendPasswordResetCodeSchema, verifyResetCodeSchema, logoutSchema };
