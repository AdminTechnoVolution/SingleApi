const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const ClientException = require('../../shared/exceptionHandler/ClientException');
const JWT_ACCESS_TOKEN_TTL_SECS = process.env.JWT_ACCESS_TOKEN_TTL_SECS;
const JWT_REFRESH_TOKEN_TTL_SECS = process.env.JWT_REFRESH_TOKEN_TTL_SECS;
const RESETCODE_REDIS_TTL_SECS = process.env.RESETCODE_REDIS_TTL_SECS;
const MAX_ATTEMPTS_VERIFYING_RESETCODE = process.env.MAX_ATTEMPTS_VERIFYING_RESETCODE;
const mailer = require('../../shared/email/mailer');
const EnumTemplatesHtml = require('../../shared/email/htmlConstants/EnumTemplatesHtml');
const EnumSubjectEmail = require('../../shared/email/htmlConstants/EnumSubjectEmail');
const AuthType = require('../enums/EnumAuthType');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const consCache = require('../../shared/util/constants.cache');
const util = require('../../shared/util/util');
const jwt = require('../../shared/util/jwt');
const redisClient = require('../../shared/config/redis');
const bcrypt = require('bcryptjs');
const googleClient = require('../client/googlePay.client');
const FCMToken = require('../models/fcmToken.model');
const FCMTokenRepository = require('../repository/fcmToken.repository');
const UserRepository = require('../repository/user.repository');

const logoutUser = async (req) => {
    try {
        let { accessToken, refreshToken, fcmToken } = req.body;

        if (fcmToken) {
            FCMTokenRepository.findOneByFilterAndPullToken(
                { fcmTokens: fcmToken },
                { fcmTokens: fcmToken }
            );
        }

        redisClient.del(`${consCache.REDIS_KEY_REFRESH_TOKEN}${refreshToken}`);
        redisClient.del(`${consCache.REDIS_KEY_ACCESS_TOKEN}${accessToken}`);
    } catch (err) {
        logger.error(`Error logout: ${err}`, { className: filename });
    }
    message = c.CODE_SUCCESS_LOGOUT;
    return new BaseResponse(true, [message]);
}

const refreshTokenUser = async (req) => {
    try {
        let { refreshToken } = req.body;

        const tokenConcat = consCache.REDIS_KEY_REFRESH_TOKEN + refreshToken;
        const exists = await redisClient.exists(tokenConcat);
        if (exists !== 1) {
            throw new BusinessException(c.CODE_ERROR_AUTH, 401);
        }

        const user = {
            _id: jwt.getValueFromJwtToken(refreshToken, 'id', false),
            email: jwt.getValueFromJwtToken(refreshToken, 'email', false)
        };

        const payload = {
            id: user._id,
            email: user.email
        };

        const payloadRefresh = {
            id: user._id,
            email: user.email,
            hash: util.generateRandomHash(),
        };

        await redisClient.del(tokenConcat);
        const token = await generateTokenAndSaveToken(payload, JWT_ACCESS_TOKEN_TTL_SECS, consCache.REDIS_KEY_ACCESS_TOKEN);
        refreshToken = await generateTokenAndSaveToken(payloadRefresh, JWT_REFRESH_TOKEN_TTL_SECS, consCache.REDIS_KEY_REFRESH_TOKEN);

        return new BaseResponse(true, [], { token, refreshToken });
    } catch (err) {
        logger.error({ message: `Error refreshing token: ${err}`, className: filename, req: req });
        throw new BusinessException(c.CODE_ERROR_AUTH, 401);
    }
}

const loginUser = async (req) => {
    let { email, password, socialToken, authMethod, fcmToken } = req.body;
    const user = await UserRepository.findOneByFilter({ email: email });

    if (!user || user.status !== constants.STATUS_DESC_ACTIVE) throw new BusinessException(c.CODE_ERROR_LOGIN, 401);

    if (password) {
        if (!user.password) throw new BusinessException(c.CODE_ERROR_LOGIN, 401);
        const isMatch = bcrypt.compareSync(password, user.password);
        if (!isMatch) throw new BusinessException(c.CODE_ERROR_LOGIN, 401);
    } else {
        const socialResponse = await verifySocialToken(socialToken, authMethod, user, req);
        if (!user.auth || !user.auth.method || !user.auth.socialId) {
            const auth = {
                method: authMethod,
                socialId: socialResponse.socialId,
                isVerified: socialResponse.isVerified
            };

            user.auth = auth;
            await UserRepository.save(user);
        }
    }

    const payload = {
        id: user._id,
        email: user.email
    };

    const payloadRefresh = {
        id: user._id,
        email: user.email,
        hash: util.generateRandomHash(),
    };

    if (fcmToken) {
        const result = await FCMTokenRepository.findOneByFilter({ userId: user._id });
        if (result) {
            const existsFcmToken = result.fcmTokens.some(i => i === fcmToken);

            if (!existsFcmToken) {
                result.fcmTokens.push(fcmToken);
                await FCMTokenRepository.save(result);
            }
        } else {
            const fcmTokenDoc = new FCMToken({
                userId: user._id,
                fcmTokens: [fcmToken],
            });
            await FCMTokenRepository.save(fcmTokenDoc);
        }
    }


    const token = await generateTokenAndSaveToken(payload, JWT_ACCESS_TOKEN_TTL_SECS, consCache.REDIS_KEY_ACCESS_TOKEN);
    const refreshToken = await generateTokenAndSaveToken(payloadRefresh, JWT_REFRESH_TOKEN_TTL_SECS, consCache.REDIS_KEY_REFRESH_TOKEN);

    return new BaseResponse(true, [], { token, refreshToken });
};

const sendPasswordResetCode = async (req) => {
    const { email } = req.body;
    const user = await UserRepository.findOneByFilter({ email: email });

    if (user) {
        const verificationCode = util.generateVerificationCode();
        const verificationCodeHashed = await util.generateHash(verificationCode, false);
        const redisKey = `${consCache.REDIS_KEY_PASSWORD_RESET_CODE}${user._id}`;
        const value = JSON.stringify({ code: verificationCodeHashed, attempts: 0 });

        await redisClient.del(redisKey);
        await redisClient.setEx(redisKey, RESETCODE_REDIS_TTL_SECS, value);

        const verificationExpireMins = Math.floor(RESETCODE_REDIS_TTL_SECS / 60);

        sendVerificationEmail(email, verificationCode, verificationExpireMins);
    }

    message = c.CODE_SUCCESS_SENT_PASSWORD_RESET_CODE;
    return new BaseResponse(true, [message]);
}

const verifyResetCode = async (req) => {
    const { email, verificationCode, password } = req.body;
    const user = await UserRepository.findOneByFilter({ email: email });

    if (!user) throw new BusinessException(c.CODE_ERROR_AUTH, 401);

    const verificationCodeHashed = await util.generateHash(verificationCode, false);
    const redisKey = `${consCache.REDIS_KEY_PASSWORD_RESET_CODE}${user._id}`;
    let userResetCode = await redisClient.get(redisKey);

    if (!userResetCode) throw new BusinessException(c.CODE_ERROR_AUTH, 401);

    userResetCode = JSON.parse(userResetCode);

    if (userResetCode.code !== verificationCodeHashed) {
        userResetCode.attempts += 1;
        if (userResetCode.attempts >= MAX_ATTEMPTS_VERIFYING_RESETCODE) {
            await redisClient.del(redisKey);
        } else {
            const value = JSON.stringify(userResetCode);
            await redisClient.set(redisKey, value, { KEEPTTL: true });
        }
        throw new BusinessException(c.CODE_ERROR_AUTH, 401);
    }

    let hashedPassword = await util.generateHash(password, true);
    await UserRepository.findByIdAndUpdate(user._id, { password: hashedPassword });
    await redisClient.del(redisKey);
    deleteRedisTokens(user._id.toString());
    deleteFcmTokens(user._id.toString());

    message = c.CODE_SUCCESS_RESET_PASSWORD;
    return new BaseResponse(true, [message]);
}

const sendVerificationEmail = async (email, code, verificationExpireMins) => {
    let subject = EnumSubjectEmail.SUBJECT_RECOVERY_PASSWORD;
    let html = EnumTemplatesHtml.TEMPLATE_HTML_RECOVERY_PASSWORD;
    html = html
        .replace(/\[code\]/g, code)
        .replace(/\[verificationExpireMins\]/g, verificationExpireMins);
    await mailer.sendEmail(email, subject, html);
};

const generateTokenAndSaveToken = async (payload, ttl, redisKey) => {
    const token = jwt.generateToken(payload, ttl);

    await redisClient.setEx(`${redisKey}${token}`, ttl, JSON.stringify(payload));
    return token;
};

const deleteRedisTokens = async (userId) => {
    const dataAccessTokens = await getRedisDataByPattern(`${consCache.REDIS_KEY_ACCESS_TOKEN}*`);
    const dataRefreshTokens = await getRedisDataByPattern(`${consCache.REDIS_KEY_REFRESH_TOKEN}*`);

    await deleteKeysByUserId(dataAccessTokens, userId);
    await deleteKeysByUserId(dataRefreshTokens, userId);
    await redisClient.del(`${consCache.REDIS_KEY_USER_SOCKETS}${userId}`);
}

const deleteFcmTokens = async (userId) => {
    await FCMTokenRepository.deleteAllByFilter({ userId: userId });
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

async function verifySocialToken(socialToken, authMethod, user, req) {
    let socialResponse;

    if (authMethod === AuthType.GOOGLE) {
        socialResponse = await googleClient.loginGoogle(req, socialToken);
    } else {
        throw new ClientException(c.CODE_ERROR_SERVICE_UNAVAILABLE, 503);
    }

    logger.info({ message: `Social Response: ${JSON.stringify(socialResponse)}`, className: filename, req: req });

    if (socialResponse.email !== user.email) throw new BusinessException(c.CODE_ERROR_LOGIN, 401);

    if (!socialResponse.isVerified) throw new BusinessException(c.CODE_ERROR_LOGIN, 401);

    return socialResponse;
}

module.exports = { loginUser, refreshTokenUser, logoutUser, sendPasswordResetCode, verifyResetCode };
