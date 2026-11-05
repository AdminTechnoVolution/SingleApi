const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);
const c = require('../../shared/util/constants.frontcodes');
const DataLayerException = require('../../shared/exceptionHandler/DataLayerException');
const QuickMessage = require('../models/quickMessage.model');

const findByAnyFilter = async (filter) => {
    try {
        return await QuickMessage.find(filter).sort({ created_at: 1 });
    } catch (err) {
        logger.error(`Error in findByAnyFilter. Error: ${err}`, { className: filename });
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
}

const findOneByFilter = async (filter) => {
    try {
        return await QuickMessage.findOne(filter);
    } catch (err) {
        logger.error(`Error in findOneByFilter. Error: ${err}`, { className: filename });
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
}

const findByPipeline = async (pipeline) => {
    try {
        return await QuickMessage.aggregate(pipeline);
    } catch (err) {
        logger.error(`Error in findByPipeline. Error: ${err}`, { className: filename });
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
}

async function save(quickMessage) {
    try {
        return await quickMessage.save();
    } catch (err) {
        logger.error(`Error in save. Error: ${err}`, { className: filename });
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
}

const deleteManyByFilter = async (filter) => {
    try {
        return await QuickMessage.deleteMany(filter);
    } catch (err) {
        logger.error(`Error in deleteManyByFilter. Error: ${err}`, { className: filename });
        throw new DataLayerException(c.CODE_INTERNAL_SERVER_ERROR);
    }
}

module.exports = { findByAnyFilter, findOneByFilter, findByPipeline, save, deleteManyByFilter };
