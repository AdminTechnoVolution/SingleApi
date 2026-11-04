const path = require('path');
const logger = require('../config/logger');
const filename = path.basename(__filename);
const redis = require('../config/redis');
const BaseResponse = require('../util/baseResponse');
const BusinessException = require('../exceptionHandler/BusinessException');
const c = require('../util/constants.frontcodes');
const constants = require('../util/constants');
const consCache = require('../util/constants.cache');
const { verifyJwtToken, getValueFromJwtToken } = require('../util/jwt');
const redisClient = require('../config/redis');

module.exports = async (req, res, next) => {
    let token = req.headers['authorization'];
    if (!token)
        throw new BusinessException(c.CODE_ERROR_AUTH, constants.HTTP_UNATHORIZED);

    token = verifyJwtToken(token);
    if (token === '')
        throw new BusinessException(c.CODE_ERROR_AUTH, constants.HTTP_UNATHORIZED);

    try {
        const exists = await validateToken(token);
        if (!exists)
            throw new BusinessException(c.CODE_ERROR_AUTH, constants.HTTP_UNATHORIZED);

        // Lazy require: avoids a load-order cycle (service → repository → shared).
        require('../../src/services/clientVersion.service').recordClientVersion(req);

        next();
    } catch (err) {
        logger.error(`Error validating token: ${err}`, { className: filename });
        throw new BusinessException(c.CODE_ERROR_AUTH, constants.HTTP_UNATHORIZED);
    }
};

async function validateJwtSocketConnection(socket, next) {
    try {
        let token =
            socket.handshake.auth?.token ||
            socket.handshake.headers?.authorization || 
            socket.handshake.query?.token; 

        if (!token) throw new BusinessException(constants.CODE_ERROR_AUTH, constants.HTTP_UNATHORIZED);

        const tokenVerified = verifyJwtToken(token);
        if (!tokenVerified) throw new BusinessException(constants.CODE_ERROR_AUTH, constants.HTTP_UNATHORIZED);

        const userId = getValueFromJwtToken(tokenVerified, 'id', false);

        const exists = await validateToken(tokenVerified);
        if (!exists)
            throw new BusinessException(c.CODE_ERROR_AUTH, constants.HTTP_UNATHORIZED);

        socket.userId = userId;
        socket.token = token;

        await redis.sAdd(`${consCache.REDIS_KEY_USER_SOCKETS}${userId}`, socket.id);

        next();
    } catch (err) {
        const message = err.message;
        next(new BaseResponse(false, message));
    }
}

async function validateToken(token) {
    try {
        const tokenConcat = consCache.REDIS_KEY_ACCESS_TOKEN + token;
        const exists = await redisClient.exists(tokenConcat);
        return exists === 1;
    } catch (err) {
        logger.error(`Error validating or refreshing token: ${err}`, { className: filename });
        return false;
    }
}

module.exports.validateJwtSocketConnection = validateJwtSocketConnection;