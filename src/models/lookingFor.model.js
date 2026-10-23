const mongoose = require('mongoose');

const languageSchema = new mongoose.Schema({
  iso6391: { type: String, required: true },
  name: { type: String, required: true },
  desc: { type: String }
}, { _id: false });

const lookingForSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  language: { type: [languageSchema], required: true },
  status: { type: String, enum: ['A', 'I'], default: 'A' }
}, {
  versionKey: false
});

lookingForSchema.index({ "status": 1 });

module.exports = mongoose.model('LookingFor', lookingForSchema, 'lookingFor');
