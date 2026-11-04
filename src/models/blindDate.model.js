const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A blind-date room: a Premium host waits for ONE compatible Premium guest,
 * then both talk in a voice-only WebRTC call.
 *
 * status: open → matched (guest claimed it, atomically) → in_call → ended
 *         open → cancelled (host left) | expired (TTL, nobody came)
 */
const conditionsSchema = new Schema({
  genders: [{ type: String, ref: 'Gender' }],
  ageMin: { type: Number, min: 18, max: 99 },
  ageMax: { type: Number, min: 18, max: 99 },
  languages: [{ type: String, ref: 'Language' }],
  musicGenres: [{ type: String, ref: 'MusicGenre' }],
  lookingFor: [{ type: String, ref: 'LookingFor' }]
}, { _id: false });

const blindDateSchema = new Schema({
  hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  hostName: { type: String, required: true },
  hostGender: { type: String, ref: 'Gender' },
  conditions: { type: conditionsSchema, default: () => ({}) },
  status: { type: String, enum: ['open', 'matched', 'in_call', 'ended', 'cancelled', 'expired'], default: 'open' },
  guestId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  matched_at: { type: Date },
  call_started_at: { type: Date },
  ended_at: { type: Date },
  endedReason: { type: String },
  hostWantsMatch: { type: Boolean },
  guestWantsMatch: { type: Boolean },
  // 'creating' while one request builds the match (guards double creation), then 'done'.
  matchState: { type: String, enum: ['creating', 'done'] },
  chatId: { type: Schema.Types.ObjectId, ref: 'Chat' },
  created_at: { type: Date, default: Date.now },
  // Rooms are kept for a day (history, reports, post-call match) then purged.
  expires_at: { type: Date, required: true }
}, { versionKey: false });

blindDateSchema.index({ status: 1, created_at: -1 });
// One live room per host at a time.
blindDateSchema.index({ hostId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['open', 'matched', 'in_call'] } } });
blindDateSchema.index({ guestId: 1, status: 1 });
blindDateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('BlindDate', blindDateSchema, 'blindDates');
