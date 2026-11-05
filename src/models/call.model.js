const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A 1:1 voice/video call between two matched users (chatId === matchId).
 *
 * status: ringing → accepted → ended
 *         ringing → declined (callee) | cancelled (caller) | missed (nobody answered)
 */
const callSchema = new Schema({
  chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true },
  caller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  callee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['audio', 'video'], required: true },
  status: { type: String, enum: ['ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended'], default: 'ringing' },
  created_at: { type: Date, default: Date.now },
  answered_at: { type: Date },
  ended_at: { type: Date },
  endedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  // Call history is kept for a month, then purged.
  expires_at: { type: Date, required: true }
}, { versionKey: false });

callSchema.index({ caller: 1, status: 1 });
callSchema.index({ callee: 1, status: 1 });
callSchema.index({ chatId: 1, created_at: -1 });
callSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Call', callSchema, 'calls');
