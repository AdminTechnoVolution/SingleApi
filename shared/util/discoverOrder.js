const crypto = require('crypto');

/**
 * Random-but-stable ordering for the discover feed.
 *
 * Each "round" (a request without cursor) draws a new random seed. Every
 * candidate gets the order key hash(seed + id), so:
 *  - a new round shows the same people in a completely different order;
 *  - within a round, pages are consistent (no repeats, no gaps), and a
 *    profile appearing/disappearing between pages does not reshuffle the rest.
 * The cursor is opaque to clients: "<seed>.<offset>".
 */

const newSeed = () => crypto.randomBytes(6).toString('hex');

const encodeCursor = (seed, offset) => `${seed}.${offset}`;

/** Returns { seed, offset } or null for missing/legacy/invalid cursors (→ start a new round). */
const decodeCursor = (cursor) => {
    if (typeof cursor !== 'string') return null;
    const match = /^([0-9a-f]{6,32})\.(\d{1,7})$/.exec(cursor);
    if (!match) return null;
    return { seed: match[1], offset: Number(match[2]) };
};

const orderKey = (seed, id) => crypto.createHash('md5').update(`${seed}:${id}`).digest('hex');

/** Sorts ids by their seeded order key (pure, deterministic for a given seed). */
const shuffleIds = (ids, seed) =>
    ids
        .map(id => ({ id, key: orderKey(seed, String(id)) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map(entry => entry.id);

/** One page of a seeded round. */
const pageOf = (ids, cursor, pageSize) => {
    const decoded = decodeCursor(cursor);
    const seed = decoded?.seed ?? newSeed();
    const offset = decoded?.offset ?? 0;
    const ordered = shuffleIds(ids, seed);
    const pageIds = ordered.slice(offset, offset + pageSize);
    const nextOffset = offset + pageIds.length;
    const hasMore = nextOffset < ordered.length;
    return { pageIds, hasMore, nextCursor: hasMore ? encodeCursor(seed, nextOffset) : null };
};

module.exports = { newSeed, encodeCursor, decodeCursor, shuffleIds, pageOf };
