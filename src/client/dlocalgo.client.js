const crypto = require('crypto');
const BusinessException = require('../../shared/exceptionHandler/BusinessException');

/**
 * dLocal Go API client (https://docs.dlocalgo.com/integration-api).
 * Auth: `Authorization: Bearer <API_KEY>:<SECRET_KEY>`. Keys stay server-side.
 */
const SANDBOX_URL = 'https://api-sbx.dlocalgo.com';

const config = () => {
    const apiKey = process.env.DLOCALGO_API_KEY;
    const secretKey = process.env.DLOCALGO_SECRET_KEY;
    if (!apiKey || !secretKey) throw new BusinessException('DLOCALGO_NOT_CONFIGURED', 503);
    return { apiKey, secretKey, baseUrl: (process.env.DLOCALGO_API_URL || SANDBOX_URL).replace(/\/+$/, '') };
};

const request = async (method, path, body, fetchImpl = fetch) => {
    const { apiKey, secretKey, baseUrl } = config();
    const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}:${secretKey}`,
            ...(body !== undefined && { 'Content-Type': 'application/json' })
        },
        ...(body !== undefined && { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
        // Errors: {"code": 3001, "message": "..."}; 3001/3003 = invalid credentials / no authorization.
        const misconfigured = response.status === 401 || response.status === 403 || [3001, 3003].includes(Number(data?.code));
        const error = new BusinessException(misconfigured ? 'DLOCALGO_NOT_CONFIGURED' : 'DLOCALGO_REQUEST_FAILED', misconfigured ? 503 : 502);
        error.details = { status: response.status, path, body: text?.slice(0, 500) };
        throw error;
    }
    return data;
};

/** GET /v1/subscription/plan/:planId */
const getPlan = (planId, fetchImpl) => request('GET', `/v1/subscription/plan/${encodeURIComponent(planId)}`, undefined, fetchImpl);

/** GET /v1/subscription/plan/:planId/subscription/all?page=&page_size= */
const listPlanSubscriptions = (planId, page = 1, pageSize = 50, fetchImpl) =>
    request('GET', `/v1/subscription/plan/${encodeURIComponent(planId)}/subscription/all?page=${page}&page_size=${pageSize}`, undefined, fetchImpl);

/** GET /v1/subscription/plan/:planId/subscription/:subscriptionId/execution/all */
const listExecutions = (planId, subscriptionId, page = 1, pageSize = 50, fetchImpl) =>
    request('GET', `/v1/subscription/plan/${encodeURIComponent(planId)}/subscription/${encodeURIComponent(subscriptionId)}/execution/all?page=${page}&page_size=${pageSize}`, undefined, fetchImpl);

/** PATCH /v1/subscription/plan/:planId/subscription/:subscriptionId/deactivate */
const deactivateSubscription = (planId, subscriptionId, fetchImpl) =>
    request('PATCH', `/v1/subscription/plan/${encodeURIComponent(planId)}/subscription/${encodeURIComponent(subscriptionId)}/deactivate`, undefined, fetchImpl);

/** PATCH /v1/subscription/plan/:planId (name, description, amount and the four URLs) */
const updatePlan = (planId, changes, fetchImpl) => request('PATCH', `/v1/subscription/plan/${encodeURIComponent(planId)}`, changes, fetchImpl);

/** POST /v1/subscription/plan (used by scripts/dlocalgo-setup-plans.js) */
const createPlan = (plan, fetchImpl) => request('POST', '/v1/subscription/plan', plan, fetchImpl);

/**
 * Notification signature (payments docs): header
 * `Authorization: V2-HMAC-SHA256, Signature: <hex>` where
 * hex = HMAC_SHA256(key = SECRET_KEY, message = API_KEY + rawBody).
 */
const isValidSignature = (authorizationHeader, rawBody) => {
    const match = /Signature:\s*([a-f0-9]{64})/i.exec(String(authorizationHeader || ''));
    if (!match) return false;
    const { apiKey, secretKey } = config();
    const expected = crypto.createHmac('sha256', secretKey).update(apiKey + rawBody).digest('hex');
    const received = match[1].toLowerCase();
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
};

module.exports = { getPlan, updatePlan, listPlanSubscriptions, listExecutions, deactivateSubscription, createPlan, isValidSignature, request, SANDBOX_URL };
