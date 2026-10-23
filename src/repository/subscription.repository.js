const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const c = require('../../shared/util/constants.frontcodes');
const DataLayerException = require('../../shared/exceptionHandler/DataLayerException');
const Subscription = require('../models/subscription.model');

const findByFilter = async (filter) => {
    try {
        return Subscription.findOne(filter).sort({ created_at: -1 });
    } catch (err) {
        logger.error(`Error in findByUserId. Error: ${err}`, { className: filename });
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
}

async function save(subscription) {
    try {
        return await subscription.save();
    } catch (err) {
        logger.error(`Error in save. Error: ${err}`, { className: filename });
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
}

const findOneAndUpdate = async (filter, update) => {
    try {
        return await Subscription.findOneAndUpdate(filter, update, { new: true, upsert: true, setDefaultsOnInsert: true });
    } catch (err) {
        logger.error(`Error in findOneAndUpdate. Error: ${err}`, { className: filename });
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
};

const findActiveStripeForUser = async (userId) => {
    const now = new Date();
    return Subscription.findOne({
        userId,
        provider: 'stripe',
        status: { $in: ['active', 'trialing'] },
        currentPeriodEnd: { $gt: now }
    }).sort({ currentPeriodEnd: -1 });
};

module.exports = { findByFilter, save, findOneAndUpdate, findActiveStripeForUser };
