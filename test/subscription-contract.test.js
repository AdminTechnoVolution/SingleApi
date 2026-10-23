const test = require('node:test');
const assert = require('node:assert/strict');
const Subscription = require('../src/models/subscription.model');
const { stripeCheckoutSchema } = require('../src/validators/subscription.validator');
const SubscriptionService = require('../src/services/subscription.service');

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
