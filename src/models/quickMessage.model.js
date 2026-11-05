const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Premium "quick message": a short note a subscriber sends together with a like,
 * before there is a match. One per sender → recipient pair. Moved into the chat
 * conversation (and deleted here) as soon as the pair matches.
 */
const quickMessageSchema = new mongoose.Schema({
  fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  content: { type: String, required: true, trim: true, maxlength: 280 },
  created_at: { type: Date, default: Date.now }
}, {
  versionKey: false
});

quickMessageSchema.index({ "toUserId": 1, "_id": -1 });
quickMessageSchema.index({ "fromUserId": 1, "toUserId": 1 }, { unique: true });

module.exports = mongoose.model('QuickMessage', quickMessageSchema, 'quickMessages');
