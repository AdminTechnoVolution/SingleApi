const mongoose = require('mongoose');
const AuthType = require('../enums/EnumAuthType');
const Platform = require('../enums/EnumPlatform');
const Intent = require('../enums/EnumIntent');

const locationSchema = new mongoose.Schema({
  coordinates: { type: [Number], required: true },
  country: { type: String },
  city: { type: String }
}, { _id: false });

const photoSizeSchema = new mongoose.Schema({
  size: { type: String, required: true },
  name: { type: String, required: true },
  url: { type: String, required: true }
}, { _id: false });

const photoSchema = new mongoose.Schema({
  isProfile: { type: Boolean, required: true, default: false },
  path: { type: String, required: true },
  sizes: { type: [photoSizeSchema] },
}, { _id: false });

const musicPreferencesSchema = new mongoose.Schema({
  favoriteAnthem: { type: String },
  topArtist: [{ type: String, ref: 'Artist' }],
  musicGenres: [{ type: String, ref: 'MusicGenre' }]
}, { _id: false });

const lifestyleSchema = new mongoose.Schema({
  diet: { type: String, ref: 'DietHabit' },
  exercise: { type: String, ref: 'ExerciseHabit' },
  smoking: { type: String, ref: 'SmokingHabit' },
  drinking: { type: String, ref: 'DrinkingHabit' },
}, { _id: false });

const userInfoSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  birthdate: { type: Date, required: true },
  gender: { type: String, ref: 'Gender', required: true },
  // Required by the validators only for dating profiles (legacy clients or intents incl. 'dating').
  sexualOrientation: { type: String, ref: 'SexualOrientation' },
  biography: { type: String, maxlength: 500 },
  height: { type: Number },
  zodiacSign: { type: String, ref: 'ZodiacSign' },
  languages: [{ type: String, ref: 'Language' }],
  // Kultura: languages the user wants to practice.
  learningLanguages: [{ type: String, ref: 'Language' }],
  // Kultura: conversation topics (master collection 'interests').
  interests: [{ type: String, ref: 'Interest' }],
  familyPlans: { type: String, ref: 'FamilyPlan' }
}, { _id: false });

const preferencesSchema = new mongoose.Schema({
  // Dating fields: required by the validators only for dating profiles.
  preferences: [{ type: String, ref: 'Gender', required: true }],
  lookingFor: { type: String, ref: 'LookingFor' },
  // Kultura: friends | language_exchange | dating. Empty/absent = legacy user (treated as dating).
  intents: [{ type: String, enum: Object.values(Intent) }]
}, { _id: false });

const profileConfigSchema = new mongoose.Schema({
  showGenderInProfile: { type: Boolean, default: true },
  passportModeEnabled: { type: Boolean, default: false },
  passportModeLocation: { type: locationSchema },
  preferredLanguage: { type: String, ref: "Language" },
  maximumDistance: { type: Number, default: 1000000 },
  ageRange: {
    min: { type: Number },
    max: { type: Number }
  },
  preferredHeightUnit: { type: String, enum: ['CM', 'FT'], default: 'CM' },
  preferredDistanceUnit: { type: String, enum: ['KM', 'MI'], default: 'KM' },
  // Kultura "Open to something more": unlocks dating features (Next level, dating rooms/discover).
  openToDating: { type: Boolean, default: false },
  // Set server-side whenever the client explicitly sets openToDating (tells an opt-out from legacy data).
  openToDatingUpdatedAt: { type: Date }
}, { _id: false });

const authSchema = new mongoose.Schema({
  method: { type: String, enum: Object.values(AuthType), required: true, lowercase: true },
  socialId: { type: String, required: true },
  isVerified: { type: Boolean, default: false }
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, trim: true },
  password: { type: String, required: false },
  auth: { type: authSchema, required: false },
  userInfo: { type: userInfoSchema, required: true },
  preferences: { type: preferencesSchema, required: true },
  location: { type: locationSchema },
  effectiveLocation: { type: locationSchema },
  photos: { type: [photoSchema] },
  lifestyle: { type: lifestyleSchema },
  musicPreferences: { type: musicPreferencesSchema },
  profileConfig: { type: profileConfigSchema },
  platform: { type: String, enum: Object.values(Platform), default: Platform.ANDROID },
  // Last client version seen on an authenticated request (absent = legacy app).
  clientInfo: {
    type: new mongoose.Schema({
      platform: { type: String },
      appVersionCode: { type: Number },
      updated_at: { type: Date }
    }, { _id: false })
  },
  // Last time the user used the app. Set server-side when the user opens Discover (userActivity.service).
  lastActivityAt: { type: Date },
  status: { type: String, enum: ['active', 'inactive', 'deleting'], default: 'active', lowercase: true },
  created_at: { type: Date, default: Date.now }
}, {
  versionKey: false
});

userSchema.index({ "email": 1 }, { unique: true });
userSchema.index({ "platform": 1 });
userSchema.index({ "userInfo.gender": 1 });
userSchema.index({ "userInfo.birthdate": 1 });
userSchema.index({ "userInfo.sexualOrientation": 1 });
userSchema.index({ "preferences.lookingFor": 1 });
userSchema.index({ "preferences.intents": 1 });
userSchema.index({ "userInfo.languages": 1 });
userSchema.index({ "userInfo.learningLanguages": 1 });
userSchema.index({ "profileConfig.openToDating": 1 });
userSchema.index({ "status": 1 });
userSchema.index({ "lastActivityAt": -1 });
userSchema.index({ "location.coordinates": "2dsphere" });
userSchema.index({ "effectiveLocation.coordinates": "2dsphere" });
userSchema.index({ "profileConfig.passportModeLocation.coordinates": "2dsphere" });

module.exports = mongoose.model('User', userSchema, 'users');