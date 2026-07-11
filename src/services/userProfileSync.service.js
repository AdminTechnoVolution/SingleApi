const { isDeepStrictEqual } = require('util');
const UserRepository = require('../repository/user.repository');

const resolveEffectiveLocation = (user, hasActiveSubscription) => {
    let effectiveLocation = user.location;

    if (hasActiveSubscription && user.profileConfig?.passportModeEnabled === true && user.profileConfig.passportModeLocation) {
        effectiveLocation = user.profileConfig.passportModeLocation;
    }

    return effectiveLocation;
}

const syncUserPassportAndEffectiveLocationByUserId = async (userId, hasActiveSubscription) => {
    const user = await UserRepository.findOneByFilter({ _id: userId });
    if (!user) return null;

    if (!user.profileConfig) {
        user.profileConfig = {};
    }

    let mustSave = false;

    if (!hasActiveSubscription && user.profileConfig.passportModeEnabled === true) {
        user.profileConfig.passportModeEnabled = false;
        mustSave = true;
    }

    const targetEffectiveLocation = resolveEffectiveLocation(user, hasActiveSubscription);
    if (!isDeepStrictEqual(user.effectiveLocation, targetEffectiveLocation)) {
        user.effectiveLocation = targetEffectiveLocation;
        mustSave = true;
    }

    if (mustSave) {
        await user.save();
    }

    return {
        user,
        hasActiveSubscription
    };
}

module.exports = { syncUserPassportAndEffectiveLocationByUserId };