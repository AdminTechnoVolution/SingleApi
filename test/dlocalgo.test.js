const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.DLOCALGO_API_KEY = 'MyMerchantApiKey';
process.env.DLOCALGO_SECRET_KEY = 'MyMerchantSecretKey';
process.env.DLOCALGO_PLAN_WEEKLY_ID = '11';
process.env.DLOCALGO_PLAN_MONTHLY_ID = '12';
process.env.DLOCALGO_PLAN_QUARTERLY_ID = '13';

const DlocalGo = require('../src/client/dlocalgo.client');
const Service = require('../src/services/dlocalgo.service');
const Subscription = require('../src/models/subscription.model');
const UserRepository = require('../src/repository/user.repository');

const USER = '64b7f0c2a1b2c3d4e5f60718';
const authFor = () => ({ authorization: 'token' });
const jwt = require('../shared/util/jwt');

const stub = (object, key, value) => { const original = object[key]; object[key] = value; return () => { object[key] = original; }; };

test('verifies notifications with HMAC_SHA256(secret, apiKey + payload) as documented', () => {
  const payload = '{"payment_id":"DP-283"}';
  const signature = crypto.createHmac('sha256', 'MyMerchantSecretKey').update('MyMerchantApiKey' + payload).digest('hex');
  assert.equal(DlocalGo.isValidSignature(`V2-HMAC-SHA256, Signature: ${signature}`, payload), true);
  assert.equal(DlocalGo.isValidSignature(`V2-HMAC-SHA256, Signature: ${'0'.repeat(64)}`, payload), false);
  assert.equal(DlocalGo.isValidSignature(undefined, payload), false);
});

test('external_id is signed, bound to the user and plan, and expires', () => {
  const now = Date.now();
  const id = Service.buildExternalId(USER, 'monthly', now);
  assert.ok(id.length <= 255);
  assert.deepEqual(Service.parseExternalId(id, now), { userId: USER, plan: 'monthly', issuedAt: now });
  assert.equal(Service.parseExternalId(id.replace(USER, '64b7f0c2a1b2c3d4e5f60719'), now), null);
  assert.equal(Service.parseExternalId(id, now + 25 * 60 * 60 * 1000), null);
  assert.equal(Service.parseExternalId('garbage', now), null);
});

test('reads zone-less dLocal Go dates as UTC and adds plan periods', () => {
  assert.equal(Service.parseDate('2024-02-06T19:37:52').toISOString(), '2024-02-06T19:37:52.000Z');
  assert.equal(Service.parseDate(undefined), undefined);
  const from = new Date('2026-01-31T00:00:00Z');
  assert.equal(Service.addPeriod(from, 'WEEKLY', 1).toISOString(), '2026-02-07T00:00:00.000Z');
  assert.equal(Service.addPeriod(new Date('2026-01-15T00:00:00Z'), 'MONTHLY', 3).toISOString(), '2026-04-15T00:00:00.000Z');
});

test('plan prices are returned in minor units for the PWA formatter', () => {
  assert.equal(Service.minorUnits(14.99, 'USD'), 1499);
  assert.equal(Service.minorUnits(5000, 'CLP'), 5000);
});

test('lists the three plans from dLocal Go', async () => {
  Service._resetPlanCache();
  const plans = { 11: ['WEEKLY', 1, 4.99], 12: ['MONTHLY', 1, 14.99], 13: ['MONTHLY', 3, 34.99] };
  const restore = stub(DlocalGo, 'getPlan', async id => ({ id: Number(id), active: true, currency: 'USD', amount: plans[id][2], frequency_type: plans[id][0], frequency_value: plans[id][1], subscribe_url: `https://checkout-sbx.dlocalgo.com/validate/subscription/tok${id}` }));
  try {
    const { data } = await Service.getPlans();
    assert.deepEqual(data.map(p => [p.plan, p.unitAmount, p.interval, p.intervalCount]), [['weekly', 499, 'week', 1], ['monthly', 1499, 'month', 1], ['quarterly', 3499, 'month', 3]]);
  } finally { restore(); Service._resetPlanCache(); }
});

test('checkout URL carries the signed external_id and pre-filled email', async () => {
  const restores = [
    stub(jwt, 'getValueFromJwtToken', () => USER),
    stub(UserRepository, 'findById', async () => ({ _id: USER, email: 'ana@example.com' })),
    stub(DlocalGo, 'getPlan', async () => ({ active: true, subscribe_url: 'https://checkout-sbx.dlocalgo.com/validate/subscription/tok12' }))
  ];
  try {
    const { data } = await Service.createCheckout({ headers: authFor(), body: { plan: 'monthly' } });
    const url = new URL(data.url);
    assert.equal(url.origin + url.pathname, 'https://checkout-sbx.dlocalgo.com/validate/subscription/tok12');
    assert.equal(url.searchParams.get('email'), 'ana@example.com');
    assert.equal(Service.parseExternalId(url.searchParams.get('external_id')).userId, USER);
  } finally { restores.forEach(r => r()); }
});

test('confirm rejects an external_id that belongs to another user', async () => {
  const restore = stub(jwt, 'getValueFromJwtToken', () => USER);
  try {
    const other = Service.buildExternalId('64b7f0c2a1b2c3d4e5f60719', 'monthly');
    await assert.rejects(Service.confirmCheckout({ headers: authFor(), body: { externalId: other } }), /DLOCALGO_INVALID_CHECKOUT/);
  } finally { restore(); }
});

test('confirm links the CONFIRMED subscription with the same email and stores its next charge date', async () => {
  const externalId = Service.buildExternalId(USER, 'monthly');
  let saved;
  const record = { _id: 'r1', currentPeriodEnd: undefined };
  const restores = [
    stub(jwt, 'getValueFromJwtToken', () => USER),
    stub(UserRepository, 'findById', async () => ({ _id: USER, email: 'Ana@Example.com' })),
    stub(DlocalGo, 'listPlanSubscriptions', async () => ({ total_pages: 1, data: [
      { id: 7, status: 'CONFIRMED', active: true, client_email: 'someone@else.com', created_at: new Date().toISOString().slice(0, 19), scheduled_date: '2099-01-01T00:00:00' },
      { id: 8, status: 'CONFIRMED', active: true, client_email: 'ana@example.com', subscription_token: 'tok', created_at: new Date().toISOString().slice(0, 19), scheduled_date: '2099-02-01T00:00:00', plan: { frequency_type: 'MONTHLY' } }
    ] })),
    stub(DlocalGo, 'listExecutions', async () => ({ data: [] })),
    stub(Subscription, 'findOne', async () => null),
    stub(Subscription, 'findOneAndUpdate', async (filter, update) => { saved = { filter, update }; return record; }),
    stub(Subscription, 'updateOne', async () => ({}))
  ];
  try {
    const { data } = await Service.confirmCheckout({ headers: authFor(), body: { externalId } });
    assert.equal(data.status, 'active');
    assert.equal(saved.filter.externalSubscriptionId, 'dlocalgo:8');
    assert.equal(saved.update.$set.externalPlanId, '12');
    assert.equal(record.currentPeriodEnd.toISOString(), '2099-02-01T00:00:00.000Z');
  } finally { restores.forEach(r => r()); }
});

test('confirm finds the subscription by the external_id on its execution even if the buyer changed the email', async () => {
  const externalId = Service.buildExternalId(USER, 'monthly');
  let saved;
  const created = new Date().toISOString().slice(0, 19);
  const restores = [
    stub(jwt, 'getValueFromJwtToken', () => USER),
    stub(UserRepository, 'findById', async () => ({ _id: USER, email: 'ana@example.com' })),
    stub(DlocalGo, 'listPlanSubscriptions', async () => ({ total_pages: 1, data: [
      { id: 21, status: 'CONFIRMED', active: true, client_email: 'other@buyer.com', created_at: created, scheduled_date: '2099-03-01T00:00:00' },
      { id: 22, status: 'CONFIRMED', active: true, client_email: 'ana.new@mail.com', created_at: created, scheduled_date: '2099-03-01T00:00:00' }
    ] })),
    stub(DlocalGo, 'listExecutions', async (planId, subscriptionId) => ({ data: subscriptionId === 22 ? [{ id: 1, status: 'COMPLETED', external_id: externalId }] : [{ id: 2, status: 'COMPLETED', external_id: 'someone-else' }] })),
    stub(Subscription, 'findOne', async () => null),
    stub(Subscription, 'findOneAndUpdate', async (filter, update) => { saved = { filter, update }; return { _id: 'r2' }; }),
    stub(Subscription, 'updateOne', async () => ({}))
  ];
  try {
    const { data } = await Service.confirmCheckout({ headers: authFor(), body: { externalId } });
    assert.equal(data.status, 'active');
    assert.equal(saved.filter.externalSubscriptionId, 'dlocalgo:22');
  } finally { restores.forEach(r => r()); }
});

test('confirm does not claim a stranger\'s subscription with no external_id or email match', async () => {
  const externalId = Service.buildExternalId(USER, 'monthly');
  const restores = [
    stub(jwt, 'getValueFromJwtToken', () => USER),
    stub(UserRepository, 'findById', async () => ({ _id: USER, email: 'ana@example.com' })),
    stub(DlocalGo, 'listPlanSubscriptions', async () => ({ total_pages: 1, data: [{ id: 31, status: 'CONFIRMED', active: true, client_email: 'x@y.com', created_at: new Date().toISOString().slice(0, 19) }] })),
    stub(DlocalGo, 'listExecutions', async () => ({ data: [{ id: 3, status: 'COMPLETED', external_id: 'other' }] })),
    stub(Subscription, 'findOne', async () => null)
  ];
  try {
    const { data } = await Service.confirmCheckout({ headers: authFor(), body: { externalId } });
    assert.equal(data.status, 'pending');
  } finally { restores.forEach(r => r()); }
});

test('invalid credentials surface as "not configured" (503), not as a generic failure', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '{"code":3001,"message":"Invalid credentials"}' });
  await assert.rejects(DlocalGo.getPlan('12', fetchImpl), err => err.message === 'DLOCALGO_NOT_CONFIGURED' && err.statusCode === 503);
});

test('confirm keeps polling while the first payment is not done (CREATED)', async () => {
  const externalId = Service.buildExternalId(USER, 'monthly');
  const restores = [
    stub(jwt, 'getValueFromJwtToken', () => USER),
    stub(UserRepository, 'findById', async () => ({ _id: USER, email: 'ana@example.com' })),
    stub(DlocalGo, 'listPlanSubscriptions', async () => ({ total_pages: 1, data: [{ id: 9, status: 'CREATED', active: true, client_email: 'ana@example.com' }] })),
    stub(DlocalGo, 'listExecutions', async () => ({ data: [] })),
    stub(Subscription, 'findOne', async () => null)
  ];
  try {
    const { data } = await Service.confirmCheckout({ headers: authFor(), body: { externalId } });
    assert.equal(data.status, 'pending');
  } finally { restores.forEach(r => r()); }
});

test('a cancelled subscription keeps Premium until the paid period ends', async () => {
  const restore = stub(Subscription, 'updateOne', async () => ({}));
  try {
    const now = new Date('2026-05-01T00:00:00Z');
    const paid = { _id: 'a', currentPeriodEnd: new Date('2026-05-20T00:00:00Z') };
    await Service.applyRemoteState(paid, { active: false, status: 'CONFIRMED' }, [], now);
    assert.equal(paid.status, 'active');
    assert.equal(paid.cancelAtPeriodEnd, true);
    const ended = { _id: 'b', currentPeriodEnd: new Date('2026-04-20T00:00:00Z') };
    await Service.applyRemoteState(ended, { active: false, status: 'CONFIRMED' }, [], now);
    assert.equal(ended.status, 'canceled');
  } finally { restore(); }
});

test('a renewal moves the period forward; a missed one turns past_due', async () => {
  const restore = stub(Subscription, 'updateOne', async () => ({}));
  try {
    const now = new Date('2026-05-01T00:00:00Z');
    const renewed = { _id: 'a', currentPeriodEnd: new Date('2026-04-30T00:00:00Z') };
    await Service.applyRemoteState(renewed, { active: true, status: 'CONFIRMED', scheduled_date: '2026-05-30T00:00:00' }, [{ status: 'COMPLETED', updated_at: '2026-04-30T00:05:00' }], now);
    assert.equal(renewed.status, 'active');
    assert.equal(renewed.currentPeriodEnd.toISOString(), '2026-05-30T00:00:00.000Z');
    const missed = { _id: 'b', currentPeriodEnd: new Date('2026-04-30T00:00:00Z') };
    await Service.applyRemoteState(missed, { active: true, status: 'CONFIRMED', scheduled_date: '2026-04-30T00:00:00' }, [{ status: 'DECLINED' }], now);
    assert.equal(missed.status, 'past_due');
  } finally { restore(); }
});

test('webhook bodies are only a hint: ids are extracted, nothing is trusted', () => {
  assert.deepEqual(Service.pickIds({ subscription_id: 5 }), { ids: ['5'], tokens: [] });
  assert.deepEqual(Service.pickIds({ subscription: { id: 6, subscription_token: 'tk' } }), { ids: ['6'], tokens: ['tk'] });
  assert.deepEqual(Service.pickIds({ payment_id: 'DP-1' }), { ids: [], tokens: [] });
});

test('a payment notification claims a CONFIRMED checkout whose buyer never returned to the PWA', async () => {
  Service._resetPlanCache();
  const externalId = Service.buildExternalId(USER, 'monthly');
  const forged = Service.buildExternalId(USER, 'monthly').replace(/.{4}$/, '0000');
  const saved = [];
  const created = new Date().toISOString().slice(0, 19);
  const restores = [
    stub(UserRepository, 'findById', async id => ({ _id: id, email: 'ana@example.com' })),
    stub(DlocalGo, 'listPlanSubscriptions', async planId => ({ total_pages: 1, data: planId === '12' ? [
      { id: 30, status: 'CONFIRMED', active: true, created_at: created, scheduled_date: '2099-03-01T00:00:00', plan: { frequency_type: 'MONTHLY' } },
      { id: 31, status: 'CONFIRMED', active: true, created_at: created, scheduled_date: '2099-03-01T00:00:00' },
      { id: 32, status: 'CREATED', active: true, created_at: created }
    ] : [] })),
    stub(DlocalGo, 'listExecutions', async (planId, id) => ({ data: [{ status: 'COMPLETED', external_id: id === 30 ? externalId : forged, created_at: created }] })),
    stub(Subscription, 'findOne', async () => null),
    stub(Subscription, 'find', async () => []),
    stub(Subscription, 'findOneAndUpdate', async (filter, update) => { saved.push({ filter, update }); return { _id: 'r', currentPeriodEnd: undefined }; }),
    stub(Subscription, 'updateOne', async () => ({}))
  ];
  try {
    await Service.processWebhook({ headers: {}, body: Buffer.from('{"payment_id":"DP-1"}') });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].filter.externalSubscriptionId, 'dlocalgo:30');
    assert.equal(saved[0].update.$set.userId, USER);
    assert.equal(saved[0].update.$set.offerToken, 'monthly');
  } finally { restores.forEach(r => r()); Service._resetPlanCache(); }
});
