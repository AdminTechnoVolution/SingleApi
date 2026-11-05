const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);

/**
 * Last time each user used the app (`users.lastActivityAt`).
 * Recorded server-side when the user opens Discover (first page, GET /api/user/discover),
 * the first screen after opening the app, so it works for every client already in
 * production without sending anything new from the apps.
 */

/** Minimum time between two writes for the same user (per process). */
const WRITE_INTERVAL_MS = 5 * 60 * 1000; // re-opening Discover several times in a row writes once
const MAX_TRACKED_USERS = 50_000;

/** userId → epoch ms of the last write issued by this process. */
const lastWritten = new Map();

const defaultWriter = (userId, at) =>
    // Lazy require keeps this module loadable without mongoose models (tests, load order).
    // $max: a delayed write never moves the date backwards.
    require('../models/user.model').updateOne({ _id: userId }, { $max: { lastActivityAt: at } });

let writer = defaultWriter;

/** Fire-and-forget: never blocks or fails the request that triggered it. */
const recordActivity = (userId, now = Date.now()) => {
    if (!userId) return false;
    const id = String(userId);
    const previous = lastWritten.get(id);
    if (previous !== undefined && now - previous < WRITE_INTERVAL_MS) return false;
    if (lastWritten.size >= MAX_TRACKED_USERS) lastWritten.clear();
    lastWritten.set(id, now);

    Promise.resolve()
        .then(() => writer(id, new Date(now)))
        .catch((err) => {
            lastWritten.delete(id);
            logger.error(`Error recording last activity for ${id}: ${err}`, { className: filename });
        });
    return true;
};

/** Test hooks. */
const _setWriter = (fn) => { writer = fn || defaultWriter; };
const _reset = () => lastWritten.clear();

module.exports = { recordActivity, WRITE_INTERVAL_MS, _setWriter, _reset };
