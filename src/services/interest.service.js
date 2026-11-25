const BaseResponse = require('../../shared/util/baseResponse');
const cache = require("../../shared/cache/cache");
const constants = require('../../shared/util/constants');
const InterestRepository = require('../repository/interest.repository');
const consCache = require('../../shared/util/constants.cache');

const CACHE_TTL_SECS = process.env.MASTER_DATA_CACHE_TTL_SECS || 86400;

const getInterests = async () => {
    let interests = cache.get(consCache.CACHE_KEY_INTERESTS);
    if (!interests || interests.length === 0) {
        interests = await InterestRepository.findAllByStatus(constants.STATUS_ACTIVE);
        cache.set(consCache.CACHE_KEY_INTERESTS, interests, CACHE_TTL_SECS);
    }

    return new BaseResponse(true, [], interests);
};

module.exports = { getInterests };
