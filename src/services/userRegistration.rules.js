/**
 * Registration — pure builders (unit-tested, no DB). Legacy clients (no intents)
 * get exactly what they had before plus the intents/openToDating the backfill gives.
 */
const Intents = require('../../shared/util/intents');
const Intent = require('../enums/EnumIntent');

/** Only the fields each register step may set (new Kultura fields are optional). */
const buildRegisterUserInfo = (userInfo = {}) => {
    const info = {
        fullName: userInfo.fullName,
        birthdate: userInfo.birthdate,
        gender: userInfo.gender,
        sexualOrientation: userInfo.sexualOrientation,
    };
    if (userInfo.languages) info.languages = userInfo.languages;
    if (userInfo.learningLanguages) info.learningLanguages = userInfo.learningLanguages;
    if (userInfo.interests) info.interests = userInfo.interests;
    return info;
};

/** Legacy clients (no intents) get the intents the backfill would give them. */
const buildRegisterPreferences = (preferences = {}) => ({
    preferences: preferences.preferences || [],
    lookingFor: preferences.lookingFor,
    intents: preferences.intents ? Intents.normalizeIntents(preferences.intents) : Intents.legacyIntentsFor(preferences.lookingFor)
});

/**
 * openToDating: explicit value from the client, else (legacy) true when the user has a dating profile.
 * New clients that send intents without 'dating' start with it off.
 */
const buildRegisterProfileConfig = (body) => {
    const profileConfig = { ...(body.profileConfig || {}) };
    const intents = body.preferences?.intents;
    // Multipart bodies carry booleans as strings.
    if (profileConfig.openToDating === 'true' || profileConfig.openToDating === 'false') {
        profileConfig.openToDating = profileConfig.openToDating === 'true';
    }
    if (typeof profileConfig.openToDating === 'boolean') {
        profileConfig.openToDatingUpdatedAt = new Date();
    } else if (intents) {
        profileConfig.openToDating = Intents.normalizeIntents(intents).includes(Intent.DATING);
        profileConfig.openToDatingUpdatedAt = new Date();
    } else {
        profileConfig.openToDating = Intents.legacyIntentsFor(body.preferences?.lookingFor).includes(Intent.DATING);
    }
    return profileConfig;
};

module.exports = { buildRegisterUserInfo, buildRegisterPreferences, buildRegisterProfileConfig };
