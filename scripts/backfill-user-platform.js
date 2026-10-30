require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/user.model');
const Platform = require('../src/enums/EnumPlatform');

async function backfillUserPlatform() {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

    await mongoose.connect(process.env.MONGO_URI);
    const result = await User.updateMany(
        { platform: { $exists: false } },
        { $set: { platform: Platform.ANDROID } }
    );
    console.log(`Set platform=Android on ${result.modifiedCount} existing users`);
}

backfillUserPlatform()
    .catch(error => {
        console.error('Could not backfill user platforms', error);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
