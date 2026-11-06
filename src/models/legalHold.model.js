const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Evidence kept when an account is deleted while it is involved in a child-safety
 * (CSAM/CSAE) report. Everything else of the account is wiped immediately; this
 * record is the only copy left and exists solely to assist law enforcement.
 * It is never read by the app and must be purged manually once the case is closed.
 */
const legalHoldSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, unique: true },
  reason: { type: String, required: true },
  user: { type: Schema.Types.Mixed },
  reports: { type: [Schema.Types.Mixed], default: [] },
  messages: { type: [Schema.Types.Mixed], default: [] },
  photoBlobNames: { type: [String], default: [] },
  created_at: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('LegalHold', legalHoldSchema, 'legalHolds');
