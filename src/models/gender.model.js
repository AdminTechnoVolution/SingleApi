const mongoose = require('mongoose');

const languageSchema = new mongoose.Schema({
  iso6391: { type: String, required: true },
  name: { type: String, required: true },
  desc: { type: String }
}, { _id: false });

const genderSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  language: { type: [languageSchema], required: true },
  status: { type: String, enum: ['A', 'I'], default: 'A' }
}, {
  versionKey: false
});

genderSchema.index({ "status": 1 });

module.exports = mongoose.model('Gender', genderSchema, 'genders');
