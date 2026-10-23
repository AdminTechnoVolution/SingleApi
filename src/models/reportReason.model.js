const mongoose = require('mongoose');

const languageSchema = new mongoose.Schema({
  iso6391: { type: String, required: true },
  name: { type: String, required: true },
  desc: { type: String }
}, { _id: false });

const reportReasonSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  language: { type: [languageSchema], required: true },
  severity: { type: Number, required: true, min: 1, max: 10 },
  status: { type: String, enum: ['A', 'I'], default: 'A' }
}, {
  versionKey: false
});

reportReasonSchema.index({ "status": 1 });

module.exports = mongoose.model('ReportReason', reportReasonSchema, 'reportReasons');
