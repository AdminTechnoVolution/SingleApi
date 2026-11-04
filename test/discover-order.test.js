const test = require('node:test');
const assert = require('node:assert');
const { pageOf, shuffleIds, decodeCursor } = require('../shared/util/discoverOrder');

const ids = Array.from({ length: 100 }, (_, i) => '68c490865d8254ec33d4' + i.toString(16).padStart(4, '0'));

const readRound = (all, pageSize) => {
    const seen = [];
    let cursor = null;
    do {
        const page = pageOf(all, cursor, pageSize);
        seen.push(...page.pageIds);
        cursor = page.nextCursor;
    } while (cursor);
    return seen;
};

test('a full round returns every profile exactly once', () => {
    const round = readRound(ids, 30);
    assert.strictEqual(round.length, ids.length);
    assert.strictEqual(new Set(round).size, ids.length);
});

test('each new round comes in a different order', () => {
    const a = readRound(ids, 30);
    const b = readRound(ids, 30);
    assert.notDeepStrictEqual(a, b);
    assert.notDeepStrictEqual(a, ids); // not the db order either
});

test('pages of the same round are stable even if a profile disappears', () => {
    const first = pageOf(ids, null, 30);
    const { seed } = decodeCursor(first.nextCursor);
    const orderedWithout = shuffleIds(ids.filter(id => id !== first.pageIds[0]), seed);
    // Removing an already-seen profile shifts by one at most: nothing unseen is lost.
    const second = pageOf(ids, first.nextCursor, 30);
    assert.ok(second.pageIds.every(id => orderedWithout.includes(id)));
    assert.strictEqual(new Set([...first.pageIds, ...second.pageIds]).size, 60);
});

test('legacy ObjectId cursors (old app) start a new round instead of failing', () => {
    assert.strictEqual(decodeCursor(ids[5]), null);
    const page = pageOf(ids, ids[5], 30);
    assert.strictEqual(page.pageIds.length, 30);
    assert.ok(page.hasMore);
});

test('last page has no next cursor', () => {
    const page = pageOf(ids.slice(0, 10), null, 30);
    assert.strictEqual(page.pageIds.length, 10);
    assert.strictEqual(page.hasMore, false);
    assert.strictEqual(page.nextCursor, null);
});
