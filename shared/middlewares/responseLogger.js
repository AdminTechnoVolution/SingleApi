const logger = require('../config/logger');
const path = require('path');
const filename = path.basename(__filename);
const constants = require('../util/constants');

function responseLogger(req, res, next) {
    const originalSend = res.send;
    res.send = function (body) {
        try {
            const message = `Response HTTP Status: [${res.statusCode}] Method: [${req.method}] Path: [${req.originalUrl}]`;
            logger.info({ message: message, className: filename, req: req });
        } catch (err) {
            logger.error({ message: constants.ERROR_GENERIC_LOGGING_RESPONSE, className: filename, req: req });
        }
        return originalSend.call(this, body);
    };

    next();
}

module.exports = responseLogger;
