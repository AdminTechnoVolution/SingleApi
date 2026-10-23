const test = require('node:test');
const assert = require('node:assert/strict');
const Subscription = require('../src/models/subscription.model');

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
