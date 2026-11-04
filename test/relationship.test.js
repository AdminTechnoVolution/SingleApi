const test = require('node:test');
const assert = require('node:assert/strict');
const { pairFilters, purgeRelationship } = require('../src/services/relationship.service');

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';

test('pair filters cover both users and both directions', () => {
    const { pair, directional } = pairFilters(A, B);
    assert.deepEqual(pair.users.$all.map(String), [A, B]);
    assert.deepEqual(directional.$or.map(f => [String(f.fromUserId), String(f.toUserId)]), [[A, B], [B, A]]);
});

test('unmatch purge deletes messages, chat, likes, dislikes, quick messages and finally the match', async () => {
    const calls = [];
    const repo = (name, found = []) => ({
        findByAnyFilter: async () => found,
        deleteManyByFilter: async (filter) => { calls.push([name, filter]); }
    });
    await purgeRelationship(A, B, {
        MatchRepository: repo('match', [{ _id: 'chat-1' }]),
        ChatRepository: repo('chat', [{ _id: 'chat-1' }]),
        ConversationRepository: repo('conversation'),
        LikeRepository: repo('like'),
        DislikeRepository: repo('dislike'),
        QuickMessageRepository: repo('quickMessage')
    });
    assert.deepEqual(calls.map(([name]) => name), ['conversation', 'chat', 'like', 'dislike', 'quickMessage', 'match']);
    assert.deepEqual(calls[0][1], { chatId: { $in: ['chat-1'] } });
});
