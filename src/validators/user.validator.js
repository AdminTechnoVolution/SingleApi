const Joi = require('joi');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const AuthType = require('../enums/EnumAuthType');
const Intent = require('../enums/EnumIntent');

/**
 * @swagger
 * components:
 *   schemas:
 *     Location:
 *       type: object
 *       required:
 *         - coordinates
 *       properties:
 *         coordinates:
 *           type: array
 *           description: [longitude, latitude]
 *           minItems: 2
 *           maxItems: 2
 *           items:
 *             type: number
 *           example: [-75.5636, 6.2518]
 *         country:
 *           type: string
 *           example: Colombia
 *         city:
 *           type: string
 *           example: Medellin
 * 
 *     ProfileConfig:
 *       type: object
 *       properties:
 *         showGenderInProfile:
 *           type: boolean
 *           example: "true"
 *         passportModeEnabled:
 *           type: boolean
 *           example: "false"
 *         passportModeLocation:
 *           $ref: '#/components/schemas/Location'
 *         preferredLanguage:
 *           type: string
 *           example: "1"
 *           description: Refer '/api/language' API for valid values
 *         maximumDistance:
 *           type: number
 *           example: 10000
 *           description: Maximum distance in meters
 *         preferredHeightUnit:
 *           type: string
 *           example: CM
 *           description: unit for height measurement
 *         preferredDistanceUnit:
 *           type: string
 *           example: KM
 *           description: Unit for distance measurement
 *         openToDating:
 *           type: boolean
 *           example: false
 *           description: Kultura "Open to something more" (dating features). Default false.
 *         ageRange:
 *           type: object
 *           properties:
 *             min:
 *               type: number
 *               example: 18
 *               description: Minimum age
 *             max:
 *               type: number
 *               example: 99
 *               description: Maximum age
 * 
 *     Lifestyle:
 *       type: object
 *       properties:
 *         diet:
 *           type: string
 *           example: "1"
 *           description: Refer '/api/diet-habit' API for valid values
 *         exercise:
 *           type: string
 *           example: "2"
 *           description: Refer '/api/exercise-habit' API for valid values
 *         smoking:
 *           type: string
 *           example: "4"
 *           description: Refer '/api/smoking-habit' API for valid values
 *         drinking:
 *           type: string
 *           example: "2"
 *           description: Refer '/api/drinking-habit' API for valid values
 *
 *     MusicPreferences:
 *       type: object
 *       properties:
 *         favoriteAnthem:
 *           type: string
 *           example: "Shape of You by Ed Sheeran"
 *           maxLength: 128
 *         topArtist:
 *           type: array
 *           items:
 *             type: string
 *           example: ["10", "20", "4"]
 *           description: Refer '/api/artist' API for valid values
 *         musicGenres:
 *           type: array
 *           items:
 *             type: string
 *           example: ["26", "1", "2"]
 *           description: Refer '/api/music-genre' API for valid values
 * 
 *     UserInfoUpdate:
 *       type: object
 *       properties:
 *         fullName:
 *           type: string
 *           maxLength: 128
 *           example: John Doe
 *         birthdate:
 *           type: string
 *           format: date
 *           example: 1990-01-01
 *         gender:
 *           type: string
 *           example: M
 *           description: Refer '/api/gender' API for valid values
 *         sexualOrientation:
 *           type: string
 *           example: ST
 *           description: Refer '/api/sexual-orientation' API for valid values
 *         biography:
 *           type: string
 *           maxLength: 500
 *           example: I am a friendly person who loves adventures.
 *         height:
 *           type: number
 *           example: 160
 *           description: Height in centimeters
 *         zodiacSign:
 *           type: string
 *           example: 1
 *           description: Refer '/api/zodiac-sign' API for valid values
 *         familyPlans:
 *           type: string
 *           example: 1
 *           description: Refer '/api/family-plan' API for valid values
 *         languages:
 *           type: array
 *           items:
 *             type: string
 *           example: ["1", "2"]
 *           description: Refer '/api/language' API for valid values
 *
 *     UserInfo:
 *       type: object
 *       required:
 *         - fullName
 *         - birthdate
 *         - gender
 *         - sexualOrientation
 *       properties:
 *         fullName:
 *           type: string
 *           maxLength: 128
 *           example: John Doe
 *         birthdate:
 *           type: string
 *           format: date
 *           example: 1990-01-01
 *         gender:
 *           type: string
 *           example: M
 *           description: Refer '/api/gender' API for valid values
 *         sexualOrientation:
 *           type: string
 *           example: ST
 *           description: Refer '/api/sexual-orientation' API for valid values
 *
 *     Preferences:
 *       type: object
 *       description: preferences and lookingFor are required only when intents is absent (legacy) or includes 'dating'.
 *       properties:
 *         intents:
 *           type: array
 *           items:
 *             type: string
 *             enum: [friends, language_exchange, dating]
 *           example: ["language_exchange", "friends"]
 *         preferences:
 *           type: array
 *           items:
 *             type: string
 *           example: ["F", "M"]
 *           description: Refer '/api/gender' API for valid values
 *         lookingFor:
 *           type: string
 *           example: "1"
 *           description: Refer '/api/looking-for' API for valid values
 *
 *     AddImageUserSchema:
 *       type: object
 *       required:
 *         - images
 *       properties:
 *         images:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 * 
 *     UpdateImageUserSchema:
 *       type: object
 *       required:
 *         - path
 *         - images
 *       properties:
 *         path:
 *           type: string
 *           example: 68c490865d8254ec33d4fb5e/db841f33fe78aa1f/
 *         images:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 *
 *     DeleteImageUserSchema:
 *       type: object
 *       required:
 *         - path
 *       properties:
 *         path:
 *           type: string
 *           example: 68c490865d8254ec33d4fb5e/db841f33fe78aa1f/
 * 
 *     RegisterUserSchema:
 *       type: object
 *       required:
 *         - email
 *         - userInfo
 *         - preferences
 *         - location
 *         - profileConfig
 *         - images
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           maxLength: 128
 *           example: johndoe@example.com
 *         password:
 *           type: string
 *           format: password
 *           example: StrongPassword123
 *         authMethod:
 *           type: string
 *           example: google/apple
 *         socialToken:
 *           type: string
 *           example: eyJhbGciOiAcc...
 *         userInfo:
 *           $ref: '#/components/schemas/UserInfo'
 *         preferences:
 *           $ref: '#/components/schemas/Preferences'
 *         location:
 *           $ref: '#/components/schemas/Location'
 *         profileConfig:
 *           $ref: '#/components/schemas/ProfileConfig'
 *         images:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 *
 *     UpdateUserSchema:
 *       type: object
 *       properties:
 *         userInfo:
 *           $ref: '#/components/schemas/UserInfoUpdate'
 *         preferences:
 *           $ref: '#/components/schemas/Preferences'
 *         location:
 *           $ref: '#/components/schemas/Location'
 *         profileConfig:
 *           $ref: '#/components/schemas/ProfileConfig'
 *         lifestyle:
 *           $ref: '#/components/schemas/Lifestyle'
 *         musicPreferences:
 *           $ref: '#/components/schemas/MusicPreferences'
 * 
 *     ChangePasswordSchema:
 *       type: object
 *       required:
 *         - password
 *       properties:
 *         password:
 *           type: string
 *           format: password
 *           example: StrongPassword123
 */
const intentsJoi = Joi.array().items(Joi.string().valid(...Object.values(Intent))).min(1).unique()
    .messages({
        'any.only': c.CODE_INTENTS_INVALID,
        'array.min': c.CODE_INTENTS_REQUIRED,
        'array.unique': c.CODE_INTENTS_DUPLICATES
    });

const learningLanguagesJoi = Joi.array().items(Joi.string()).unique().optional()
    .messages({ 'array.unique': c.CODE_LEARNING_LANGUAGES_DUPLICATES });

const interestsJoi = Joi.array().items(Joi.string()).unique().max(30).optional()
    .messages({ 'array.unique': c.CODE_INTERESTS_DUPLICATES });

const includesDating = Joi.array().has(Joi.string().valid(Intent.DATING));

/**
 * Dating fields (sexualOrientation, preferences.preferences, lookingFor) are required
 * only for dating profiles: intents absent (legacy clients, e.g. Android) or including 'dating'.
 * `intentsRef`: path of preferences.intents relative to the field ('/' = from the root).
 */
const requiredForDating = (schema, intentsRef) => Joi.when(intentsRef, {
    not: Joi.exist(),
    then: schema.required(),
    otherwise: Joi.when(intentsRef, { is: includesDating, then: schema.required(), otherwise: schema.optional() })
});

const locationJoi = Joi.object({
    coordinates: Joi.array().items(Joi.number()).length(2).required()
        .messages({
            'any.required': c.CODE_COORDINATES_REQUIRED,
            'array.base': c.CODE_COORDINATES_VALID,
            'array.length': c.CODE_COORDINATES_LENGTH,
            "number.base": c.CODE_COORDINATES_NUMBER,
        }),
    country: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_COUNTRY_REQUIRED,
        }),
    city: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_CITY_REQUIRED,
        }),
});

const userInfoUpdateJoi = Joi.object({
    fullName: Joi.string().trim().max(128).optional()
        .messages({
            'string.empty': c.CODE_FULL_NAME_REQUIRED,
            'string.max': c.CODE_FULL_NAME_MAX
        }),
    birthdate: Joi.date().optional()
        .messages({
            'string.empty': c.CODE_BIRTHDATE_REQUIRED,
            'date.base': c.CODE_BIRTHDATE_VALID
        }),
    gender: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_GENDER_REQUIRED
        }),
    sexualOrientation: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_SEXUAL_ORIENTATION_REQUIRED
        }),
    biography: Joi.string().trim().max(500).optional()
        .messages({
            'string.empty': c.CODE_BIOGRAPHY_REQUIRED,
            'string.max': c.CODE_BIOGRAPHY_MAX
        }),
    height: Joi.number().optional()
        .messages({
            'number.base': c.CODE_HEIGHT_NUMBER
        }),
    zodiacSign: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_ZODIAC_REQUIRED
        }),
    familyPlans: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_FAMILY_PLAN_REQUIRED
        }),
    languages: Joi.array().items(Joi.string()).unique().optional()
        .messages({
            'string.empty': c.CODE_LANGUAGES_REQUIRED,
            'array.unique': c.CODE_LANGUAGES_DUPLICATES
        }),
    learningLanguages: learningLanguagesJoi,
    interests: interestsJoi,
});

const preferencesUpdateJoi = Joi.object({
    preferences: Joi.array().items(Joi.string()).unique().optional()
        .messages({
            'string.empty': c.CODE_PREFERENCES_REQUIRED,
            'array.unique': c.CODE_PREFERENCE_DUPLICATES
        }),
    lookingFor: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_LOOKING_FOR_REQUIRED
        }),
    intents: intentsJoi.optional()
});

const userInfoJoi = Joi.object({
    fullName: Joi.string().trim().max(128).required()
        .messages({
            'any.required': c.CODE_FULL_NAME_REQUIRED,
            'string.empty': c.CODE_FULL_NAME_REQUIRED,
            'string.max': c.CODE_FULL_NAME_MAX
        }),
    birthdate: Joi.date().required()
        .messages({
            'any.required': c.CODE_BIRTHDATE_REQUIRED,
            'string.empty': c.CODE_BIRTHDATE_REQUIRED,
            'date.base': c.CODE_BIRTHDATE_VALID
        }),
    gender: Joi.string().required()
        .messages({
            'any.required': c.CODE_GENDER_REQUIRED,
            'string.empty': c.CODE_GENDER_REQUIRED
        }),
    sexualOrientation: requiredForDating(Joi.string(), '/preferences.intents')
        .messages({
            'any.required': c.CODE_SEXUAL_ORIENTATION_REQUIRED,
            'string.empty': c.CODE_SEXUAL_ORIENTATION_REQUIRED
        }),
    // Kultura (optional, also accepted from legacy clients).
    languages: Joi.array().items(Joi.string()).unique().optional()
        .messages({
            'string.empty': c.CODE_LANGUAGES_REQUIRED,
            'array.unique': c.CODE_LANGUAGES_DUPLICATES
        }),
    learningLanguages: learningLanguagesJoi,
    interests: interestsJoi
});

const preferencesJoi = Joi.object({
    preferences: requiredForDating(Joi.array().items(Joi.string()).unique(), 'intents')
        .messages({
            'any.required': c.CODE_PREFERENCES_REQUIRED,
            'string.empty': c.CODE_PREFERENCES_REQUIRED,
            'array.unique': c.CODE_PREFERENCE_DUPLICATES
        }),
    lookingFor: requiredForDating(Joi.string(), 'intents')
        .messages({
            'any.required': c.CODE_LOOKING_FOR_REQUIRED,
            'string.empty': c.CODE_LOOKING_FOR_REQUIRED
        }),
    intents: intentsJoi.optional()
});

const profileConfigJoi = Joi.object({
    showGenderInProfile: Joi.boolean().optional()
        .messages({
            "boolean.base": c.CODE_SHOW_GENDER_BOOLEAN
        }),
    passportModeEnabled: Joi.boolean().optional()
        .messages({
            "boolean.base": c.CODE_PASSPORT_MODE_ENABLED_BOOLEAN
        }),
    passportModeLocation: locationJoi.optional(),
    preferredLanguage: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_PREFERRED_LANGUAGE_REQUIRED
        }),
    maximumDistance: Joi.number().optional()
        .messages({
            'number.base': c.CODE_MAXIMUM_DISTANCE_NUMBER
        }),
    ageRange: Joi.object({
        min: Joi.number().min(1).max(100).optional()
            .messages({
                'number.base': c.CODE_AGE_RANGE_MIN_NUMBER,
                'number.min': c.CODE_AGE_RANGE_MIN,
                'number.max': c.CODE_AGE_RANGE_MAX,
            }),
        max: Joi.number().min(1).max(100).optional()
            .messages({
                'number.base': c.CODE_AGE_RANGE_MAX_NUMBER,
                'number.min': c.CODE_AGE_RANGE_MIN,
                'number.max': c.CODE_AGE_RANGE_MAX,
            })
    }).optional(),
    preferredHeightUnit: Joi.string().valid('CM', 'FT').optional()
        .messages({
            'any.only': c.CODE_PREFERRED_HEIGHT_UNIT_INVALID
        }),
    preferredDistanceUnit: Joi.string().valid('KM', 'MI').optional()
        .messages({
            'any.only': c.CODE_PREFERRED_DISTANCE_UNIT_INVALID
        }),
    openToDating: Joi.boolean().optional()
        .messages({
            "boolean.base": c.CODE_OPEN_TO_DATING_BOOLEAN
        })
});

const registerUserSchema = Joi.object({
    email: Joi.string().trim().email().max(256).required()
        .messages({
            'any.required': c.CODE_EMAIL_REQUIRED,
            'string.empty': c.CODE_EMAIL_REQUIRED,
            'string.max': c.CODE_EMAIL_MAX,
            'string.email': c.CODE_EMAIL_INVALID
        }),
    password: Joi.string().min(8).max(256)
        .messages({
            'string.min': c.CODE_PASSWORD_MIN,
            'string.max': c.CODE_PASSWORD_MAX
        }),
    authMethod: Joi.string().valid(...Object.values(AuthType)).max(256)
        .messages({
            'any.only': c.CODE_AUTH_METHOD_INVALID,
            'string.max': c.CODE_AUTH_METHOD_MAX
        }),
    socialToken: Joi.string().max(2048)
        .messages({
            'string.max': c.CODE_SOCIAL_TOKEN_MAX
        }),
    userInfo: userInfoJoi.required()
        .messages({
            'any.required': c.CODE_USER_INFO_REQUIRED
        }),
    preferences: preferencesJoi.required()
        .messages({
            'any.required': c.CODE_PREFERENCES_REQUIRED
        }),
    location: locationJoi.required()
        .messages({
            'any.required': c.CODE_LOCATION_REQUIRED
        }),
    profileConfig: profileConfigJoi.optional()
}).xor('password', 'socialToken').messages({
    'object.missing': c.CODE_ONLY_PASSWORD_OR_SOCIAL_TOKEN,
    'object.xor': c.CODE_ONLY_PASSWORD_OR_SOCIAL_TOKEN
});;

const lifestyleJoi = Joi.object({
    diet: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_DIET_REQUIRED
        }),
    exercise: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_EXERCISE_REQUIRED
        }),
    smoking: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_SMOKING_REQUIRED
        }),
    drinking: Joi.string().optional()
        .messages({
            'string.empty': c.CODE_DRINKING_REQUIRED
        }),
});

const musicPreferencesJoi = Joi.object({
    favoriteAnthem: Joi.string().max(128).optional()
        .messages({
            'string.max': c.CODE_FAV_ANTHEM_MAX,
            'string.empty': c.CODE_FAV_ANTHEM_REQUIRED
        }),
    topArtist: Joi.array().items(Joi.string()).unique().optional()
        .messages({
            'string.empty': c.CODE_TOP_ARTISTS_REQUIRED,
            'array.unique': c.CODE_TOP_ARTISTS_DUPLICATES
        }),
    musicGenres: Joi.array().items(Joi.string()).unique().optional()
        .messages({
            'string.empty': c.CODE_MUSIC_GENRES_REQUIRED,
            'array.unique': c.CODE_MUSIC_GENRES_DUPLICATES
        }),
});

const updateUserSchema = Joi.object({
    userInfo: userInfoUpdateJoi.optional(),
    preferences: preferencesUpdateJoi.optional(),
    location: locationJoi.optional(),
    profileConfig: profileConfigJoi.optional(),
    lifestyle: lifestyleJoi.optional(),
    musicPreferences: musicPreferencesJoi.optional()
});

const userPhotosSchema = Joi.object({
    path: Joi.string().trim().max(128).required()
        .messages({
            'string.empty': c.CODE_PATH_REQUIRED,
            'any.required': c.CODE_PATH_REQUIRED,
            'string.max': c.CODE_PATH_MAX
        })
});

const changePasswordSchema = Joi.object({
    password: Joi.string().min(8).max(128).required()
        .messages({
            'any.required': c.CODE_PASSWORD_REQUIRED,
            'string.empty': c.CODE_PASSWORD_REQUIRED,
            'string.min': c.CODE_PASSWORD_MIN,
            'string.max': c.CODE_PASSWORD_MAX
        })
});

module.exports = {
    registerUserSchema,
    updateUserSchema,
    userPhotosSchema,
    changePasswordSchema
};
