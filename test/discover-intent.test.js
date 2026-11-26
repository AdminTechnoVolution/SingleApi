const test = require('node:test');
const assert = require('node:assert/strict');
const { createPipeline, canDiscoverDating, parseArea } = require('../src/services/discover.service');
const { rankIds, pageOfRanked, decodeCursor } = require('../shared/util/discoverOrder');

const me = {
    _id: '64b000000000000000000001',
    userInfo: { gender: 'M', languages: ['1'], learningLanguages: ['2', '3'], interests: ['7', '9'] },
    preferences: { preferences: ['F'], lookingFor: '2', intents: ['language_exchange'] },
    profileConfig: { maximumDistance: 50000, ageRange: { min: 20, max: 40 } },
    effectiveLocation: { coordinates: [-75.56, 6.25] }
};

const stages = (pipeline, name) => pipeline.filter(stage => stage[name]);
const mutualGender = (pipeline) => pipeline.find(stage => stage.$match?.$expr?.$and?.some(cond => cond.$gt && JSON.stringify(cond).includes('$preferences.preferences')));
const preferredGender = (pipeline) => pipeline.find(stage => stage.$match?.$expr?.$and?.some(cond => cond.$or && JSON.stringify(cond).includes('$preferences.preferences')));
const intentFilters = (pipeline) => pipeline.filter(stage => stage.$match && ('preferences.intents' in stage.$match || '$or' in stage.$match || '$nor' in stage.$match));

test('legacy request (no intent): same dating pipeline, mutual gender filter kept', () => {
    const pipeline = createPipeline(me, { idsOnly: true });
    assert.ok(pipeline[0].$geoNear, 'starts with $geoNear');
    assert.equal(pipeline[0].$geoNear.maxDistance, 50000);
    const gender = mutualGender(pipeline);
    assert.ok(gender, 'mutual gender filter present');
    // Same two conditions as before (now null-safe): their preferences ∋ my gender, my preferences ∋ their gender.
    assert.match(JSON.stringify(gender), /"\$userInfo.gender"\]?,\["F"\]/);
    assert.match(JSON.stringify(gender), /\["M"\]/);
    // Legacy feed only drops people who explicitly turned "Open to something more" off in the new app.
    const [optOut] = intentFilters(pipeline);
    assert.deepEqual(optOut.$match, { $nor: [{ 'profileConfig.openToDating': false, 'profileConfig.openToDatingUpdatedAt': { $exists: true } }] });
    // Old order: nearest candidates, ids only, no Kultura scores.
    assert.deepEqual(pipeline.at(-3), { $sort: { distance: 1, _id: 1 } });
    assert.deepEqual(pipeline.at(-1), { $project: { _id: 1 } });
    assert.equal(stages(pipeline, '$addFields').some(stage => 'languageScore' in stage.$addFields), false);
});

test('language_exchange: soft gender filter, only users with that intent, ranked by language then interests', () => {
    const pipeline = createPipeline(me, { idsOnly: true, intent: 'language_exchange' });
    assert.equal(mutualGender(pipeline), undefined);
    assert.ok(preferredGender(pipeline), '"Quiero aprender con" filter present');
    assert.ok(pipeline.some(stage => stage.$match?.['preferences.intents'] === 'language_exchange'));
    const score = pipeline.find(stage => stage.$addFields?.languageScore);
    assert.ok(score);
    const text = JSON.stringify(score);
    assert.match(text, /"\$userInfo.languages".*\["2","3"\]/, 'they speak what I learn');
    assert.match(text, /"\$userInfo.learningLanguages".*\["1"\]/, 'they learn what I speak');
    assert.match(text, /"\$userInfo.interests".*\["7","9"\]/);
    assert.ok(pipeline.some(stage => JSON.stringify(stage.$sort) === JSON.stringify({ languageScore: -1, interestScore: -1, distance: 1, _id: 1 })));
    assert.deepEqual(pipeline.at(-1), { $project: { _id: 1, languageScore: 1, interestScore: 1 } });
});

test('friends feed excludes dating-only users by requiring the friends intent', () => {
    const pipeline = createPipeline(me, { idsOnly: true, intent: 'friends' });
    assert.ok(pipeline.some(stage => stage.$match?.['preferences.intents'] === 'friends'));
    assert.equal(mutualGender(pipeline), undefined);
    assert.ok(preferredGender(pipeline));
});

test('dating feed keeps the mutual gender filter and only dating profiles', () => {
    const pipeline = createPipeline(me, { idsOnly: true, intent: 'dating' });
    assert.ok(mutualGender(pipeline));
    const datingOnly = pipeline.find(stage => stage.$match?.['profileConfig.openToDating']);
    assert.deepEqual(datingOnly.$match['profileConfig.openToDating'], { $ne: false });
    assert.equal(datingOnly.$match.$or.length, 3);
});

test('dating discover requires "Open to something more" and a dating profile', () => {
    assert.equal(canDiscoverDating(me), false);
    assert.equal(canDiscoverDating({ ...me, profileConfig: { openToDating: true } }), true);
    assert.equal(canDiscoverDating({ ...me, profileConfig: { openToDating: true }, preferences: { intents: ['dating'] } }), false);
});

test('page pipeline of a ranked feed returns full profiles of the page only', () => {
    const pipeline = createPipeline(me, { pageIds: ['64b000000000000000000002'], intent: 'language_exchange' });
    const match = pipeline.find(stage => stage.$match?._id);
    assert.equal(match.$match._id.$in.length, 1);
    assert.ok(pipeline.some(stage => stage.$project?.password === 0));
});

test('ranked order: language overlap first, interests second, random among ties, stable per round', () => {
    const entries = [
        { id: 'a', languageScore: 0, interestScore: 5 },
        { id: 'b', languageScore: 2, interestScore: 0 },
        { id: 'c', languageScore: 2, interestScore: 1 },
        { id: 'd', languageScore: 1, interestScore: 0 }
    ];
    assert.deepEqual(rankIds(entries, 'abcdef'), ['c', 'b', 'd', 'a']);

    const many = Array.from({ length: 60 }, (_, i) => ({ id: `u${i}`, languageScore: i % 3, interestScore: 0 }));
    const first = pageOfRanked(many, null, 25);
    assert.ok(decodeCursor(first.nextCursor));
    const second = pageOfRanked(many, first.nextCursor, 25);
    const third = pageOfRanked(many, second.nextCursor, 25);
    const all = [...first.pageIds, ...second.pageIds, ...third.pageIds];
    assert.equal(new Set(all).size, 60);
    const score = (id) => Number(id.slice(1)) % 3;
    for (let i = 1; i < all.length; i++) assert.ok(score(all[i - 1]) >= score(all[i]), 'never a worse match before a better one');
    assert.equal(third.hasMore, false);
});

test('profiles shown to others never reveal "open to dating" (discover and GET /api/user/:id)', () => {
    const pipeline = createPipeline(me, { pageIds: ['64b000000000000000000002'] });
    const [strip, hide] = pipeline.slice(-2);
    assert.deepEqual(strip.$addFields['preferences.intents'], { $setDifference: [{ $ifNull: ['$preferences.intents', []] }, ['dating']] });
    assert.deepEqual(hide, { $project: { 'profileConfig.openToDating': 0, 'profileConfig.openToDatingUpdatedAt': 0 } });
});

test('Kultura feeds follow "Quiero aprender con" both ways; empty means anyone', () => {
    const withPrefs = JSON.stringify(preferredGender(createPipeline(me, { idsOnly: true, intent: 'language_exchange' })));
    // Their gender must be one I chose...
    assert.match(withPrefs, /"\$in":\[\{"\$ifNull":\["\$userInfo.gender",null\]\},\["F"\]\]/);
    // ...and my gender must be one they chose, unless they chose nothing.
    assert.match(withPrefs, /"\$eq":\[\{"\$size":\{"\$ifNull":\["\$preferences.preferences",\[\]\]\}\},0\]/);
    assert.match(withPrefs, /"\$in":\["M",\{"\$ifNull":\["\$preferences.preferences",\[\]\]\}\]/);

    const noPrefs = { ...me, preferences: { intents: ['friends'] } };
    const open = preferredGender(createPipeline(noPrefs, { idsOnly: true, intent: 'friends' }));
    assert.equal(open.$match.$expr.$and.length, 1, 'no own-choice condition when I chose nothing');
});

test('scope=country: no distance limit, only my country (case/space insensitive)', () => {
    const meCo = { ...me, effectiveLocation: { coordinates: [-75.56, 6.25], country: 'Colombia' } };
    const geo = createPipeline(meCo, { idsOnly: true, intent: 'language_exchange', scope: 'country' })[0].$geoNear;
    assert.equal(geo.maxDistance, undefined);
    const rule = geo.query['effectiveLocation.country'];
    const re = new RegExp(rule.$regex, rule.$options);
    assert.ok(re.test(' colombia '));
    assert.equal(re.test('Colombia Británica'), false);
});

test('scope=world: no distance limit and no country filter', () => {
    const meCo = { ...me, effectiveLocation: { coordinates: [-75.56, 6.25], country: 'Colombia' } };
    const world = createPipeline(meCo, { idsOnly: true, intent: 'friends', scope: 'world' })[0].$geoNear;
    assert.equal(world.maxDistance, undefined);
    assert.equal(world.query, undefined);
});

test('no scope keeps the distance-limited $geoNear', () => {
    const geo = createPipeline(me, { idsOnly: true, intent: 'friends' })[0].$geoNear;
    assert.equal(geo.maxDistance, 50000);
    assert.equal(geo.query, undefined);
});

test('scope=world caps candidates per country before the global limit', () => {
    const meCo = { ...me, effectiveLocation: { coordinates: [-75.56, 6.25], country: 'Colombia' } };
    for (const intent of ['friends', null]) {
        const stages = createPipeline(meCo, { idsOnly: true, intent, scope: 'world' });
        const group = stages.findIndex(s => s.$group);
        const limit = stages.findIndex(s => s.$limit && typeof s.$limit === 'number' && stages.indexOf(s) > group);
        assert.ok(group > 0, 'groups by country');
        assert.ok(stages[group + 1].$project.users.$slice, 'slices each country');
        assert.ok(limit > group, 'global limit after the per-country cap');
    }
    const country = createPipeline(meCo, { idsOnly: true, intent: 'friends', scope: 'country' });
    assert.equal(country.some(s => s.$group), false);
});

test('scope=area: $geoNear around the map point with the radius; wide areas cap per country', () => {
    const meCo = { ...me, effectiveLocation: { coordinates: [-75.56, 6.25], country: 'Colombia' } };
    const city = createPipeline(meCo, { idsOnly: true, intent: 'friends', scope: 'area', area: { lng: 2.35, lat: 48.85, radius: 50_000 } });
    assert.deepEqual(city[0].$geoNear.near.coordinates, [2.35, 48.85]);
    assert.equal(city[0].$geoNear.maxDistance, 50_000);
    assert.equal(city[0].$geoNear.query, undefined);
    assert.equal(city.some(s => s.$group), false);
    const continent = createPipeline(meCo, { idsOnly: true, intent: 'friends', scope: 'area', area: { lng: 10, lat: 50, radius: 3_000_000 } });
    assert.ok(continent.some(s => s.$group));
});

test('parseArea validates and clamps the radius', () => {
    assert.deepEqual(parseArea({ lat: '48.85', lng: '2.35', radius: '50000' }), { lat: 48.85, lng: 2.35, radius: 50000 });
    assert.equal(parseArea({ lat: '95', lng: '2', radius: '1000' }), null);
    assert.equal(parseArea({ lat: '1', lng: '2' }), null);
    assert.equal(parseArea({ lat: '1', lng: '2', radius: '1' }).radius, 10_000);
    assert.equal(parseArea({ lat: '1', lng: '2', radius: '99999999' }).radius, 10_000_000);
});
