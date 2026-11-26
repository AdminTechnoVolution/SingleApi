const test = require('node:test');
const assert = require('node:assert/strict');
const { registerUserSchema, updateUserSchema } = require('../src/validators/user.validator');
const Registration = require('../src/services/userRegistration.rules');
const Intents = require('../shared/util/intents');
const { buildBackfillSteps } = require('../scripts/backfill-user-intents');
const User = require('../src/models/user.model');

const base = {
    email: 'person@example.com',
    password: 'StrongPassword1',
    location: { coordinates: [-75.56, 6.25], country: 'Colombia', city: 'Medellin' }
};

// What the Android app sends today.
const androidBody = {
    ...base,
    userInfo: { fullName: 'Ana María', birthdate: '1995-02-03', gender: 'F', sexualOrientation: 'ST' },
    preferences: { preferences: ['M'], lookingFor: '2' },
    profileConfig: { showGenderInProfile: true }
};

const codes = (result) => (result.error?.details || []).map(detail => detail.message);

test('legacy (Android) registration contract is unchanged', () => {
    assert.equal(registerUserSchema.validate(androidBody).error, undefined);
});

test('legacy clients (no intents) still must send every dating field', () => {
    const missingOrientation = { ...androidBody, userInfo: { ...androidBody.userInfo, sexualOrientation: undefined } };
    assert.deepEqual(codes(registerUserSchema.validate(missingOrientation)), ['sexualOrientation.required']);
    const missingPreferences = { ...androidBody, preferences: { lookingFor: '2' } };
    assert.deepEqual(codes(registerUserSchema.validate(missingPreferences)), ['preferences.required']);
    const missingLookingFor = { ...androidBody, preferences: { preferences: ['M'] } };
    assert.deepEqual(codes(registerUserSchema.validate(missingLookingFor)), ['lookingFor.required']);
});

test('Kultura registration without dating intents needs no dating fields and accepts the new fields', () => {
    const body = {
        ...base,
        userInfo: { fullName: 'Kenji', birthdate: '1994-05-06', gender: 'M', languages: ['3'], learningLanguages: ['2'], interests: ['1', '17'] },
        preferences: { intents: ['language_exchange', 'friends'] },
        profileConfig: { openToDating: false }
    };
    assert.equal(registerUserSchema.validate(body).error, undefined);
});

test('Kultura registration including dating requires the dating fields', () => {
    const body = { ...base, userInfo: { fullName: 'Kenji', birthdate: '1994-05-06', gender: 'M' }, preferences: { intents: ['dating'] } };
    assert.deepEqual(codes(registerUserSchema.validate(body, { abortEarly: false })).sort(),
        ['lookingFor.required', 'preferences.required', 'sexualOrientation.required']);
    const complete = { ...body, userInfo: { ...body.userInfo, sexualOrientation: 'ST' }, preferences: { intents: ['dating', 'friends'], preferences: ['F'], lookingFor: '1' } };
    assert.equal(registerUserSchema.validate(complete).error, undefined);
});

test('intents must be valid, unique and not empty', () => {
    const withIntents = (intents) => ({ ...base, userInfo: { fullName: 'K', birthdate: '1994-05-06', gender: 'M' }, preferences: { intents } });
    assert.ok(registerUserSchema.validate(withIntents(['romance'])).error);
    assert.ok(registerUserSchema.validate(withIntents(['friends', 'friends'])).error);
    assert.ok(registerUserSchema.validate(withIntents([])).error);
});

test('PUT /me accepts the new fields and keeps the legacy shape', () => {
    assert.equal(updateUserSchema.validate({ userInfo: { learningLanguages: ['1'], interests: ['3'] } }).error, undefined);
    assert.equal(updateUserSchema.validate({ preferences: { intents: ['friends'] }, profileConfig: { openToDating: true } }).error, undefined);
    assert.equal(updateUserSchema.validate({ preferences: { lookingFor: '1' } }).error, undefined);
    assert.ok(updateUserSchema.validate({ profileConfig: { openToDating: 'maybe' } }).error);
});

test('legacy registrations get the backfill intents and openToDating', () => {
    assert.deepEqual(Registration.buildRegisterPreferences(androidBody.preferences), { preferences: ['M'], lookingFor: '2', intents: ['dating'] });
    assert.deepEqual(Registration.buildRegisterPreferences({ preferences: ['M'], lookingFor: '5' }).intents, ['friends']);
    const config = Registration.buildRegisterProfileConfig(androidBody);
    assert.equal(config.openToDating, true);
    assert.equal(config.openToDatingUpdatedAt, undefined, 'legacy users are not an explicit opt-in/out');
    assert.equal(config.showGenderInProfile, true);
});

test('Kultura registrations derive openToDating from intents unless sent explicitly', () => {
    const noDating = Registration.buildRegisterProfileConfig({ preferences: { intents: ['friends'] } });
    assert.equal(noDating.openToDating, false);
    assert.ok(noDating.openToDatingUpdatedAt instanceof Date);
    assert.equal(Registration.buildRegisterProfileConfig({ preferences: { intents: ['friends'] }, profileConfig: { openToDating: 'true' } }).openToDating, true);
    assert.deepEqual(Registration.buildRegisterUserInfo({ fullName: 'K', learningLanguages: ['2'], interests: ['1'], extra: 'x' }),
        { fullName: 'K', birthdate: undefined, gender: undefined, sexualOrientation: undefined, learningLanguages: ['2'], interests: ['1'] });
});

test('intent helpers: legacy = dating, iOS defaults to language exchange', () => {
    assert.equal(Intents.requiresDatingProfile(undefined), true);
    assert.equal(Intents.requiresDatingProfile(['friends']), false);
    assert.equal(Intents.requiresDatingProfile(['friends', 'dating']), true);
    assert.deepEqual(Intents.resolveRequestedIntent(undefined, {}), { intent: null, legacy: true });
    assert.deepEqual(Intents.resolveRequestedIntent(undefined, { 'x-app-platform': 'iOS' }), { intent: 'language_exchange', legacy: false });
    assert.deepEqual(Intents.resolveRequestedIntent('friends', { 'x-app-platform': 'android' }), { intent: 'friends', legacy: false });
    assert.equal(Intents.resolveRequestedIntent('romance', {}).invalid, true);
    assert.equal(Intents.resolveMatchIntent(undefined, undefined), undefined);
    assert.equal(Intents.resolveMatchIntent('dating', undefined), 'dating');
    assert.equal(Intents.resolveMatchIntent('dating', 'friends'), 'friends');
    assert.equal(Intents.resolveMatchIntent('friends', 'language_exchange'), 'language_exchange');
});

test('user model: dating fields are no longer mandatory at the schema level and openToDating defaults off', () => {
    assert.notEqual(User.schema.path('userInfo.sexualOrientation').isRequired, true);
    const user = new User({ profileConfig: {} });
    assert.equal(user.profileConfig.openToDating, false);
    assert.ok(User.schema.path('preferences.intents'));
    assert.ok(User.schema.path('userInfo.learningLanguages'));
    assert.ok(User.schema.path('userInfo.interests'));
});

test('backfill never overwrites values and derives openToDating from intents', () => {
    const steps = buildBackfillSteps();
    assert.equal(steps.length, 4);
    assert.deepEqual(steps[0].update, { $set: { 'preferences.intents': ['friends'] } });
    assert.equal(steps[0].filter['preferences.lookingFor'], '5');
    assert.deepEqual(steps[1].update, { $set: { 'preferences.intents': ['dating'] } });
    for (const step of steps.slice(0, 2)) assert.ok(step.filter.$or, 'only users without intents');
    for (const step of steps.slice(2)) assert.deepEqual(step.filter['profileConfig.openToDating'], { $exists: false });
});

test('interest seed is localized in the 6 app languages', () => {
    const interests = require('../scripts/data.interests.json');
    assert.ok(interests.length >= 30);
    for (const interest of interests) {
        assert.deepEqual(interest.language.map(l => l.iso6391), ['en', 'es', 'fr', 'pt', 'it', 'de']);
        assert.equal(interest.status, 'A');
    }
    assert.equal(new Set(interests.map(i => i._id)).size, interests.length);
});
