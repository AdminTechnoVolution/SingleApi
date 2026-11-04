const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const BaseResponse = require('../../shared/util/baseResponse');
const constants = require('../../shared/util/constants');
const { getValueFromJwtToken } = require('../../shared/util/jwt');
const {
    parseClientVersion,
    supportsQuickMessages,
    buildVersionPolicy,
    configNumber,
    DEFAULT_QUICK_MESSAGES_MIN_VERSION_CODE
} = require('../../shared/util/appVersion');
const ConfigService = require('./config.service');
const UserRepository = require('../repository/user.repository');

/** userId → "platform:versionCode" last written, to avoid a DB write per request. */
const lastRecorded = new Map();
const MAX_TRACKED_USERS = 50_000;

/**
 * Fire-and-forget from validateToken: remembers which client version each user
 * last used. Only writes when the version changes (per process).
 */
const recordClientVersion = (req) => {
    const { versionCode, platform } = parseClientVersion(req.headers);
    if (versionCode === null || platform === null) return; // legacy client: nothing to record

    const userId = getValueFromJwtToken(req.headers['authorization'], 'id');
    if (!userId) return;

    const signature = `${platform}:${versionCode}`;
    if (lastRecorded.get(userId) === signature) return;
    if (lastRecorded.size >= MAX_TRACKED_USERS) lastRecorded.clear();
    lastRecorded.set(userId, signature);

    UserRepository.findByIdAndUpdate(userId, {
        clientInfo: { platform, appVersionCode: versionCode, updated_at: new Date() }
    }).catch((err) => {
        lastRecorded.delete(userId);
        logger.error(`Error recording client version for ${userId}: ${err}`, { className: filename });
    });
};

/** GET /api/app/version-policy — public, also used before login. */
const getVersionPolicy = async (req) => {
    const configs = (await ConfigService.getConfigs()).data;
    return new BaseResponse(true, [], buildVersionPolicy(configs, parseClientVersion(req.headers)));
};

/** Whether the recipient's app can show quick messages (else fall back to a like push). */
const userSupportsQuickMessages = async (userId) => {
    const user = await UserRepository.findById(userId, 'clientInfo');
    const configs = (await ConfigService.getConfigs()).data;
    const minVersion = configNumber(configs, constants.ANDROID_QUICK_MESSAGES_MIN_VERSION_CODE, DEFAULT_QUICK_MESSAGES_MIN_VERSION_CODE);
    return supportsQuickMessages(user?.clientInfo, minVersion);
};

module.exports = { recordClientVersion, getVersionPolicy, userSupportsQuickMessages };
