process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'next-level-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const Rules = require('../src/services/nextLevel.rules');
const NextLevelService = require('../src/services/nextLevel.service');
const { nextLevelWishSchema } = require('../src/validators/connection.validator');
const ChatService = require('../src/services/chat.service');

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';
const STRANGER = '64b000000000000000000009';
const CHAT = '64b0000000000000000000c1';

const auth = (id) => ({ authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET_KEY)}` });
const req = (id, body) => ({ headers: auth(id), params: { chatId: CHAT }, body });
const lean = (value) => ({ lean: async () => (value ? structuredClone(value) : null) });

/** In-memory Mongo double for the few queries the service runs (single-document atomic updates). */
const world = ({ openA = true, openB = false, messages = 0, calls = 0 } = {}) => {
    const match = { _id: CHAT, users: [A, B], status: 'matched' };
    const events = [];
    const pushes = [];
    const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    const set = (obj, path, value) => {
        const keys = path.split('.');
        let o = obj;
        keys.slice(0, -1).forEach(k => { o[k] = o[k] ?? {}; o = o[k]; });
        o[keys.at(-1)] = value;
    };
    const matches = (filter) => Object.entries(filter).every(([key, cond]) => {
        const value = get(match, key);
        if (key === 'users') return match.users.includes(String(cond));
        if (key === '_id') return String(value) === String(cond);
        if (cond && typeof cond === 'object' && '$exists' in cond) return (value !== undefined) === cond.$exists;
        return value === cond;
    });
    const Match = {
        findOne: (filter) => lean(matches(filter) ? match : null),
        findOneAndUpdate: (filter, update) => {
            const ok = matches(filter);
            if (ok) Object.entries(update.$set).forEach(([path, value]) => set(match, path, value));
            return lean(ok ? match : null);
        }
    };
    const deps = {
        Match,
        User: { find: () => lean([{ _id: A, profileConfig: { openToDating: openA } }, { _id: B, profileConfig: { openToDating: openB } }]) },
        Conversation: { countDocuments: async (filter, { limit }) => Math.min(messages, limit) },
        Call: { countDocuments: async (filter, { limit }) => Math.min(calls, limit) },
        emitToUser: async (userId, event, payload) => { events.push({ userId, event, payload: JSON.parse(payload) }); },
        pushToUser: (userId, data) => { pushes.push({ userId, data }); }
    };
    return { match, deps, events, pushes };
};

test('eligibility: requester must be open to dating, plus both open, 20 messages or a completed call', () => {
    assert.equal(Rules.isEligible({ meOpenToDating: false, peerOpenToDating: true, messageCount: 99, completedCalls: 9 }), false);
    assert.equal(Rules.isEligible({ meOpenToDating: true, peerOpenToDating: true }), true);
    assert.equal(Rules.isEligible({ meOpenToDating: true, messageCount: 19 }), false);
    assert.equal(Rules.isEligible({ meOpenToDating: true, messageCount: 20 }), true);
    assert.equal(Rules.isEligible({ meOpenToDating: true, completedCalls: 1 }), true);
});

test('the view never contains the other side\'s wish', () => {
    const match = { _id: CHAT, users: [A, B], nextLevel: { users: { [A]: false, [B]: true } } };
    const view = Rules.viewFor(match, A, true);
    assert.deepEqual(view, { chatId: CHAT, eligible: true, iWant: false, unlocked: false, unlockedAt: null });
    assert.equal(JSON.stringify(view).includes(B), false);
});

test('privacy: proposing is invisible to the other user until both want it', async () => {
    const w = world({ openA: true, openB: true });
    const proposed = await NextLevelService.setWish(req(A, { wants: true }), w.deps);
    assert.deepEqual(proposed.data, { chatId: CHAT, eligible: true, iWant: true, unlocked: false, unlockedAt: null });
    const seenByB = await NextLevelService.getStatus(req(B), w.deps);
    assert.equal(seenByB.data.iWant, false);
    assert.equal(seenByB.data.unlocked, false);
    assert.equal(w.events.length, 0);
    assert.equal(w.pushes.length, 0);
});

test('unlock: second "yes" unlocks once, notifies both users by socket and push', async () => {
    const w = world({ openA: true, openB: true });
    await NextLevelService.setWish(req(A, { wants: true }), w.deps);
    const result = await NextLevelService.setWish(req(B, { wants: true }), w.deps);
    assert.equal(result.data.unlocked, true);
    assert.ok(result.data.unlockedAt instanceof Date || typeof result.data.unlockedAt === 'string');
    assert.deepEqual(w.events.map(e => [e.userId, e.event]), [[A, 'connection:nextLevel'], [B, 'connection:nextLevel']]);
    assert.equal(w.events[0].payload.data.chatId, CHAT);
    assert.deepEqual(w.pushes.map(p => p.userId), [A, B]);

    // Once unlocked it stays unlocked and nothing is re-sent.
    const again = await NextLevelService.setWish(req(A, { wants: false }), w.deps);
    assert.equal(again.data.unlocked, true);
    assert.equal(w.events.length, 2);
    const status = await NextLevelService.getStatus(req(A), w.deps);
    assert.equal(status.data.unlocked, true);
});

test('withdrawing before the other side answers means no unlock', async () => {
    const w = world({ openA: true, openB: true });
    await NextLevelService.setWish(req(A, { wants: true }), w.deps);
    await NextLevelService.setWish(req(A, { wants: false }), w.deps);
    const result = await NextLevelService.setWish(req(B, { wants: true }), w.deps);
    assert.equal(result.data.unlocked, false);
    assert.equal(w.events.length, 0);
});

test('not eligible: proposing is rejected, status says eligible=false', async () => {
    const w = world({ openA: true, openB: false, messages: 5 });
    await assert.rejects(NextLevelService.setWish(req(A, { wants: true }), w.deps), { message: 'ERROR_NEXT_LEVEL_NOT_ELIGIBLE', statusCode: 403 });
    assert.equal((await NextLevelService.getStatus(req(A), w.deps)).data.eligible, false);
    // 20 messages or a completed call make it eligible even if the other side is not open yet.
    assert.equal((await NextLevelService.getStatus(req(A), world({ openB: false, messages: 20 }).deps)).data.eligible, true);
    assert.equal((await NextLevelService.getStatus(req(A), world({ openB: false, calls: 1 }).deps)).data.eligible, true);
    // The requester's own setting is always required.
    assert.equal((await NextLevelService.getStatus(req(A), world({ openA: false, openB: true, messages: 50 }).deps)).data.eligible, false);
});

test('only participants of a live connection can read or write it', async () => {
    const w = world();
    await assert.rejects(NextLevelService.getStatus(req(STRANGER), w.deps), { message: 'ERROR_CONNECTION_NOT_FOUND', statusCode: 404 });
    await assert.rejects(NextLevelService.getStatus({ headers: auth(A), params: { chatId: 'nope' } }, w.deps), { statusCode: 404 });
    w.match.status = 'unmatched';
    await assert.rejects(NextLevelService.setWish(req(A, { wants: false }), w.deps), { statusCode: 404 });
});

test('unlock filter is atomic: requires every wish and no previous unlock', () => {
    const filter = Rules.buildUnlockFilter({ _id: CHAT, users: [A, B] });
    assert.deepEqual(filter, { _id: CHAT, status: 'matched', 'nextLevel.unlockedAt': { $exists: false }, [`nextLevel.users.${A}`]: true, [`nextLevel.users.${B}`]: true });
});

test('wish body must be a real boolean', () => {
    assert.equal(nextLevelWishSchema.validate({ wants: true }).error, undefined);
    assert.ok(nextLevelWishSchema.validate({ wants: 'yes' }).error);
    assert.ok(nextLevelWishSchema.validate({}).error);
});

test('GET /api/chats items expose nextLevelUnlocked and intent (additive)', async () => {
    const pipeline = await ChatService.createPipeline(A, {});
    const project = pipeline.find(stage => stage.$project).$project;
    assert.equal(project.intent, '$match.intent');
    assert.deepEqual(project.nextLevelUnlocked, { $ne: [{ $ifNull: ['$match.nextLevel.unlockedAt', null] }, null] });
    for (const legacy of ['_id', 'lastMessage', 'unreadCounts', 'deletedAt', 'users']) assert.ok(legacy in project);
});
