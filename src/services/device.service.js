const BaseResponse = require('../../shared/util/baseResponse');
const jwtUtil = require('../../shared/util/jwt');
const FCMToken = require('../models/fcmToken.model');
const FCMTokenRepository = require('../repository/fcmToken.repository');

const registerPushToken = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers.authorization, 'id');
    const token = req.body.token;
    let record = await FCMTokenRepository.findOneByFilter({ userId });
    if (!record) record = new FCMToken({ userId, fcmTokens: [] });
    if (!record.fcmTokens.includes(token)) {
        record.fcmTokens.push(token);
        await FCMTokenRepository.save(record);
    }
    return new BaseResponse(true, [], { registered: true });
};

const removePushToken = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers.authorization, 'id');
    await FCMTokenRepository.findOneByFilterAndPullToken(
        { userId },
        { fcmTokens: req.body.token }
    );
    return new BaseResponse(true, [], { registered: false });
};

module.exports = { registerPushToken, removePushToken };
