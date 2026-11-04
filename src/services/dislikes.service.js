const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const jwtUtil = require('../../shared/util/jwt');
const UserRepository = require('../repository/user.repository');
const DislikesRepository = require('../repository/dislikes.repository');
const QuickMessageRepository = require('../repository/quickMessage.repository');
const Dislikes = require('../models/dislikes.model');
const AppVersion = require('../../shared/util/appVersion');
const LikeRepository = require('../repository/likes.repository');
const ObjectId = require('mongoose').Types.ObjectId;
const ttlRecordDislikeSecs = process.env.RECORD_DISLIKE_TTL_SECS;

const sendDislike = async (req) => {
    let token = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(token, 'id');
    let body = req.body;
    await validateSendDislike(body, userId);

    const dislikeFound = await DislikesRepository.findByAnyFilter({ fromUserId: userId, toUserId: body.toUserId });

    const explicit = AppVersion.sendsExplicitDislikes(AppVersion.parseClientVersion(req.headers));

    if (!dislikeFound || (Array.isArray(dislikeFound) && dislikeFound.length === 0)) {
        let dislike = new Dislikes({
            fromUserId: userId,
            toUserId: body.toUserId,
            expires_at: new Date(Date.now() + (ttlRecordDislikeSecs * 1000)),
            explicit
        });

        await DislikesRepository.save(dislike);
    } else if (explicit) {
        // An old swipe-dislike becomes explicit (and gets a fresh TTL) when the user taps ✕.
        await Dislikes.updateMany(
            { fromUserId: new ObjectId(userId), toUserId: new ObjectId(body.toUserId) },
            { $set: { explicit: true, expires_at: new Date(Date.now() + (ttlRecordDislikeSecs * 1000)) } }
        );
    }

    // Like and dislike are exclusive: disliking withdraws my pending like.
    await LikeRepository.deleteManyByFilter({ fromUserId: new ObjectId(userId), toUserId: new ObjectId(body.toUserId) });

    // Passing on someone also clears any quick message they sent you.
    await QuickMessageRepository.deleteManyByFilter({ fromUserId: body.toUserId, toUserId: userId });

    message = c.CODE_SUCCESS;
    return new BaseResponse(true, [message]);
};

const validateSendDislike = async (body, userId) => {
    if (body.toUserId === userId) throw new BusinessException(c.CODE_ERROR_USER_CANNOT_DISLIKE_SELF);

    const existingToUser = await UserRepository.findOneByFilter({ _id: body.toUserId, status: constants.STATUS_DESC_ACTIVE });
    if (!existingToUser) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);
};

module.exports = { sendDislike };
