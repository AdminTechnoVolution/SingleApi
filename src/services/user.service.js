const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const { flatten } = require('flat');
const ObjectId = require("mongoose").Types.ObjectId;
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const ClientException = require('../../shared/exceptionHandler/ClientException');
const ImageProcessor = require('../../shared/util/ImageProcessor');
const AzureUploader = require('../../shared/util/AzureUploader');
const googlePayClient = require('../client/googlePay.client');
const UserRepository = require('../repository/user.repository');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const consCache = require('../../shared/util/constants.cache');
const AuthType = require('../enums/EnumAuthType');
const configService = require('../services/config.service');
const genderService = require('../services/gender.service');
const dietService = require('../services/dietHabit.service');
const exerciseService = require('../services/exerciseHabit.service');
const drinkingService = require('../services/drinkingHabit.service');
const smokingService = require('../services/smokingHabit.service');
const artistService = require('../services/artist.service');
const musicGenreService = require('../services/musicGenres.service');
const sexualOrientationService = require('../services/sexualOrientation.service');
const familyPlanService = require('../services/familyPlan.service');
const languageService = require('../services/language.service');
const lookingForService = require('../services/lookingFor.service');
const zodiacSignService = require('../services/zodiacSign.service');
const util = require('../../shared/util/util');
const utilNudity = require('../../shared/util/util.nudity');
const jwtUtil = require('../../shared/util/jwt');
const redisClient = require('../../shared/config/redis');
const googleClient = require('../client/googlePay.client');
const User = require('../models/user.model');
const ChatRepository = require('../repository/chat.repository');
const MatchRepository = require('../repository/match.repository');
const ConversationRepository = require('../repository/conversation.repository');
const LikeRepository = require('../repository/likes.repository');
const DislikeRepository = require('../repository/dislikes.repository');
const FCMTokenRepository = require('../repository/fcmToken.repository');
const ReportRepository = require('../repository/report.repository');
const SubscriptionRepository = require('../repository/subscription.repository');
const UserProfileSyncService = require('./userProfileSync.service');
const azureUploader = new AzureUploader(process.env.S3_CONNECTION_STRING, process.env.S3_CONTAINER);

const getUserById = async (req) => {
    const { userId } = req.params;

    const pipeline = await createPipeline(userId);
    let user = await UserRepository.findByPipeline(pipeline, true);
    if (!user || (Array.isArray(user) && user.length === 0)) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);

    return new BaseResponse(true, [], user[0]);
};

const getUserMe = async (req) => {
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    const pipeline = await createPipeline(userId);
    let user = await UserRepository.findByPipeline(pipeline, true);
    if (!user) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);

    const now = new Date();

    const filter = {
        userId: userId,
        'paymentInfo.fromDate': { $lte: now },
        'paymentInfo.toDate': { $gte: now }
    };

    let subscription = null;
    let subscriptionDB = await SubscriptionRepository.findByFilter(filter);
    if (subscriptionDB) {
        subscriptionDB = subscriptionDB.toObject();
        subscriptionDB._id = undefined;
        subscriptionDB.userId = undefined;
        subscriptionDB.purchaseToken = undefined;

        const isActive = googlePayClient.isActiveSubscriptionV2(subscriptionDB);
        if (isActive) {
            subscription = { ...subscriptionDB };
        }
    }

    if (!subscription) {
        const stripeSubscription = await SubscriptionRepository.findActiveStripeForUser(userId);
        if (stripeSubscription) {
            const stripeData = stripeSubscription.toObject();
            stripeData._id = undefined;
            stripeData.userId = undefined;
            stripeData.purchaseToken = undefined;
            subscription = stripeData;
        }
    }

    const syncResult = await UserProfileSyncService.syncUserPassportAndEffectiveLocationByUserId(userId, !!subscription);
    if (syncResult?.user) {
        user[0].effectiveLocation = syncResult.user.effectiveLocation;
        user[0].profileConfig = user[0].profileConfig || {};
        user[0].profileConfig.passportModeEnabled = syncResult.user.profileConfig?.passportModeEnabled;
    }

    const config = await configService.getConfigs();
    const configs = await fillConfigs(config.data, userId);

    var response = {
        ...user[0],
        subscription,
        configs
    };

    return new BaseResponse(true, [], response);
};

const registerUser = async (req) => {
    let body = req.body;
    const files = req.files;
    await validateUserInput(body, files);

    await utilNudity.checkNudityImages(files, constants.NEW_USER, req);

    let hashedPassword;
    let auth;
    if (body.password) {
        hashedPassword = await util.generateHash(body.password, true);
    } else {
        const socialResponse = await verifySocialToken(body, req);

        auth = {
            method: body.authMethod,
            socialId: socialResponse.socialId,
            isVerified: socialResponse.isVerified
        };
    }

    let user = new User({
        email: body.email.toLowerCase(),
        password: hashedPassword,
        auth: auth,
        userInfo: {
            fullName: body.userInfo.fullName,
            birthdate: body.userInfo.birthdate,
            gender: body.userInfo.gender,
            sexualOrientation: body.userInfo.sexualOrientation,
        },
        preferences: {
            preferences: body.preferences.preferences,
            lookingFor: body.preferences.lookingFor
        },
        location: body.location,
        effectiveLocation: body.location,
        profileConfig: body.profileConfig || {},
    });

    user = await UserRepository.save(user);
    const processor = new ImageProcessor();
    const filesTransformed = await processor.processImages(files, user._id.toHexString());

    const results = await azureUploader.uploadBatch(filesTransformed);

    user.photos = results;
    await UserRepository.save(user);

    message = c.CODE_SUCCESS_REGISTER_USER
    return new BaseResponse(true, [message]);
};

const updateUser = async (req) => {
    let token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');
    let body = req.body;
    await validateUserInputUpdate(body);

    const userFlattened = flatten(body, { safe: true });
    const userUpdated = await UserRepository.findByIdAndUpdate(userId, userFlattened);

    const effectiveUserUpdated = setEffectiveLocation(userUpdated);
    await effectiveUserUpdated.save();

    message = c.CODE_SUCCESS_UPDATE_USER;
    return new BaseResponse(true, [message]);
}

const changePassword = async (req) => {
    const token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');
    const body = req.body;

    const hashedPassword = await util.generateHash(body.password, true);

    await UserRepository.findByIdAndUpdate(userId, { password: hashedPassword });

    message = c.CODE_SUCCESS;
    return new BaseResponse(true, [message]);
}

const deleteUserAccount = async (req) => {
    const token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');

    deleteUserAccountFlow(userId);

    message = c.CODE_SUCCESS;
    return new BaseResponse(true, [message]);
}

const deleteUserAccountFlow = async (userId) => {
    try {
        logger.info(`Starting deleteUserAccount proccess for user ${userId}`, { className: filename });
        const userIdObject = new ObjectId(userId);

        const userDB = await updateUserStatusDeleting(userIdObject);
        const chats = await findChats(userIdObject);

        await deleteDislikes(userIdObject);
        await deleteLikes(userIdObject);
        await deleteFCMTokens(userIdObject);
        await deleteReports(userIdObject);
        await deleteConversations(chats);
        await deleteChats(userIdObject);
        await deleteMatchs(userIdObject);
        await deletePhotos(userDB);
        await deleteRedisInfo(userId);
        await removeUserAccount(userIdObject);
        logger.info(`Finished successfully deleteUserAccount proccess for user ${userId}`, { className: filename });
    } catch (err) {
        logger.error(`Error: need to re-execute the user delete manually for user ${userId}`, { className: filename });
        logger.error(`Error in deleteUserAccount. Error: ${err}`, { className: filename });
    }
}

const updateUserStatusDeleting = async (userId) => {
    logger.info(`Updating user with status ${constants.STATUS_DESC_DELETING}`, { className: filename });

    const set = { status: constants.STATUS_DESC_DELETING };
    return await UserRepository.findByIdAndUpdate(userId, set);
}

const deleteDislikes = async (userId) => {
    logger.info(`Deleting dislikes associated to the user`, { className: filename });
    const filter = {
        $or: [
            { fromUserId: userId },
            { toUserId: userId }
        ]
    };

    await DislikeRepository.deleteManyByFilter(filter);
}

const deleteLikes = async (userId) => {
    logger.info(`Deleting likes associated to the user`, { className: filename });
    const filter = {
        $or: [
            { fromUserId: userId },
            { toUserId: userId }
        ]
    };

    await LikeRepository.deleteManyByFilter(filter);
}

const deleteFCMTokens = async (userId) => {
    logger.info(`Deleting FCM Tokens associated to the user`, { className: filename });
    const filter = {
        userId: userId
    };

    await FCMTokenRepository.deleteAllByFilter(filter);
}

const deleteReports = async (userId) => {
    logger.info(`Deleting reports associated to the user`, { className: filename });
    const filter = {
        $or: [
            { reporterUserId: userId },
            { reportedUserId: userId }
        ]
    };

    await ReportRepository.deleteManyByFilter(filter);
}

const findChats = async (userId) => {
    logger.info(`Finding chats associated to the user`, { className: filename });
    const filter = {
        users: userId
    };
    return await ChatRepository.findByAnyFilter(filter);
}

const deleteConversations = async (chats) => {
    logger.info(`Deleting conversations associated to the chat user`, { className: filename });

    const filter = {
        chatId: { $in: chats.map(c => c._id) }
    };

    await ConversationRepository.deleteManyByFilter(filter);
}

const deleteChats = async (userId) => {
    logger.info(`Deleting chats associated to the user`, { className: filename });
    const filter = {
        users: userId
    };

    await ChatRepository.deleteManyByFilter(filter);
}

const deleteMatchs = async (userId) => {
    logger.info(`Deleting matchs associated to the user`, { className: filename });
    const filter = {
        users: userId
    };

    await MatchRepository.deleteManyByFilter(filter);
}

const deletePhotos = async (user) => {
    logger.info(`Deleting photos in Azure Blob Storage associated to the user`, { className: filename });
    const blobNames = [];

    for (const photo of user.photos) {
        for (const size of photo.sizes) {
            const blobName = photo.path + size.name;
            blobNames.push(blobName);
        }
    }

    await azureUploader.deleteBatch(blobNames);
}

const deleteRedisInfo = async (userId) => {
    logger.info(`Deleting redis keys associated to the user`, { className: filename });

    const dataAccessTokens = await getRedisDataByPattern(`${consCache.REDIS_KEY_ACCESS_TOKEN}*`);
    const dataRefreshTokens = await getRedisDataByPattern(`${consCache.REDIS_KEY_REFRESH_TOKEN}*`);

    await deleteKeysByUserId(dataAccessTokens, userId);
    await deleteKeysByUserId(dataRefreshTokens, userId);
    await redisClient.del(`${consCache.REDIS_KEY_USER_SOCKETS}${userId}`);

}

const deleteKeysByUserId = async (data, userId) => {
    for (const item of data) {
        const value = JSON.parse(item.value);
        if (value.id === userId) {
            await redisClient.del(item.key);
        }
    }
}

const getRedisDataByPattern = async (pattern) => {
    const keys = [];

    for await (const key of redisClient.scanIterator({
        MATCH: pattern,
        COUNT: 100,
    })) {
        key.forEach(k => keys.push(k.toString()));
    }

    if (keys.length === 0) return [];

    const values = await redisClient.mGet(keys);
    return keys.map((k, i) => ({ key: k, value: values[i] }));
}

const removeUserAccount = async (userId) => {
    logger.info(`Removing user`, { className: filename });
    await UserRepository.findByIdAndDelete(userId);
}

const addImageUser = async (req) => {
    const files = req.files;

    if (!files || files.length === 0) throw new BusinessException(c.CODE_PHOTOS_REQUIRED);

    let token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');

    const filter = { _id: userId };
    let user = await UserRepository.findOneByFilter(filter);

    if (user.photos.length + files.length > 6) throw new BusinessException(c.CODE_PHOTOS_MAX);

    await utilNudity.checkNudityImages(files, userId, req);

    const processor = new ImageProcessor();
    const addIsProfile = user.photos.length === 0;
    const filesTransformed = await processor.processImages(files, userId, addIsProfile);

    const results = await azureUploader.uploadBatch(filesTransformed);
    user.photos.push(...results);

    user = await UserRepository.save(user);
    user.photos;

    message = c.CODE_SUCCESS_ADD_IMAGE_USER;
    return new BaseResponse(true, [message], { photos: user.photos });
}

const updateImageUser = async (req) => {
    let body = req.body;
    const files = req.files;

    if (!files || files.length === 0) throw new BusinessException(c.CODE_PHOTOS_REQUIRED);

    let token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');

    const filter = { _id: userId, 'photos.path': body.path };
    let user = await UserRepository.findOneByFilter(filter);

    if (!user) throw new BusinessException(c.CODE_PHOTOS_NOT_FOUND);

    await utilNudity.checkNudityImages(files, userId, req);

    const processor = new ImageProcessor();
    const filesTransformed = await processor.processImages(files, userId);

    filesTransformed.forEach(file => file.path = body.path);

    const results = await azureUploader.uploadBatch(filesTransformed);

    message = c.CODE_SUCCESS_UPDATE_IMAGE_USER;
    return new BaseResponse(true, [message]);
}

const deleteImageUser = async (req) => {
    let token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');
    let body = req.body;

    const filter = { _id: userId, 'photos.path': body.path };
    let user = await UserRepository.findOneByFilter(filter);

    if (!user) throw new BusinessException(c.CODE_PHOTOS_NOT_FOUND);

    const isProfilePhoto = user.photos.find(photo => (photo.path === body.path && photo.isProfile === true));
    if (isProfilePhoto) throw new BusinessException(c.CODE_PHOTOS_PRFOILE_CANNOT_BE_DELETED);

    for (const photo of user.photos) {
        if (photo.path === body.path) {
            for (const size of photo.sizes) {
                await azureUploader.deleteOne(photo.path + size.name);
            }
            break;
        }
    }

    user.photos = user.photos.filter(photo => photo.path !== body.path);
    await UserRepository.save(user);

    message = c.CODE_SUCCESS_DELETE_IMAGE_USER;
    return new BaseResponse(true, [message]);
}

const validateUserInputUpdate = async (body) => {
    if (!body || Object.keys(body).length === 0) throw new BusinessException(c.CODE_MALFORMED_BAD_REQUEST);

    if (body.userInfo && Object.keys(body.userInfo).length === 0) throw new BusinessException(c.CODE_MALFORMED_BAD_REQUEST);

    if (body.preferences && Object.keys(body.preferences).length === 0) throw new BusinessException(c.CODE_MALFORMED_BAD_REQUEST);

    if (body.lifestyle && Object.keys(body.lifestyle).length === 0) throw new BusinessException(c.CODE_MALFORMED_BAD_REQUEST);

    if (body.musicPreferences && Object.keys(body.musicPreferences).length === 0) throw new BusinessException(c.CODE_MALFORMED_BAD_REQUEST);

    if (body.profileConfig && Object.keys(body.profileConfig).length === 0) throw new BusinessException(c.CODE_MALFORMED_BAD_REQUEST);

    if (body.userInfo?.birthdate) {
        if (!util.isAdult(body.userInfo.birthdate)) throw new BusinessException(c.CODE_IS_NOT_ADULT);
    }

    if (body.userInfo?.gender) {
        const genders = (await genderService.getGenders()).data;
        const genderFound = genders.find(g => g._id === body.userInfo.gender);
        if (!genderFound) throw new BusinessException(c.CODE_GENDER_NOT_FOUND);
    }

    if (body.userInfo?.sexualOrientation) {
        const sexualOrientations = (await sexualOrientationService.getSexualOrientations()).data;
        const sexualOrientationFound = sexualOrientations.find(s => s._id === body.userInfo.sexualOrientation);
        if (!sexualOrientationFound) throw new BusinessException(c.CODE_SEXUAL_ORIENTATION_NOT_FOUND);
    }

    if (body.userInfo?.zodiacSign) {
        const zodiacs = (await zodiacSignService.getZodiacSigns()).data;
        const zodiacSignFound = zodiacs.find(z => z._id === body.userInfo.zodiacSign);
        if (!zodiacSignFound) throw new BusinessException(c.CODE_ZODIAC_NOT_FOUND);
    }

    if (body.userInfo?.familyPlans) {
        const familyPlans = (await familyPlanService.getFamilyPlans()).data;
        const familyPlanFound = familyPlans.find(f => f._id === body.userInfo.familyPlans);
        if (!familyPlanFound) throw new BusinessException(c.CODE_FAMILY_PLAN_NOT_FOUND);
    }

    if (body.userInfo?.languages) {
        const languages = (await languageService.getLanguages()).data;
        const validLanguagesIds = new Set(languages.map(l => l._id));
        const invalidLanguages = body.userInfo.languages.filter(languages => !validLanguagesIds.has(languages));
        if (invalidLanguages.length > 0) throw new BusinessException(c.CODE_LANGUAGES_NOT_FOUND);
    }

    if (body.preferences?.preferences) {
        const genders = (await genderService.getGenders()).data;
        const validGenderIds = new Set(genders.map(g => g._id));
        const invalidPreferences = body.preferences.preferences.filter(preference => !validGenderIds.has(preference));
        if (invalidPreferences.length > 0) throw new BusinessException(c.CODE_PREFERENCE_NOT_FOUND);
    }

    if (body.preferences?.lookingFor) {
        const lookingFor = (await lookingForService.getLookingFor()).data;
        const lookingForFound = lookingFor.find(l => l._id === body.preferences.lookingFor);
        if (!lookingForFound) throw new BusinessException(c.CODE_LOOKING_FOR_NOT_FOUND);
    }

    if (body.lifestyle?.diet) {
        const diets = (await dietService.getDietHabits()).data;
        const dietFound = diets.find(d => d._id === body.lifestyle.diet);
        if (!dietFound) throw new BusinessException(c.CODE_DIET_NOT_FOUND);
    }

    if (body.lifestyle?.drinking) {
        const drinkings = (await drinkingService.getDrinkingHabits()).data;
        const drinkingFound = drinkings.find(d => d._id === body.lifestyle.drinking);
        if (!drinkingFound) throw new BusinessException(c.CODE_DRINKING_NOT_FOUND);
    }

    if (body.lifestyle?.smoking) {
        const smokings = (await smokingService.getSmokingHabits()).data;
        const smokingFound = smokings.find(s => s._id === body.lifestyle.smoking);
        if (!smokingFound) throw new BusinessException(c.CODE_SMOKING_NOT_FOUND);
    }

    if (body.lifestyle?.exercise) {
        const exercises = (await exerciseService.getExerciseHabits()).data;
        const exerciseFound = exercises.find(e => e._id === body.lifestyle.exercise);
        if (!exerciseFound) throw new BusinessException(c.CODE_EXERCISE_NOT_FOUND);
    }

    if (body.musicPreferences?.topArtist) {
        const artists = (await artistService.getArtists()).data;
        const validArtistIds = new Set(artists.map(a => a._id));
        const invalidArtists = body.musicPreferences.topArtist.filter(artist => !validArtistIds.has(artist));
        if (invalidArtists.length > 0) throw new BusinessException(c.CODE_TOP_ARTIST_NOT_FOUND);
    }

    if (body.musicPreferences?.musicGenres) {
        const musicGenres = (await musicGenreService.getMusicGenres()).data;
        const validMusicGenreIds = new Set(musicGenres.map(m => m._id));
        const invalidMusicGenres = body.musicPreferences.musicGenres.filter(musicGenre => !validMusicGenreIds.has(musicGenre));
        if (invalidMusicGenres.length > 0) throw new BusinessException(c.CODE_MUSIC_GENRES_NOT_FOUND);
    }

    if (body.profileConfig?.preferredLanguage) {
        const languages = (await languageService.getLanguages()).data;
        const languageFound = languages.find(l => l._id === body.profileConfig.preferredLanguage);
        if (!languageFound) throw new BusinessException(c.CODE_PREFERRED_LANGUAGE_NOT_FOUND);
    }
}

const setEffectiveLocation = (userUpdated) => {
    userUpdated.effectiveLocation = userUpdated.location;

    if (userUpdated.profileConfig?.passportModeEnabled !== undefined) {
        if (userUpdated.profileConfig.passportModeEnabled === true && userUpdated.profileConfig.passportModeLocation) {
            userUpdated.effectiveLocation = userUpdated.profileConfig.passportModeLocation;
        }
    }

    return userUpdated;
}

const fillConfigs = async (configs, userId) => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const likesPerDayConfig = configs.find(c => c.key === constants.BASIC_PLAN_LIKES_PER_DAY);
    const likesPerDayLimit = parseInt(likesPerDayConfig.value);

    const filterLikes = {
        fromUserId: new ObjectId(userId),
        created_at: { $gte: start, $lte: end }
    };

    const likesSentToday = await LikeRepository.countLikesByFilter(filterLikes);

    return { likesPerDayLimit, likesSentToday };
}

const validateUserInput = async (body, files) => {
    if (!files || files.length === 0) throw new BusinessException(c.CODE_PHOTOS_REQUIRED);

    if (files.length > 6) throw new BusinessException(c.CODE_PHOTOS_MAX);

    if (!util.isAdult(body.userInfo.birthdate)) throw new BusinessException(c.CODE_IS_NOT_ADULT);

    const genders = (await genderService.getGenders()).data;
    const genderFound = genders.find(g => g._id === body.userInfo.gender);
    if (!genderFound) throw new BusinessException(c.CODE_GENDER_NOT_FOUND);

    const sexualOrientations = (await sexualOrientationService.getSexualOrientations()).data;
    const sexualOrientationFound = sexualOrientations.find(s => s._id === body.userInfo.sexualOrientation);
    if (!sexualOrientationFound) throw new BusinessException(c.CODE_SEXUAL_ORIENTATION_NOT_FOUND);

    const validGenderIds = new Set(genders.map(g => g._id));
    const invalidPreferences = body.preferences.preferences.filter(preference => !validGenderIds.has(preference));
    if (invalidPreferences.length > 0) throw new BusinessException(c.CODE_PREFERENCE_NOT_FOUND);

    const lookingFor = (await lookingForService.getLookingFor()).data;
    const lookingForFound = lookingFor.find(l => l._id === body.preferences.lookingFor);
    if (!lookingForFound) throw new BusinessException(c.CODE_LOOKING_FOR_NOT_FOUND);

    const existingUser = await UserRepository.findOneByFilter({ email: body.email });

    if (existingUser) throw new BusinessException(c.CODE_USER_EXISTS);
};

const createPipeline = async (id) => {
    const pipeline = [];

    const matchStage = {
        _id: new ObjectId(id)
    };

    pipeline.push({ $match: matchStage });

    // Calculating age and formating birthdate 
    pipeline.push({
        $addFields: {
            userInfo: {
                $mergeObjects: [
                    "$userInfo",
                    {
                        birthdate: {
                            $dateToString: {
                                format: "%Y-%m-%d", // yyyy-MM-dd
                                date: "$userInfo.birthdate"
                            }
                        },
                        age: {
                            $dateDiff: {
                                startDate: "$userInfo.birthdate",
                                endDate: "$$NOW",
                                unit: "year"
                            }
                        }
                    }
                ]
            }
        }
    });

    // Exclude fields
    pipeline.push({
        $project:
        {
            'password': 0,
            'email': 0,
            'created_at': 0,
            'status': 0
        }
    });

    return pipeline;
};

async function verifySocialToken(body, req) {
    let socialResponse;
    const { socialToken, authMethod } = body;

    if (authMethod === AuthType.GOOGLE) {
        socialResponse = await googleClient.loginGoogle(req, socialToken);
    } else {
        throw new ClientException(c.CODE_ERROR_SERVICE_UNAVAILABLE, 503);
    }

    logger.info({ message: `Social Response: ${JSON.stringify(socialResponse)}`, className: filename, req: req });

    if (socialResponse.email !== req.body.email) throw new BusinessException(c.CODE_EMAIL_INVALID);

    if (!socialResponse.isVerified) throw new BusinessException(c.CODE_ERROR_REGISTER);

    return socialResponse;
}

module.exports = {
    registerUser,
    getUserMe,
    getUserById,
    updateUser,
    updateImageUser,
    addImageUser,
    deleteImageUser,
    changePassword,
    deleteUserAccount
};
