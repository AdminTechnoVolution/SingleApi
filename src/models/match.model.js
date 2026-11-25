const mongoose = require('mongoose');
const { Schema } = require("mongoose");
const MatchStatus = require('../enums/EnumMatchStatus');
const Intent = require('../enums/EnumIntent');

const matchSchema = new mongoose.Schema({
  users: [{ type: Schema.Types.ObjectId, ref: "User" }],
  status: { type: String, enum: Object.values(MatchStatus), default: MatchStatus.MATCHED, lowercase: true },
  lastUpdatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  // Kultura: why this connection exists (absent = legacy dating match).
  intent: { type: String, enum: Object.values(Intent) },
  /**
   * Kultura "Next level": each participant's private wish, keyed by userId string
   * (Map like chat.unreadCounts). unlockedAt is set once, when both want it.
   * A participant's wish is never returned to the other one before unlock.
   */
  nextLevel: {
    type: new mongoose.Schema({
      users: { type: Map, of: Boolean, default: {} },
      unlockedAt: { type: Date }
    }, { _id: false })
  },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, {
  versionKey: false
});

matchSchema.index({ "users.0": 1, "users.1": 1 });
matchSchema.index({ "status": 1 });

module.exports = mongoose.model('Match', matchSchema, 'matches');