/**
 * Creates the app-version config entries if they do not exist yet (never
 * overwrites values you already set). Usage: node scripts/seed-version-configs.js
 *
 *   ANDROID_MIN_VERSION_CODE                 0  → no forced update (raise to block old builds)
 *   ANDROID_LATEST_VERSION_CODE            107  → newer builds show a soft "update available"
 *   ANDROID_QUICK_MESSAGES_MIN_VERSION_CODE 107 → first build that shows quick messages
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Config = require('../src/models/config.model');

const entries = [
    { key: 'ANDROID_MIN_VERSION_CODE', value: 0, description: 'Android builds below this versionCode must update (0 = disabled).' },
    { key: 'ANDROID_LATEST_VERSION_CODE', value: 107, description: 'Latest Android versionCode on Play; older builds get a soft update prompt (0 = disabled).' },
    { key: 'ANDROID_QUICK_MESSAGES_MIN_VERSION_CODE', value: 107, description: 'First Android versionCode that displays quick messages; older apps get a like push instead.' },
    { key: 'WEB_MIN_VERSION_CODE', value: 0, description: 'PWA builds below this must reload/update (0 = disabled).' },
    { key: 'WEB_LATEST_VERSION_CODE', value: 200, description: 'Latest PWA build number.' },
    { key: 'WEB_QUICK_MESSAGES_MIN_VERSION_CODE', value: 200, description: 'First PWA build that displays quick messages; older builds get a like push instead.' },
    { key: 'BLIND_DATE_ROOMS_PER_DAY', value: 10, description: 'Blind-date rooms a Premium user can create per day.' }
];

(async () => {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error('Set MONGO_URI (or MONGODB_URI) in .env');
    await mongoose.connect(uri);
    for (const { key, value, description } of entries) {
        const result = await Config.updateOne(
            { key },
            { $setOnInsert: { _id: key, key, value, description } },
            { upsert: true }
        );
        console.log(`${key}: ${result.upsertedCount ? `created (${value})` : 'already exists, left unchanged'}`);
    }
    await mongoose.disconnect();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
