const c = require('../../shared/util/constants');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const SubscriptionService = require('../services/subscription.service');
const DlocalGoService = require('../services/dlocalgo.service');

const createSubscription = async (req, res, next) => {
  try {
    if (!req.body) throw new BusinessException(c.ERROR_BAD_REQUEST_RESPONSE);

    let jsonResponse = await SubscriptionService.createSubscription(req);
    res.status(200).json(jsonResponse);
  } catch (err) {
    next(err);
  }
};

const getEntitlement = async (req, res, next) => {
  try { res.status(200).json(await SubscriptionService.getEntitlement(req)); }
  catch (err) { next(err); }
};

const getStripePlans = async (req, res, next) => {
  try { res.status(200).json(await SubscriptionService.getStripePlans()); }
  catch (err) { next(err); }
};

const createCheckoutSession = async (req, res, next) => {
  try { res.status(200).json(await SubscriptionService.createCheckoutSession(req)); }
  catch (err) { next(err); }
};

const createPortalSession = async (req, res, next) => {
  try { res.status(200).json(await SubscriptionService.createPortalSession(req)); }
  catch (err) { next(err); }
};

const stripeWebhook = async (req, res, next) => {
  try {
    await SubscriptionService.processStripeWebhook(req);
    res.status(200).json({ received: true });
  } catch (err) { next(err); }
};

const handle = (run) => async (req, res, next) => {
  try { res.status(200).json(await run(req)); }
  catch (err) { next(err); }
};

const getDlocalGoPlans = handle(() => DlocalGoService.getPlans());
const createDlocalGoCheckout = handle(req => DlocalGoService.createCheckout(req));
const confirmDlocalGoCheckout = handle(req => DlocalGoService.confirmCheckout(req));
const cancelDlocalGoSubscription = handle(req => DlocalGoService.cancel(req));

/** Always 200 (dLocal Go retries anything else for 30 days); the body is only a hint to re-sync. */
const dlocalGoWebhook = async (req, res) => {
  try { await DlocalGoService.processWebhook(req); }
  catch (err) { require('../../shared/config/logger').error(`dLocal Go webhook failed: ${err}`, { className: 'subscription.controller.js' }); }
  res.status(200).json({ received: true });
};

module.exports = {
  createSubscription, getEntitlement, getStripePlans, createCheckoutSession, createPortalSession, stripeWebhook,
  getDlocalGoPlans, createDlocalGoCheckout, confirmDlocalGoCheckout, cancelDlocalGoSubscription, dlocalGoWebhook
};
