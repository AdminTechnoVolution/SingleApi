const ObjectId = require("mongoose").Types.ObjectId;
const BaseResponse = require('../../shared/util/baseResponse');
const BasePaginatedResponse = require('../../shared/util/basePaginatedResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const UserRepository = require('../repository/user.repository');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const jwtUtil = require('../../shared/util/jwt');
const DiscoverOrder = require('../../shared/util/discoverOrder');
const limitGetUsersDiscover = Number(process.env.LIMIT_GET_USERS_DISCOVER);
// Nearest N candidates that take part in a round (keeps the id scan bounded).
const discoverMaxCandidates = Number(process.env.DISCOVER_MAX_CANDIDATES) || 1000;

const getUsersDiscover = async (req) => {
    const queryParams = req.query;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    const exclussions = '-password -created_at -status -email';
    const user = await UserRepository.findById(userId, exclussions, false);
    if (!user) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);

    // 1) Ids of every eligible candidate (cheap: _id only).
    const candidates = await UserRepository.findByPipeline(createPipeline(user, { idsOnly: true }));
    const ids = candidates.map(u => u._id.toString());

    // 2) Seeded random page: a new round (no cursor) = a new order.
    const { pageIds, hasMore, nextCursor } = DiscoverOrder.pageOf(ids, queryParams.cursor, limitGetUsersDiscover);

    // 3) Full profiles for that page, returned in the shuffled order.
    let users = [];
    if (pageIds.length > 0) {
        const found = await UserRepository.findByPipeline(createPipeline(user, { pageIds }), true);
        const byId = new Map(found.map(u => [u._id.toString(), u]));
        users = pageIds.map(id => byId.get(id)).filter(Boolean);
    }

    const response = new BasePaginatedResponse(
        users,
        {
            nextCursor,
            pageSize: users.length,
            hasMore
        });

    return new BaseResponse(true, [], response);
};

const createPipeline = (meUser, { idsOnly = false, pageIds = null } = {}) => {
    // Precompute my data
    const myGender = meUser.userInfo?.gender;
    const myPreferences = meUser.preferences?.preferences;
    const myMaxDistance = meUser.profileConfig?.maximumDistance;
    const myAgeRange = meUser.profileConfig?.ageRange;
    const myOriginLocation = meUser.effectiveLocation.coordinates;

    const pipeline = [];

    // Filter by near location
    pipeline.push({
        $geoNear: {
            near: { type: "Point", coordinates: myOriginLocation },
            distanceField: "distance",
            maxDistance: myMaxDistance,
            spherical: true,
            key: "effectiveLocation.coordinates"
        }
    });

    // Exclude me, only active users
    const matchStage = {
        _id: { $ne: new ObjectId(meUser._id) },
        status: constants.STATUS_DESC_ACTIVE
    };

    // Second phase: only the profiles of the requested page
    if (pageIds) {
        matchStage._id = { ...matchStage._id, $in: pageIds.map(id => new ObjectId(id)) };
    }

    pipeline.push({ $match: matchStage });

    // Lookup my like on each profile. Liked profiles are NOT excluded: they keep
    // appearing with `likedByMe: true` so the app shows the heart already marked.
    // Only matched/blocked pairs are excluded (below).
    pipeline.push(
        {
            $lookup: {
                from: "likes",
                let: { targetId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$toUserId", "$$targetId"] },
                                    { $eq: ["$fromUserId", new ObjectId(meUser._id)] }
                                ]
                            }
                        }
                    },
                    { $limit: 1 }
                ],
                as: "likesFromMe"
            }
        },
        {
            $addFields: {
                likedByMe: { $gt: [{ $size: "$likesFromMe" }, 0] }
            }
        }
    );

    // Same for my (non-expired) dislikes: shown again, marked `dislikedByMe`.
    // Only explicit ones (✕ tapped in the new app): legacy swipe-dislikes don't count.
    pipeline.push(
        {
            $lookup: {
                from: "dislikes",
                let: { targetId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$toUserId", "$$targetId"] },
                                    { $eq: ["$fromUserId", new ObjectId(meUser._id)] },
                                    { $eq: ["$explicit", true] }
                                ]
                            }
                        }
                    },
                    { $limit: 1 }
                ],
                as: "dislikesFromMe"
            }
        },
        {
            $addFields: {
                dislikedByMe: { $gt: [{ $size: "$dislikesFromMe" }, 0] }
            }
        },
        // Like and dislike are exclusive. If an old race left both saved, the most
        // recent action wins so the app never shows the heart and the ✕ marked together.
        {
            $addFields: {
                likedByMe: {
                    $and: ["$likedByMe", { $or: [
                        { $not: ["$dislikedByMe"] },
                        { $gte: [{ $arrayElemAt: ["$likesFromMe.created_at", 0] }, { $arrayElemAt: ["$dislikesFromMe.created_at", 0] }] }
                    ] }]
                },
                dislikedByMe: {
                    $and: ["$dislikedByMe", { $or: [
                        { $not: ["$likedByMe"] },
                        { $lt: [{ $arrayElemAt: ["$likesFromMe.created_at", 0] }, { $arrayElemAt: ["$dislikesFromMe.created_at", 0] }] }
                    ] }]
                }
            }
        }
    );

    // Lookup user matches or blocked and exclude them
    pipeline.push(
        {
            $lookup: {
                from: "matches",
                let: {
                    targetId: "$_id",
                    meId: new ObjectId(meUser._id)
                },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $in: ["$$meId", "$users"] },
                                    { $in: ["$$targetId", "$users"] },
                                    { $in: ["$status", ["matched", "blocked"]] }
                                ]
                            }
                        }
                    },
                    { $limit: 1 }
                ],
                as: "matchWithMe"
            }
        },
        {
            $match: {
                matchWithMe: { $eq: [] }
            }
        }
    );

    // Calculating age
    pipeline.push({
        $addFields: {
            'userInfo.age': {
                $dateDiff: {
                    startDate: "$userInfo.birthdate",
                    endDate: "$$NOW",
                    unit: "year"
                }
            }
        }
    });

    // Filter by age range
    if (myAgeRange && (myAgeRange.min || myAgeRange.max)) {
        const ageMatch = {};
        if (myAgeRange.min) ageMatch.$gte = myAgeRange.min;
        if (myAgeRange.max) ageMatch.$lte = myAgeRange.max;

        pipeline.push({ $match: { 'userInfo.age': ageMatch } });
    }

    // Preferences compatibility
    pipeline.push({
        $match: {
            $expr: {
                $and: [
                    {
                        $gt: [
                            { $size: { $setIntersection: ["$preferences.preferences", [myGender]] } },
                            0
                        ]
                    },
                    {
                        $gt: [
                            { $size: { $setIntersection: [["$userInfo.gender"], myPreferences] } },
                            0
                        ]
                    }
                ]
            }
        }
    });

    if (idsOnly) {
        // $geoNear output is distance-sorted: keep the nearest candidates.
        pipeline.push(
            { $sort: { distance: 1, _id: 1 } },
            { $limit: discoverMaxCandidates },
            { $project: { _id: 1 } }
        );
        return pipeline;
    }

    // Exclude fields
    pipeline.push({
        $project:
        {
            'password': 0,
            'email': 0,
            'userInfo.birthdate': 0,
            'created_at': 0,
            'status': 0,
            'likesFromMe': 0,
            'dislikesFromMe': 0,
            'matchWithMe': 0
        }
    });

    return pipeline;
};

module.exports = { getUsersDiscover };
