const ObjectId = require("mongoose").Types.ObjectId;

/**
 * Aggregation for "quick messages received". Side-effect free so it can be
 * unit-tested. When `canRead` is false the text never leaves MongoDB.
 */
const buildReceivedPipeline = (userId, cursor, canRead, limit) => {
    const match = { toUserId: new ObjectId(userId) };
    // Newest first, so the next page holds strictly older ids.
    if (cursor && ObjectId.isValid(cursor)) match._id = { $lt: new ObjectId(cursor) };

    return [
        { $match: match },
        { $sort: { _id: -1 } },
        { $limit: limit },
        { $lookup: { from: "users", localField: "fromUserId", foreignField: "_id", as: "users" } },
        { $unwind: "$users" },
        {
            $project: {
                _id: 1,
                created_at: 1,
                content: canRead ? "$content" : { $literal: null },
                locked: { $literal: !canRead },
                "user._id": "$users._id",
                "user.fullName": "$users.userInfo.fullName",
                "user.photos": {
                    $filter: { input: "$users.photos", as: "photo", cond: { $eq: ["$$photo.isProfile", true] } }
                }
            }
        }
    ];
};

module.exports = { buildReceivedPipeline };
