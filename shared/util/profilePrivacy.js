/**
 * Kultura privacy for profiles shown to OTHER users: whether someone is open to dating
 * is never exposed (it would reveal it before a mutual "Next level" unlock).
 * Pure aggregation stages, used by discover and GET /api/user/:userId.
 */
const hideDatingSignalsStages = () => [
    {
        $addFields: {
            'preferences.intents': { $setDifference: [{ $ifNull: ['$preferences.intents', []] }, ['dating']] }
        }
    },
    { $project: { 'profileConfig.openToDating': 0, 'profileConfig.openToDatingUpdatedAt': 0 } }
];

module.exports = { hideDatingSignalsStages };
