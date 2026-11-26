const ObjectId = require("mongoose").Types.ObjectId;
const BaseResponse = require('../../shared/util/baseResponse');
const BasePaginatedResponse = require('../../shared/util/basePaginatedResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const UserRepository = require('../repository/user.repository');
const UserActivity = require('./userActivity.service');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const jwtUtil = require('../../shared/util/jwt');
const DiscoverOrder = require('../../shared/util/discoverOrder');
const { hideDatingSignalsStages } = require('../../shared/util/profilePrivacy');
const Intents = require('../../shared/util/intents');
const Intent = require('../enums/EnumIntent');
const limitGetUsersDiscover = Number(process.env.LIMIT_GET_USERS_DISCOVER);
// Nearest N candidates that take part in a round (keeps the id scan bounded).
const discoverMaxCandidates = Number(process.env.DISCOVER_MAX_CANDIDATES) || 1000;
// scope=world: at most this many candidates per country, so the world map is not just my surroundings.
const discoverWorldPerCountry = Number(process.env.DISCOVER_WORLD_PER_COUNTRY) || 25;

const getUsersDiscover = async (req) => {
    const queryParams = req.query;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    const exclussions = '-password -created_at -status -email';
    const user = await UserRepository.findById(userId, exclussions, false);
    if (!user) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND);

    // Kultura: ?intent= (iOS defaults to language_exchange). No intent = legacy dating feed, unchanged.
    const requested = Intents.resolveRequestedIntent(queryParams.intent, req.headers);
    if (requested.invalid) throw new BusinessException(c.CODE_INTENT_INVALID);
    const intent = requested.intent;

    // Discover is the first screen after opening the app: its first page (no cursor)
    // marks the user's last activity. Fire-and-forget, throttled per user.
    if (!queryParams.cursor) UserActivity.recordActivity(userId);

    // Dating results are only for users who turned on "Open to something more" (and have a dating profile).
    if (intent === Intent.DATING && !canDiscoverDating(user)) {
        return new BaseResponse(true, [], new BasePaginatedResponse([], { nextCursor: null, pageSize: 0, hasMore: false }));
    }

    const ranked = isRankedIntent(intent);

    // Kultura bubble explore: ?scope=country (my country, no distance limit) | world (everyone)
    // | area&lat&lng&radius (the part of the map the user is looking at, radius in meters).
    // No scope = the distance-limited feed, unchanged. Opening a foreign profile is gated in the app.
    const area = parseArea(queryParams);
    const scope = resolveScope(queryParams.scope, user, area);

    // 1) Ids of every eligible candidate (cheap: _id only).
    const candidates = await UserRepository.findByPipeline(createPipeline(user, { idsOnly: true, intent, scope, area }));

    // 2) Seeded random page: a new round (no cursor) = a new order.
    //    Non-dating intents: ranked by language overlap, then interests, random among ties.
    const { pageIds, hasMore, nextCursor } = ranked
        ? DiscoverOrder.pageOfRanked(candidates.map(u => ({ id: u._id.toString(), languageScore: u.languageScore, interestScore: u.interestScore })), queryParams.cursor, limitGetUsersDiscover)
        : DiscoverOrder.pageOf(candidates.map(u => u._id.toString()), queryParams.cursor, limitGetUsersDiscover);

    // 3) Full profiles for that page, returned in the shuffled order.
    let users = [];
    if (pageIds.length > 0) {
        const found = await UserRepository.findByPipeline(createPipeline(user, { pageIds, intent, scope, area }), true);
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

const Scope = Object.freeze({ COUNTRY: 'country', WORLD: 'world', AREA: 'area' });

// scope=area radius limits (meters): a city up to half the planet.
const AREA_MIN_RADIUS = 10_000;
const AREA_MAX_RADIUS = 10_000_000;
// From this radius on the area spans several countries: cap candidates per country too.
const AREA_SPREAD_RADIUS = 1_000_000;

/** `{ lng, lat, radius }` from ?lat&lng&radius, or null when missing/invalid. */
const parseArea = (query = {}) => {
    const lat = Number(query.lat), lng = Number(query.lng), radius = Number(query.radius);
    if (![lat, lng, radius].every(Number.isFinite)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || radius <= 0) return null;
    return { lat, lng, radius: Math.min(Math.max(radius, AREA_MIN_RADIUS), AREA_MAX_RADIUS) };
};

/** Candidates are capped per country (world, or an area wider than a country). */
const spreadsCountries = (scope, area) => scope === Scope.WORLD || (scope === Scope.AREA && area?.radius >= AREA_SPREAD_RADIUS);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Requested scope; `country` needs a known country (otherwise the distance feed is used). */
const resolveScope = (requested, meUser, area = null) => {
    if (requested === Scope.WORLD) return Scope.WORLD;
    if (requested === Scope.AREA) return area ? Scope.AREA : Scope.WORLD;
    if (requested === Scope.COUNTRY) return countryOf(meUser) ? Scope.COUNTRY : null;
    return null;
};

const countryOf = (meUser) => (meUser.effectiveLocation?.country || '').trim();

/** Same-country match on the free-text geocoded country (case/space insensitive). */
const sameCountryQuery = (country) => ({ 'effectiveLocation.country': { $regex: `^\\s*${escapeRegex(country)}\\s*$`, $options: 'i' } });

/** $geoNear for a scope: distance-limited (none), my country, everyone (world), or around a map point (area). */
const geoNearStage = (meUser, scope, area = null) => {
    const inArea = scope === Scope.AREA && area;
    const geoNear = {
        near: { type: "Point", coordinates: inArea ? [area.lng, area.lat] : meUser.effectiveLocation.coordinates },
        distanceField: "distance",
        spherical: true,
        key: "effectiveLocation.coordinates"
    };
    if (!scope) {
        geoNear.maxDistance = meUser.profileConfig?.maximumDistance;
    } else if (scope === Scope.COUNTRY) {
        geoNear.query = sameCountryQuery(countryOf(meUser));
    } else if (inArea) {
        geoNear.maxDistance = area.radius;
    }
    return { $geoNear: geoNear };
};

/**
 * Keeps the first `discoverWorldPerCountry` (already sorted) candidates of each country, then
 * restores the global order. Countries are compared trimmed and case-insensitive.
 */
const perCountryStages = (fields, sort) => {
    const keep = Object.fromEntries(['_id', ...fields].map(f => [f, `$${f}`]));
    return [
        { $group: {
            _id: { $toLower: { $trim: { input: { $ifNull: ['$effectiveLocation.country', ''] } } } },
            users: { $push: keep }
        } },
        { $project: { users: { $slice: ['$users', discoverWorldPerCountry] } } },
        { $unwind: '$users' },
        { $replaceRoot: { newRoot: '$users' } },
        { $sort: sort }
    ];
};

const isRankedIntent = (intent) => Boolean(intent) && intent !== Intent.DATING;

const canDiscoverDating = (meUser) =>
    meUser?.profileConfig?.openToDating === true &&
    Boolean(meUser.userInfo?.gender) &&
    Array.isArray(meUser.preferences?.preferences) && meUser.preferences.preferences.length > 0;

/** Mutual gender preferences (dating feed). $ifNull: profiles without dating fields never match. */
const mutualGenderStage = (myGender, myPreferences) => ({
    $match: {
        $expr: {
            $and: [
                {
                    $gt: [
                        { $size: { $setIntersection: [{ $ifNull: ["$preferences.preferences", []] }, [myGender]] } },
                        0
                    ]
                },
                {
                    $gt: [
                        { $size: { $setIntersection: [["$userInfo.gender"], myPreferences || []] } },
                        0
                    ]
                }
            ]
        }
    }
});

/**
 * Kultura feeds (friends / language_exchange): the "Quiero aprender con" gender choice
 * (preferences.preferences, the same field Single users already set), applied both ways.
 * An empty choice on either side means "anyone", so new users without it are not hidden.
 */
const preferredGenderStage = (myGender, myPreferences) => {
    const and = [{
        $or: [
            { $eq: [{ $size: { $ifNull: ["$preferences.preferences", []] } }, 0] },
            ...(myGender ? [{ $in: [myGender, { $ifNull: ["$preferences.preferences", []] }] }] : [])
        ]
    }];
    if (Array.isArray(myPreferences) && myPreferences.length > 0) {
        and.push({ $in: [{ $ifNull: ["$userInfo.gender", null] }, myPreferences] });
    }
    return { $match: { $expr: { $and: and } } };
};

/** Users who appear in `intent`'s feed: `profileConfig.discoverIntents` absent/empty (= all) or including it. */
const appearsIn = (intent) => ({
    $or: [
        { 'profileConfig.discoverIntents': intent },
        { 'profileConfig.discoverIntents': { $exists: false } },
        { 'profileConfig.discoverIntents': { $size: 0 } }
    ]
});

/**
 * Candidate filter per intent:
 *  - legacy (null): everyone the old feed showed, minus users who explicitly turned
 *    "Open to something more" off in the new app;
 *  - dating: dating profiles only (intents incl. dating or legacy), not opted out, and not
 *    hidden from dating ("No quiero citas" = discoverIntents without 'dating');
 *  - friends / language_exchange: everyone who appears in that feed (all users by default,
 *    Single users included), whatever they picked as their own intents.
 */
const intentMatchStage = (intent) => {
    if (!intent) {
        return { $match: { $nor: [{ 'profileConfig.openToDating': false, 'profileConfig.openToDatingUpdatedAt': { $exists: true } }] } };
    }
    if (intent === Intent.DATING) {
        return {
            $match: {
                'profileConfig.openToDating': { $ne: false },
                $and: [
                    { $or: [
                        { 'preferences.intents': Intent.DATING },
                        { 'preferences.intents': { $exists: false } },
                        { 'preferences.intents': { $size: 0 } }
                    ] },
                    appearsIn(Intent.DATING)
                ]
            }
        };
    }
    return { $match: appearsIn(intent) };
};

/** Language overlap (what I learn ↔ what they speak, both ways), then interests overlap. */
const scoreStage = (meUser) => {
    const myLanguages = (meUser.userInfo?.languages || []).map(String);
    const myLearning = (meUser.userInfo?.learningLanguages || []).map(String);
    const myInterests = (meUser.userInfo?.interests || []).map(String);
    const overlap = (field, mine) => ({ $size: { $setIntersection: [{ $ifNull: [field, []] }, mine] } });
    return {
        $addFields: {
            languageScore: { $add: [overlap("$userInfo.languages", myLearning), overlap("$userInfo.learningLanguages", myLanguages)] },
            interestScore: overlap("$userInfo.interests", myInterests)
        }
    };
};

const createPipeline = (meUser, { idsOnly = false, pageIds = null, intent = null, scope = null, area = null } = {}) => {
    // Precompute my data
    const myGender = meUser.userInfo?.gender;
    const myPreferences = meUser.preferences?.preferences;
    const myAgeRange = meUser.profileConfig?.ageRange;

    const pipeline = [];

    // Filter by near location (or by country / world for the Kultura scopes)
    pipeline.push(geoNearStage(meUser, scope, area));

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

    // Intent compatibility
    pipeline.push(intentMatchStage(intent));

    // Preferences compatibility (mutual gender): only for the dating feed (legacy or intent=dating)
    if (!isRankedIntent(intent)) {
        pipeline.push(mutualGenderStage(myGender, myPreferences));
    } else {
        pipeline.push(preferredGenderStage(myGender, myPreferences));
    }

    if (idsOnly && isRankedIntent(intent)) {
        // Best language/interest matches first, then nearest; random order inside a rank is applied per round.
        const sort = { languageScore: -1, interestScore: -1, distance: 1, _id: 1 };
        pipeline.push(
            scoreStage(meUser),
            { $sort: sort },
            ...(spreadsCountries(scope, area) ? perCountryStages(['languageScore', 'interestScore', 'distance'], sort) : []),
            { $limit: discoverMaxCandidates },
            { $project: { _id: 1, languageScore: 1, interestScore: 1 } }
        );
        return pipeline;
    }

    if (idsOnly) {
        // $geoNear output is distance-sorted: keep the nearest candidates.
        pipeline.push(
            { $sort: { distance: 1, _id: 1 } },
            ...(spreadsCountries(scope, area) ? perCountryStages(['distance'], { distance: 1, _id: 1 }) : []),
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
            'matchWithMe': 0,
            'lastActivityAt': 0
        }
    });

    // Kultura: never reveal whether a candidate is open to dating.
    pipeline.push(...hideDatingSignalsStages());

    return pipeline;
};

module.exports = { getUsersDiscover, createPipeline, canDiscoverDating, Scope, parseArea };
