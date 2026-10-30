const mongoose = require('mongoose');
const AuthType = require('../enums/EnumAuthType');
const Platform = require('../enums/EnumPlatform');

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
  sexualOrientation: { type: String, ref: 'SexualOrientation', required: true },
  biography: { type: String, maxlength: 500 },
  height: { type: Number },
  zodiacSign: { type: String, ref: 'ZodiacSign' },
  languages: [{ type: String, ref: 'Language' }],
  familyPlans: { type: String, ref: 'FamilyPlan' }
}, { _id: false });

const preferencesSchema = new mongoose.Schema({
  preferences: [{ type: String, ref: 'Gender', required: true }],
  lookingFor: { type: String, ref: 'LookingFor', required: true }
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
  preferredDistanceUnit: { type: String, enum: ['KM', 'MI'], default: 'KM' }
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
userSchema.index({ "status": 1 });
userSchema.index({ "location.coordinates": "2dsphere" });
userSchema.index({ "effectiveLocation.coordinates": "2dsphere" });
userSchema.index({ "profileConfig.passportModeLocation.coordinates": "2dsphere" });

module.exports = mongoose.model('User', userSchema, 'users');