const test = require('node:test');
const assert = require('node:assert/strict');
const Subscription = require('../src/models/subscription.model');
const { stripeCheckoutSchema } = require('../src/validators/subscription.validator');
const SubscriptionService = require('../src/services/subscription.service');
const SubscriptionRepository = require('../src/repository/subscription.repository');

test('preserves required Google Play subscription fields', () => {
  for (const path of ['subscriptionId', 'packageName', 'purchaseToken', 'offerToken', 'orderId']) {
    assert.equal(Subscription.schema.path(path).isRequired, true, `${path} must remain required`);
  }
});

test('preserves the existing purchase token index and adds an isolated Stripe index', () => {
  const indexes = Subscription.schema.indexes();
  const purchaseToken = indexes.find(([fields]) => fields.purchaseToken === 1);
  const externalSubscription = indexes.find(([fields]) => fields.externalSubscriptionId === 1);

  assert.deepEqual(purchaseToken?.[1], { unique: true, background: true });
  assert.equal(externalSubscription?.[1].unique, true);
  assert.equal(externalSubscription?.[1].sparse, true);
});

test('accepts only the three supported Stripe checkout plans', () => {
  for (const plan of ['weekly', 'monthly', 'quarterly']) {
    assert.equal(stripeCheckoutSchema.validate({ plan }).error, undefined);
  }
  assert.ok(stripeCheckoutSchema.validate({ plan: 'price_attacker_controlled' }).error);
  assert.ok(stripeCheckoutSchema.validate({}).error);
});

test('resolves Stripe price ids only from server environment variables', () => {
  const previous = process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
  process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = 'price_monthly_test';
  try { assert.equal(SubscriptionService.getStripePriceId('monthly'), 'price_monthly_test'); }
  finally {
    if (previous === undefined) delete process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
    else process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = previous;
  }
  assert.throws(() => SubscriptionService.getStripePriceId('unknown'));
});

test('reads Stripe subscription period dates from subscription items when top-level dates are absent', () => {
  const start = 1_765_000_000;
  const end = 1_767_592_000;
  const subscription = { items: { data: [{ current_period_start: start, current_period_end: end }] } };

  assert.deepEqual(SubscriptionService.stripePeriodDate(subscription, 'current_period_start'), new Date(start * 1000));
  assert.deepEqual(SubscriptionService.stripePeriodDate(subscription, 'current_period_end'), new Date(end * 1000));
});

test('prefers valid top-level Stripe subscription period dates', () => {
  const topLevelEnd = 1_767_592_000;
  const itemEnd = 1_770_000_000;
  const subscription = {
    current_period_end: topLevelEnd,
    items: { data: [{ current_period_end: itemEnd }] }
  };

  assert.deepEqual(SubscriptionService.stripePeriodDate(subscription, 'current_period_end'), new Date(topLevelEnd * 1000));
});

test('does not produce an invalid date when Stripe has no subscription period timestamp', () => {
  assert.equal(SubscriptionService.stripePeriodDate({ items: { data: [{}] } }, 'current_period_end'), undefined);
  assert.equal(SubscriptionService.stripePeriodDate({ current_period_end: Number.NaN }, 'current_period_end'), undefined);
});

test('persists item-level Stripe billing periods from subscription webhooks', async () => {
  const stripeModule = require('stripe');
  const stripeModuleCache = require.cache[require.resolve('stripe')];
  const originalStripeExport = stripeModuleCache.exports;
  const originalRepositoryUpdate = SubscriptionRepository.findOneAndUpdate;
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const start = 1_765_000_000;
  const end = 1_767_592_000;
  let update;
  const subscription = {
    id: 'sub_test',
    customer: 'cus_test',
    status: 'active',
    metadata: { userId: '507f1f77bcf86cd799439011' },
    items: { data: [{ price: { id: 'price_monthly' }, current_period_start: start, current_period_end: end }] },
    latest_invoice: 'in_test'
  };

  stripeModuleCache.exports = () => ({
    webhooks: { constructEvent: () => ({ type: 'customer.subscription.updated', data: { object: subscription } }) }
  });
  SubscriptionRepository.findOneAndUpdate = async (filter, value) => {
    update = { filter, value };
  };
  process.env.STRIPE_SECRET_KEY = 'sk_test_subscription_contract';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_subscription_contract';

  try {
    await SubscriptionService.processStripeWebhook({ body: Buffer.from('{}'), headers: { 'stripe-signature': 'test' } });
  } finally {
    stripeModuleCache.exports = originalStripeExport;
    SubscriptionRepository.findOneAndUpdate = originalRepositoryUpdate;
    if (originalSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalSecretKey;
    if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  }

  assert.equal(update.filter.externalSubscriptionId, 'sub_test');
  assert.deepEqual(update.value.$set.currentPeriodStart, new Date(start * 1000));
  assert.deepEqual(update.value.$set.currentPeriodEnd, new Date(end * 1000));
});
