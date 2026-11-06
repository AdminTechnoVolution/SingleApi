const path = require('path');
const crypto = require('crypto');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const BaseResponse = require('../../shared/util/baseResponse');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');
const c = require('../../shared/util/constants.frontcodes');
const jwtUtil = require('../../shared/util/jwt');
const DlocalGo = require('../client/dlocalgo.client');
const Subscription = require('../models/subscription.model');
const UserRepository = require('../repository/user.repository');

/**
 * dLocal Go subscriptions for the PWA.
 *
 * dLocal Go charges the plan and its renewals. Its subscription webhook format is
 * not documented, so the server never trusts a webhook body: every state change is
 * read back from the dLocal Go API (`sync`). That happens
 *  - when the buyer returns from checkout (`confirmCheckout`, maps the subscription to the user),
 *  - lazily when a stored period ends (`refreshIfDue`, called by the premium checks),
 *  - when any notification arrives (`processWebhook`, only a hint to sync sooner).
 */

const PLAN_VARIABLES = Object.freeze({
    weekly: 'DLOCALGO_PLAN_WEEKLY_ID',
    monthly: 'DLOCALGO_PLAN_MONTHLY_ID',
    quarterly: 'DLOCALGO_PLAN_QUARTERLY_ID'
});
const PROVIDER = 'dlocalgo';
const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const FORCED_SYNC_INTERVAL_MS = 60 * 1000;
const RETRY_PAST_DUE_MS = 7 * 24 * 60 * 60 * 1000;
const PLAN_CACHE_MS = 10 * 60 * 1000;
const MAX_SUBSCRIPTION_PAGES = 20;

const getPlanId = (plan) => {
    const variable = PLAN_VARIABLES[plan];
    const planId = variable && process.env[variable];
    if (!planId || !/^\d+$/.test(planId)) throw new BusinessException('DLOCALGO_NOT_CONFIGURED', 503);
    return planId;
};

const planNameForId = (planId) => Object.keys(PLAN_VARIABLES).find(plan => process.env[PLAN_VARIABLES[plan]] === String(planId));

// ───────── Signed external_id: ties a checkout to the user that started it ─────────

const signature = (value) => crypto.createHmac('sha256', process.env.DLOCALGO_SECRET_KEY || '').update(value).digest('hex').slice(0, 32);

const buildExternalId = (userId, plan, now = Date.now()) => {
    const payload = `${userId}.${plan}.${now.toString(36)}`;
    return `${payload}.${signature(payload)}`;
};

const parseExternalId = (externalId, now = Date.now()) => {
    const parts = String(externalId || '').split('.');
    if (parts.length !== 4) return null;
    const [userId, plan, issued, sig] = parts;
    const payload = `${userId}.${plan}.${issued}`;
    const expected = signature(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const issuedAt = parseInt(issued, 36);
    if (!Number.isFinite(issuedAt) || now - issuedAt > CHECKOUT_TTL_MS || issuedAt - now > 60_000) return null;
    if (!PLAN_VARIABLES[plan]) return null;
    return { userId, plan, issuedAt };
};

// ───────── Dates and plan mapping ─────────

/** dLocal Go returns ISO datetimes without a zone ("2024-02-06T19:37:52"): read them as UTC. */
const parseDate = (value) => {
    if (!value) return undefined;
    const text = String(value);
    const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
    return Number.isFinite(date.getTime()) ? date : undefined;
};

const INTERVALS = Object.freeze({ DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' });

const addPeriod = (from, frequencyType, frequencyValue = 1) => {
    const date = new Date(from);
    const count = Number(frequencyValue) || 1;
    if (frequencyType === 'DAILY') date.setUTCDate(date.getUTCDate() + count);
    else if (frequencyType === 'WEEKLY') date.setUTCDate(date.getUTCDate() + 7 * count);
    else if (frequencyType === 'YEARLY') date.setUTCFullYear(date.getUTCFullYear() + count);
    else date.setUTCMonth(date.getUTCMonth() + count);
    return date;
};

const minorUnits = (amount, currency) => {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return Math.round(Number(amount) * 10 ** digits);
};

// ───────── Plans ─────────

let planCache = { at: 0, plans: null };

const getPlans = async ({ now = Date.now() } = {}) => {
    if (planCache.plans && now - planCache.at < PLAN_CACHE_MS) return new BaseResponse(true, [], planCache.plans);
    const plans = await Promise.all(Object.keys(PLAN_VARIABLES).map(async plan => {
        const remote = await DlocalGo.getPlan(getPlanId(plan));
        const interval = INTERVALS[remote?.frequency_type];
        if (!remote || remote.active === false || !interval || typeof remote.amount !== 'number' || !remote.currency || !remote.subscribe_url) {
            throw new BusinessException('DLOCALGO_NOT_CONFIGURED', 503);
        }
        return {
            plan,
            unitAmount: minorUnits(remote.amount, remote.currency),
            currency: String(remote.currency).toLowerCase(),
            interval,
            intervalCount: Number(remote.frequency_value) || 1
        };
    }));
    planCache = { at: now, plans };
    return new BaseResponse(true, [], plans);
};

// ───────── Checkout ─────────

const createCheckout = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers.authorization, 'id');
    const user = await UserRepository.findById(userId);
    if (!user) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND, 404);
    const plan = req.body.plan;
    const remote = await DlocalGo.getPlan(getPlanId(plan));
    if (!remote?.subscribe_url || remote.active === false) throw new BusinessException('DLOCALGO_NOT_CONFIGURED', 503);
    const url = new URL(remote.subscribe_url);
    // external_id comes back on the plan's success_url; email pre-fills the checkout.
    url.searchParams.set('external_id', buildExternalId(String(userId), plan));
    if (user.email) url.searchParams.set('email', user.email);
    return new BaseResponse(true, [], { url: url.toString() });
};

/** Max recent subscriptions whose executions are inspected for our external_id (API limit: 100 req/min). */
const MAX_EXECUTION_LOOKUPS = 15;

const executionHasExternalId = async (planId, item, externalId) => {
    const result = await DlocalGo.listExecutions(planId, item.id, 1, 10).catch(() => null);
    const executions = Array.isArray(result?.data) ? result.data : [];
    return executions.some(execution => execution?.external_id != null && String(execution.external_id) === externalId);
};

/**
 * Finds the dLocal Go subscription created by this checkout. Strongest first:
 *  1. the subscription's client_id equals our external_id,
 *  2. one of its executions carries our external_id (the single-execution example has "external_id"),
 *  3. same email as the account (the subscribe link pre-fills it, but the buyer can edit it).
 */
const findCheckoutSubscription = async (planId, externalId, email, issuedAt) => {
    const wantedEmail = String(email || '').trim().toLowerCase();
    const recentItems = [];
    for (let page = 1; page <= MAX_SUBSCRIPTION_PAGES; page++) {
        const result = await DlocalGo.listPlanSubscriptions(planId, page, 50);
        const items = Array.isArray(result?.data) ? result.data : [];
        for (const item of items) {
            if (item?.id == null || item.active === false) continue;
            const createdAt = parseDate(item.created_at);
            // created_at has no documented zone: allow a day of slack around the checkout start.
            const recent = !createdAt || createdAt.getTime() >= issuedAt - CHECKOUT_TTL_MS;
            if (String(item.client_id || '') === externalId) recentItems.push({ item, rank: 3, createdAt: createdAt?.getTime() || 0 });
            else if (recent) recentItems.push({ item, rank: 0, createdAt: createdAt?.getTime() || 0 });
        }
        if (!items.length || page >= (Number(result?.total_pages) || 1)) break;
    }
    recentItems.sort((a, b) => b.createdAt - a.createdAt);
    let lookups = 0;
    for (const entry of recentItems) {
        if (entry.rank === 3) continue;
        if (lookups < MAX_EXECUTION_LOOKUPS && entry.item.status === 'CONFIRMED') {
            lookups++;
            if (await executionHasExternalId(planId, entry.item, externalId)) { entry.rank = 2; continue; }
        }
        if (wantedEmail && String(entry.item.client_email || '').trim().toLowerCase() === wantedEmail) entry.rank = 1;
    }
    const candidates = recentItems.filter(entry => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank || b.createdAt - a.createdAt);
    for (const { item } of candidates) {
        const claimed = await Subscription.findOne({ externalSubscriptionId: externalSubscriptionId(item.id) });
        if (!claimed || claimed.userId == null) return { item, claimed: null };
        return { item, claimed };
    }
    return null;
};

const externalSubscriptionId = (id) => `${PROVIDER}:${id}`;

/**
 * Called by the PWA when the buyer comes back with `?external_id=`. Only the user
 * that started the checkout can claim it (signed id + same session user).
 */
const confirmCheckout = async (req) => {
    const userId = String(jwtUtil.getValueFromJwtToken(req.headers.authorization, 'id'));
    const parsed = parseExternalId(req.body.externalId);
    if (!parsed || parsed.userId !== userId) throw new BusinessException('DLOCALGO_INVALID_CHECKOUT', 400);
    const user = await UserRepository.findById(userId);
    if (!user) throw new BusinessException(c.CODE_ERROR_USER_NOTFOUND, 404);

    const planId = getPlanId(parsed.plan);
    const found = await findCheckoutSubscription(planId, req.body.externalId, user.email, parsed.issuedAt);
    if (!found) return new BaseResponse(true, [], { status: 'pending' });
    if (found.claimed && String(found.claimed.userId) !== userId) throw new BusinessException('DLOCALGO_INVALID_CHECKOUT', 400);
    const { item } = found;
    // CREATED = the first payment is not done yet (async methods): keep polling.
    if (item.status !== 'CONFIRMED') return new BaseResponse(true, [], { status: 'pending' });
    const record = await claimSubscription(userId, parsed.plan, planId, item);
    return new BaseResponse(true, [], { status: record.status === 'active' ? 'active' : 'pending' });
};

/** Stores (or re-links) a confirmed dLocal Go subscription for the user that paid it. */
const claimSubscription = async (userId, plan, planId, item, executions = []) => {
    const record = await Subscription.findOneAndUpdate(
        { externalSubscriptionId: externalSubscriptionId(item.id) },
        {
            $set: {
                userId,
                provider: PROVIDER,
                subscriptionId: String(item.id),
                packageName: PROVIDER,
                purchaseToken: externalSubscriptionId(item.id),
                offerToken: plan,
                orderId: String(item.subscription_token || item.id),
                externalSubscriptionId: externalSubscriptionId(item.id),
                externalCustomerId: item.client_id != null ? String(item.client_id) : undefined,
                externalPlanId: String(planId),
                updated_at: new Date()
            },
            $setOnInsert: { created_at: new Date() }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    await applyRemoteState(record, item, executions);
    return record;
};

// ───────── Sync (the API is the source of truth) ─────────

/** Writes the dLocal Go subscription state onto our record. */
const applyRemoteState = async (record, remote, executions, now = new Date()) => {
    const plan = remote.plan || {};
    const next = parseDate(remote.scheduled_date);
    const lastCompleted = executions
        .filter(execution => execution?.status === 'COMPLETED')
        .map(execution => parseDate(execution.updated_at) || parseDate(execution.created_at))
        .filter(Boolean)
        .sort((a, b) => b - a)[0];
    const update = { lastSyncedAt: now, updated_at: now };

    if (remote.active === false) {
        // Cancelled (by us or by the buyer): Premium lasts until the paid period ends.
        update.cancelAtPeriodEnd = true;
        update.status = record.currentPeriodEnd && record.currentPeriodEnd > now ? 'active' : 'canceled';
    } else if (remote.status !== 'CONFIRMED') {
        update.status = 'incomplete';
    } else if (next && next > now) {
        update.status = 'active';
        update.cancelAtPeriodEnd = false;
        update.currentPeriodEnd = next;
        update.currentPeriodStart = lastCompleted || record.currentPeriodStart || now;
    } else if (!record.currentPeriodEnd) {
        // Just confirmed but no future charge date: one period from now.
        update.status = 'active';
        update.currentPeriodStart = now;
        update.currentPeriodEnd = addPeriod(now, plan.frequency_type, plan.frequency_value);
    } else {
        // Renewal date passed and not charged yet (pending or declined).
        update.status = record.currentPeriodEnd > now ? 'active' : 'past_due';
    }
    Object.assign(record, update);
    await Subscription.updateOne({ _id: record._id }, { $set: update });
    return record;
};

/** Re-reads one stored subscription from dLocal Go. */
const sync = async (record, now = new Date()) => {
    const executions = await DlocalGo.listExecutions(record.externalPlanId, record.subscriptionId, 1, 50).catch(() => null);
    const list = Array.isArray(executions?.data) ? executions.data : [];
    let remote = list.find(execution => execution?.subscription)?.subscription;
    if (!remote) {
        for (let page = 1; page <= MAX_SUBSCRIPTION_PAGES && !remote; page++) {
            const result = await DlocalGo.listPlanSubscriptions(record.externalPlanId, page, 50);
            const items = Array.isArray(result?.data) ? result.data : [];
            remote = items.find(item => String(item?.id) === String(record.subscriptionId));
            if (!items.length || page >= (Number(result?.total_pages) || 1)) break;
        }
    }
    if (!remote) {
        await Subscription.updateOne({ _id: record._id }, { $set: { lastSyncedAt: now } });
        return record;
    }
    return applyRemoteState(record, remote, list, now);
};

/** Lazy renewal check: a stored period ended → ask dLocal Go whether it renewed. */
const refreshIfDue = async (userId, now = new Date()) => {
    try {
        const records = await Subscription.find({
            userId,
            provider: PROVIDER,
            status: { $in: ['active', 'past_due', 'incomplete'] },
            currentPeriodEnd: { $lte: now, $gt: new Date(now.getTime() - RETRY_PAST_DUE_MS) },
            $or: [{ lastSyncedAt: null }, { lastSyncedAt: { $lt: new Date(now.getTime() - SYNC_INTERVAL_MS) } }]
        });
        for (const record of records) await sync(record, now);
    } catch (err) {
        logger.error(`dLocal Go refresh failed for ${userId}: ${err}`, { className: filename });
    }
};

// ───────── Cancel ─────────

const cancel = async (req) => {
    const userId = jwtUtil.getValueFromJwtToken(req.headers.authorization, 'id');
    const record = await Subscription.findOne({ userId, provider: PROVIDER, status: 'active', cancelAtPeriodEnd: { $ne: true } }).sort({ currentPeriodEnd: -1 });
    if (!record) throw new BusinessException(c.CODE_ERROR_SUBSCRIPTION_NOTFOUND, 404);
    await DlocalGo.deactivateSubscription(record.externalPlanId, record.subscriptionId);
    await Subscription.updateOne({ _id: record._id }, { $set: { cancelAtPeriodEnd: true, lastSyncedAt: new Date(), updated_at: new Date() } });
    return new BaseResponse(true, [], { cancelAtPeriodEnd: true, renewsAt: record.currentPeriodEnd || null });
};

// ───────── Webhook (hint only) ─────────

const pickIds = (body) => {
    const sources = [body, body?.subscription, body?.data, body?.data?.subscription].filter(Boolean);
    const ids = new Set();
    const tokens = new Set();
    for (const source of sources) {
        for (const key of ['subscription_id', 'subscriptionId']) if (source[key] != null) ids.add(String(source[key]));
        if (source.subscription_token) tokens.add(String(source.subscription_token));
    }
    if (body?.subscription?.id != null) ids.add(String(body.subscription.id));
    return { ids: [...ids], tokens: [...tokens] };
};

/**
 * Server-side fallback for checkouts whose buyer never came back to the PWA: recent
 * CONFIRMED subscriptions not stored yet are claimed through the signed external_id
 * that the first execution carries (only our own HMAC-signed ids are accepted).
 */
const CLAIM_INTERVAL_MS = 30 * 1000;
let lastClaimRun = 0;
const claimRecentCheckouts = async (now = new Date()) => {
    if (now.getTime() - lastClaimRun < CLAIM_INTERVAL_MS) return 0;
    lastClaimRun = now.getTime();
    let claimed = 0;
    for (const plan of Object.keys(PLAN_VARIABLES)) {
        let planId;
        try { planId = getPlanId(plan); } catch { continue; }
        for (let page = 1; page <= 2; page++) {
            const result = await DlocalGo.listPlanSubscriptions(planId, page, 50).catch(() => null);
            const items = Array.isArray(result?.data) ? result.data : [];
            for (const item of items) {
                if (item?.id == null || item.active === false || item.status !== 'CONFIRMED') continue;
                const createdAt = parseDate(item.created_at);
                if (createdAt && now.getTime() - createdAt.getTime() > CHECKOUT_TTL_MS * 2) continue;
                const existing = await Subscription.findOne({ externalSubscriptionId: externalSubscriptionId(item.id) });
                if (existing?.userId) continue;
                const list = await DlocalGo.listExecutions(planId, item.id, 1, 10).catch(() => null);
                const executions = Array.isArray(list?.data) ? list.data : [];
                // The signed id is checked against the subscription's creation, so late retries still claim it.
                const owner = executions.map(execution => parseExternalId(execution?.external_id, createdAt ? createdAt.getTime() : now.getTime())).find(parsed => parsed && parsed.plan === plan);
                if (!owner) continue;
                const user = await UserRepository.findById(owner.userId).catch(() => null);
                if (!user) continue;
                await claimSubscription(owner.userId, plan, planId, item, executions);
                claimed++;
                logger.info(`dLocal Go subscription ${item.id} claimed for ${owner.userId} from a notification`, { className: filename });
            }
            if (!items.length || page >= (Number(result?.total_pages) || 1)) break;
        }
    }
    return claimed;
};

const processWebhook = async (req, now = new Date()) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    let verified = false;
    try { verified = DlocalGo.isValidSignature(req.headers.authorization, raw); } catch { verified = false; }
    // Logged so the real (undocumented) subscription payload can be confirmed in production.
    logger.info(`dLocal Go notification (signature ${verified ? 'valid' : 'missing/invalid'}): ${raw.slice(0, 1000)}`, { className: filename });
    let body;
    try { body = JSON.parse(raw); } catch { return; }
    // dLocal Go notifications only carry {"payment_id"}: pick up checkouts nobody confirmed yet.
    await claimRecentCheckouts(now).catch(err => logger.error(`dLocal Go claim failed: ${err}`, { className: filename }));
    const { ids, tokens } = pickIds(body);
    if (!ids.length && !tokens.length) return;
    const records = await Subscription.find({
        provider: PROVIDER,
        $or: [{ subscriptionId: { $in: ids } }, { orderId: { $in: tokens } }],
        $and: [{ $or: [{ lastSyncedAt: null }, { lastSyncedAt: { $lt: new Date(now.getTime() - FORCED_SYNC_INTERVAL_MS) } }] }]
    });
    for (const record of records) await sync(record, now);
};

module.exports = {
    PLAN_VARIABLES, getPlanId, planNameForId, getPlans, createCheckout, confirmCheckout, cancel, refreshIfDue, processWebhook, sync, claimRecentCheckouts,
    // exported for tests
    buildExternalId, parseExternalId, parseDate, addPeriod, minorUnits, applyRemoteState, pickIds,
    _resetPlanCache: () => { planCache = { at: 0, plans: null }; lastClaimRun = 0; }
};
