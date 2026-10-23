const mongoose = require('mongoose');
const { Schema } = mongoose;

const configSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  key: { type: String, required: true, unique: true, uppercase: true },
  description: { type: String },
  value: { type: Schema.Types.Mixed, required: true }
}, {
  versionKey: false
});

module.exports = mongoose.model('Config', configSchema, 'configs');
