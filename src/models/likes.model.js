const mongoose = require('mongoose');
const { Schema } = mongoose;

const likesSchema = new mongoose.Schema({
  fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  // Kultura: feed the like came from (absent = legacy dating like).
  intent: { type: String, enum: Object.values(require('../enums/EnumIntent')) },
  created_at: { type: Date, default: Date.now }
}, {
  versionKey: false
});

likesSchema.index({ "fromUserId": 1 });
likesSchema.index({ "toUserId": 1 });
likesSchema.index({ "fromUserId": 1, "created_at": 1 });
likesSchema.index({ "fromUserId": 1, "toUserId": 1 }, { unique: true });

module.exports = mongoose.model('Likes', likesSchema, 'likes');