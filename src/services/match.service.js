const ObjectId = require("mongoose").Types.ObjectId;
const BaseResponse = require('../../shared/util/baseResponse');
const BasePaginatedResponse = require('../../shared/util/basePaginatedResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const MatchRepository = require('../repository/match.repository');
const c = require('../../shared/util/constants.frontcodes');
const constants = require('../../shared/util/constants');
const jwtUtil = require('../../shared/util/jwt');
const MatchStatus = require('../enums/EnumMatchStatus');
const RelationshipService = require('./relationship.service');
const limitGetMatches = Number(process.env.LIMIT_GET_MATCHES);

const getMatches = async (req) => {
    const queryParams = req.query;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');

    const pipeline = await createPipeline(userId, queryParams);

    let matches = await MatchRepository.findByPipeline(pipeline);

    const hasMore = matches.length === limitGetMatches;
    const nextCursor = (hasMore && matches.length > 0) ? matches[matches.length - 1]._id : null;

    const response = new BasePaginatedResponse(
        matches,
        {
            nextCursor,
            pageSize: matches.length,
            hasMore
        });

    return new BaseResponse(true, [], response);
};

const unmatched = async (req) => {
    const { matchId } = req.params;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');
    const userIdMongo = new ObjectId(userId);

    if (!ObjectId.isValid(matchId)) throw new BusinessException(c.CODE_MATCH_NOT_FOUND);
    const match = await MatchRepository.findOneByFilter({ _id: new ObjectId(matchId), users: userIdMongo });
    if (!match) throw new BusinessException(c.CODE_MATCH_NOT_FOUND);
    // A block stays: the blocked person must not show up again.
    if (match.status === MatchStatus.BLOCKED) return new BaseResponse(true);

    // Unmatch deletes everything between the two users (match, chat, messages,
    // likes, dislikes, quick messages): they can meet again from scratch.
    const otherId = match.users.map(String).find(id => id !== String(userId));
    await RelationshipService.purgeRelationship(userId, otherId);

    return new BaseResponse(true);
}

const blocked = async (req) => {
    const { matchId } = req.params;
    const auth = req.headers['authorization'];
    const userId = jwtUtil.getValueFromJwtToken(auth, 'id');
    const userIdMongo = new ObjectId(userId);

    const result = await MatchRepository.updateOne({ _id: new ObjectId(matchId), users: userIdMongo },
        {
            $set: {
                lastUpdatedBy: userIdMongo,
                status: MatchStatus.BLOCKED,
                updated_at: new Date()
            }
        });

    if (result.matchedCount === 0) throw new BusinessException(c.CODE_MATCH_NOT_FOUND);

    return new BaseResponse(true);
}

const createPipeline = async (userId, queryParams) => {
    // Precompute my data
    const cursorObjectId = queryParams.cursor ? new ObjectId(queryParams.cursor) : null;
    const pipeline = [];

    // Find by user and only matched status
    const matchStage = {
        users: new ObjectId(userId),
        status: MatchStatus.MATCHED
    };

    // Filter by cursor to paginate results
    if (cursorObjectId) {
        matchStage._id = { ...matchStage._id, $gt: cursorObjectId };
    }

    pipeline.push({ $match: matchStage });

    // Remove me from the query result
    pipeline.push({
        $project: {
            users: {
                $filter: {
                    input: "$users",
                    as: "u",
                    cond: { $ne: ["$$u", new ObjectId(userId)] }
                }
            }
        }
    });

    // Lookup to get user details
    pipeline.push({
        $lookup: {
            from: "users",
            localField: "users",
            foreignField: "_id",
            as: "users"
        }
    });

    // Unwind the users array to get a single user object
    pipeline.push({ $unwind: "$users" });

    // keep only the fields we want + filter isProfile photo
    pipeline.push({
        $project: {
            _id: 1,
            "user._id": "$users._id",
            "user.fullName": "$users.userInfo.fullName",
            "user.photos": {
                $filter: {
                    input: "$users.photos",
                    as: "photo",
                    cond: { $eq: ["$$photo.isProfile", true] }
                }
            }
        }
    });

    // Sort and limit for pagination
    pipeline.push(
        { $sort: { _id: -1 } },
        { $limit: limitGetMatches }
    );

    return pipeline;
};

module.exports = { getMatches, unmatched, blocked };
