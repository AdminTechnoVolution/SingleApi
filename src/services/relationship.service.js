const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const ObjectId = require('mongoose').Types.ObjectId;
const MatchRepository = require('../repository/match.repository');
const ChatRepository = require('../repository/chat.repository');
const ConversationRepository = require('../repository/conversation.repository');
const LikeRepository = require('../repository/likes.repository');
const DislikeRepository = require('../repository/dislikes.repository');
const QuickMessageRepository = require('../repository/quickMessage.repository');

/** Filters that cover both directions between two users (pure, unit-tested). */
const pairFilters = (userA, userB) => {
    const a = new ObjectId(String(userA));
    const b = new ObjectId(String(userB));
    const directional = { $or: [{ fromUserId: a, toUserId: b }, { fromUserId: b, toUserId: a }] };
    return { pair: { users: { $all: [a, b] } }, directional };
};

/**
 * Unmatch = the two users become strangers again: match, chat, messages,
 * likes, dislikes and quick messages between them are deleted (both ways).
 * The match record goes last so a failed run can be retried from it.
 */
const purgeRelationship = async (userA, userB, deps = {}) => {
    const repos = {
        MatchRepository, ChatRepository, ConversationRepository, LikeRepository, DislikeRepository, QuickMessageRepository, ...deps
    };
    const { pair, directional } = pairFilters(userA, userB);
    const matches = await repos.MatchRepository.findByAnyFilter(pair) || [];
    const chatIds = matches.map(match => match._id);
    const chats = await repos.ChatRepository.findByAnyFilter(pair) || [];
    chats.forEach(chat => { if (!chatIds.some(id => String(id) === String(chat._id))) chatIds.push(chat._id); });

    if (chatIds.length) await repos.ConversationRepository.deleteManyByFilter({ chatId: { $in: chatIds } });
    await repos.ChatRepository.deleteManyByFilter(pair);
    await repos.LikeRepository.deleteManyByFilter(directional);
    await repos.DislikeRepository.deleteManyByFilter(directional);
    await repos.QuickMessageRepository.deleteManyByFilter(directional);
    await repos.MatchRepository.deleteManyByFilter(pair);
    logger.info(`Relationship purged between ${userA} and ${userB} (${chatIds.length} chat(s))`, { className: filename });
};

module.exports = { pairFilters, purgeRelationship };
