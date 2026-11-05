const mongoose = require('mongoose');
const { Schema } = mongoose;

const dislikesSchema = new mongoose.Schema({
  fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  created_at: { type: Date, default: Date.now },
  expires_at: { type: Date },
  // true = the user tapped ✕ (new app). Legacy swipe-dislikes stay false and are
  // never shown as "disliked" in discover.
  explicit: { type: Boolean, default: false }
}, {
  versionKey: false
});

dislikesSchema.index({ "fromUserId": 1 });
dislikesSchema.index({ "toUserId": 1 });
dislikesSchema.index({ "fromUserId": 1, "toUserId": 1 });
dislikesSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });


module.exports = mongoose.model('Dislikes', dislikesSchema, 'dislikes');