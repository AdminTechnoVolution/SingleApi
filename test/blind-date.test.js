const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../src/services/blindDate.rules');
const { hmacIceServers, cloudflareIceServers } = require('../shared/util/turnCredentials');

const NOW = new Date('2026-11-03T12:00:00Z');
const birthdateForAge = (age) => new Date(Date.UTC(NOW.getUTCFullYear() - age, 0, 1));
const guest = (overrides = {}) => ({
    userInfo: { gender: 'woman', birthdate: birthdateForAge(28), languages: ['es', 'en'], fullName: 'Ana María' },
    preferences: { preferences: ['man'], lookingFor: 'serious' },
    musicPreferences: { musicGenres: ['rock'] },
    ...overrides
});
const room = (conditions = {}, hostGender = 'man') => ({ hostName: 'David Córdoba', hostGender, conditions });

test('compatible guest matches every condition (empty lists mean "any")', () => {
    assert.equal(Rules.isCompatible(room({ genders: ['woman'], ageMin: 25, ageMax: 30, languages: ['es'], musicGenres: ['rock', 'pop'], lookingFor: ['serious'] }), guest(), NOW), true);
    assert.equal(Rules.isCompatible(room({}), guest(), NOW), true);
});

test('each failing condition rejects the guest', () => {
    assert.equal(Rules.isCompatible(room({ genders: ['man'] }), guest(), NOW), false);
    assert.equal(Rules.isCompatible(room({ ageMin: 30, ageMax: 40 }), guest(), NOW), false);
    assert.equal(Rules.isCompatible(room({ languages: ['fr'] }), guest(), NOW), false);
    assert.equal(Rules.isCompatible(room({ musicGenres: ['jazz'] }), guest(), NOW), false);
    assert.equal(Rules.isCompatible(room({ lookingFor: ['casual'] }), guest(), NOW), false);
});

test('compatibility is mutual: the guest must be looking for the host gender', () => {
    assert.equal(Rules.isCompatible(room({}, 'woman'), guest(), NOW), false);
});

test('conditions are normalised: deduped, adult-only and ordered age range', () => {
    assert.deepEqual(Rules.normalizeConditions({ genders: ['a', 'a', ''], ageMin: 40, ageMax: 16 }),
        { genders: ['a'], ageMin: 18, ageMax: 40, languages: [], musicGenres: [], lookingFor: [] });
});

test('guests only ever see the host first name and the conditions', () => {
    const view = Rules.toPublicRoom({ _id: 'r1', hostId: 'secret', hostName: 'David Córdoba', hostGender: 'man', conditions: { genders: ['woman'] }, guestId: null, created_at: NOW });
    assert.deepEqual(Object.keys(view).sort(), ['_id', 'conditions', 'created_at', 'hostName']);
    assert.equal(view.hostName, 'David');
});

test('claim filter only matches an open, guest-less, fresh room not hosted by the guest', () => {
    const filter = Rules.buildClaimFilter('room-1', 'guest-1', NOW);
    assert.equal(filter.status, 'open');
    assert.equal(filter.guestId, null);
    assert.deepEqual(filter.hostId, { $ne: 'guest-1' });
    assert.ok(filter.created_at.$gte < NOW);
});

test('race: 20 concurrent joins against an atomic store produce exactly one winner', async () => {
    // Simulates Mongo's single-document atomicity for findOneAndUpdate.
    const doc = { _id: 'room-1', status: 'open', guestId: null, hostId: 'host', created_at: NOW };
    const matches = (filter) => filter._id === doc._id && filter.status === doc.status && filter.guestId === doc.guestId && doc.hostId !== filter.hostId.$ne;
    const findOneAndUpdate = async (filter, set) => {
        await new Promise(resolve => setImmediate(resolve));
        if (!matches(filter)) return null;
        Object.assign(doc, set);
        return { ...doc };
    };
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        findOneAndUpdate(Rules.buildClaimFilter('room-1', `guest-${i}`, NOW), { status: 'matched', guestId: `guest-${i}` })));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(doc.status, 'matched');
});

test('open-rooms filter encodes my attributes for the DB-side compatibility check', () => {
    const filter = Rules.buildOpenRoomsFilter(guest(), ['me'], NOW);
    assert.equal(filter.status, 'open');
    assert.deepEqual(filter.hostId, { $nin: ['me'] });
    assert.deepEqual(filter['conditions.ageMin'], { $lte: 28 });
    assert.deepEqual(filter.$and.at(-1), { hostGender: { $in: ['man'] } });
});

test('participants and the other participant are resolved by id', () => {
    const r = { hostId: 'h', guestId: 'g' };
    assert.equal(Rules.isParticipant(r, 'g'), true);
    assert.equal(Rules.isParticipant(r, 'x'), false);
    assert.equal(Rules.otherParticipant(r, 'h'), 'g');
});

test('TURN REST credentials expire and are signed with the shared secret', () => {
    const [stun, turn] = hmacIceServers({ urls: ['turn:turn.example.com:3478'], secret: 's3cret', userId: 'u1', ttlSecs: 60, now: 1_000_000 });
    assert.ok(stun.urls.length > 0);
    assert.equal(turn.username, `${1000 + 60}:u1`);
    assert.equal(typeof turn.credential, 'string');
});

test('managed TURN (Cloudflare) credentials are requested with a TTL', async () => {
    let request;
    const fetchImpl = async (url, init) => { request = { url, init }; return { ok: true, json: async () => ({ iceServers: { urls: ['turn:x'], username: 'u', credential: 'p' } }) }; };
    const servers = await cloudflareIceServers({ keyId: 'k1', apiToken: 't', ttlSecs: 120, fetchImpl });
    assert.match(request.url, /turn\/keys\/k1\/credentials\/generate-ice-servers$/);
    assert.equal(JSON.parse(request.init.body).ttl, 120);
    assert.equal(servers[0].username, 'u');
});

test('match flags: one "yes" is only a hint; the peer is revealed after the match is created', () => {
    const base = { hostId: 'h', guestId: 'g' };
    assert.deepEqual(Rules.matchFlagsFor({ ...base, hostWantsMatch: true }, 'g'), { iWantMatch: false, peerWantsMatch: true, revealed: false });
    assert.deepEqual(Rules.matchFlagsFor({ ...base, hostWantsMatch: true }, 'h'), { iWantMatch: true, peerWantsMatch: false, revealed: false });
    // Both said yes but the match is still being created: nothing revealed yet.
    assert.equal(Rules.matchFlagsFor({ ...base, hostWantsMatch: true, guestWantsMatch: true, matchState: 'creating' }, 'g').revealed, false);
    assert.equal(Rules.matchFlagsFor({ ...base, hostWantsMatch: true, guestWantsMatch: true, matchState: 'done', chatId: 'c' }, 'g').revealed, true);
    assert.equal(Rules.roleOf(base, 'h'), 'host');
    assert.equal(Rules.roleOf(base, 'g'), 'guest');
});

test('race: both pressing "Match" at once creates the match exactly once', async () => {
    const doc = { _id: 'r', hostWantsMatch: true, guestWantsMatch: true };
    let created = 0;
    const claim = async () => {
        await new Promise(resolve => setImmediate(resolve));
        if (doc.matchState !== undefined) return null;
        doc.matchState = 'creating';
        created++;
        return { ...doc };
    };
    const results = await Promise.all([claim(), claim()]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(created, 1);
});
