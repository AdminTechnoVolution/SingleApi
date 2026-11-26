/**
 * Kultura backfill: gives every existing user intents + openToDating.
 *
 *   intents      (missing/empty) → ['friends'] when lookingFor == '5' ("New friends or chats"), else ['dating']
 *   openToDating (missing)       → intents.includes('dating')
 *
 * Never overwrites values that are already set (safe to re-run).
 * DRY-RUN by default: only counts. Pass --apply to write.
 *
 *   node scripts/backfill-user-intents.js           # dry run
 *   node scripts/backfill-user-intents.js --apply   # writes
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Intent = require('../src/enums/EnumIntent');
const { LOOKING_FOR_FRIENDS_ID } = require('../shared/util/intents');

const noIntents = { $or: [{ 'preferences.intents': { $exists: false } }, { 'preferences.intents': { $size: 0 } }] };

/** Ordered steps (pure, unit-tested). Intents first: openToDating is derived from them. */
const buildBackfillSteps = () => [
    {
        name: `intents=['${Intent.FRIENDS}'] (lookingFor=${LOOKING_FOR_FRIENDS_ID})`,
        filter: { ...noIntents, 'preferences.lookingFor': LOOKING_FOR_FRIENDS_ID },
        update: { $set: { 'preferences.intents': [Intent.FRIENDS] } }
    },
    {
        name: `intents=['${Intent.DATING}'] (any other lookingFor)`,
        filter: { ...noIntents, 'preferences.lookingFor': { $ne: LOOKING_FOR_FRIENDS_ID } },
        update: { $set: { 'preferences.intents': [Intent.DATING] } }
    },
    {
        name: 'openToDating=true (intents include dating)',
        filter: { 'profileConfig.openToDating': { $exists: false }, 'preferences.intents': Intent.DATING },
        update: { $set: { 'profileConfig.openToDating': true } }
    },
    {
        name: 'openToDating=false (intents without dating)',
        filter: { 'profileConfig.openToDating': { $exists: false }, 'preferences.intents': { $ne: Intent.DATING } },
        update: { $set: { 'profileConfig.openToDating': false } }
    }
];

async function backfillUserIntents({ apply }) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGO_URI is required');
    await mongoose.connect(uri);
    const users = mongoose.connection.collection('users');
    console.log(apply ? 'APPLY mode: writing changes' : 'DRY RUN (pass --apply to write)');
    for (const step of buildBackfillSteps()) {
        if (apply) {
            const result = await users.updateMany(step.filter, step.update);
            console.log(`${step.name}: updated ${result.modifiedCount}`);
        } else {
            console.log(`${step.name}: would update ${await users.countDocuments(step.filter)}`);
        }
    }
}

if (require.main === module) {
    backfillUserIntents({ apply: process.argv.includes('--apply') })
        .catch(error => {
            console.error('Could not backfill user intents', error);
            process.exitCode = 1;
        })
        .finally(() => mongoose.disconnect());
}

module.exports = { buildBackfillSteps };
