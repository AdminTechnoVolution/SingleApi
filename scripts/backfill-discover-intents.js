/**
 * Kultura backfill: stores profileConfig.discoverIntents (the discover feeds a user appears in)
 * for every user that has none, as all of them: ['language_exchange', 'friends', 'dating'].
 *
 * Absent/empty already means "all" for discover, so this only makes the default explicit.
 * "No quiero citas" (Android) will later save it without 'dating'.
 *
 * Never overwrites a value that is already set (safe to re-run).
 * DRY-RUN by default: only counts. Pass --apply to write.
 *
 *   node scripts/backfill-discover-intents.js           # dry run
 *   node scripts/backfill-discover-intents.js --apply   # writes
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Intent = require('../src/enums/EnumIntent');

const ALL_INTENTS = [Intent.LANGUAGE_EXCHANGE, Intent.FRIENDS, Intent.DATING];

/** Pure, unit-tested. */
const buildBackfillStep = () => ({
    name: `discoverIntents=${JSON.stringify(ALL_INTENTS)} (missing/empty)`,
    filter: { $or: [{ 'profileConfig.discoverIntents': { $exists: false } }, { 'profileConfig.discoverIntents': { $size: 0 } }] },
    update: { $set: { 'profileConfig.discoverIntents': ALL_INTENTS } }
});

async function backfillDiscoverIntents({ apply }) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGO_URI is required');
    await mongoose.connect(uri);
    const users = mongoose.connection.collection('users');
    const step = buildBackfillStep();
    console.log(apply ? 'APPLY mode: writing changes' : 'DRY RUN (pass --apply to write)');
    if (apply) {
        const result = await users.updateMany(step.filter, step.update);
        console.log(`${step.name}: updated ${result.modifiedCount}`);
    } else {
        console.log(`${step.name}: would update ${await users.countDocuments(step.filter)}`);
    }
}

if (require.main === module) {
    backfillDiscoverIntents({ apply: process.argv.includes('--apply') })
        .catch(error => {
            console.error('Could not backfill discover intents', error);
            process.exitCode = 1;
        })
        .finally(() => mongoose.disconnect());
}

module.exports = { buildBackfillStep, ALL_INTENTS };
