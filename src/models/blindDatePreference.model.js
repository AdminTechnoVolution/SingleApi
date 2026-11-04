const mongoose = require('mongoose');
const { Schema } = mongoose;

/** Last filters a user chose when creating a blind-date room (pre-selected next time). */
const blindDatePreferenceSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    conditions: {
        genders: { type: [String], default: [] },
        ageMin: { type: Number, default: 18 },
        ageMax: { type: Number, default: 99 },
        languages: { type: [String], default: [] },
        musicGenres: { type: [String], default: [] },
        lookingFor: { type: [String], default: [] }
    },
    updated_at: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('BlindDatePreference', blindDatePreferenceSchema, 'blindDatePreferences');
