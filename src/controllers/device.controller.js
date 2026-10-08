const DeviceService = require('../services/device.service');

const registerPushToken = async (req, res, next) => {
    try { res.status(200).json(await DeviceService.registerPushToken(req)); }
    catch (err) { next(err); }
};

const removePushToken = async (req, res, next) => {
    try { res.status(200).json(await DeviceService.removePushToken(req)); }
    catch (err) { next(err); }
};

module.exports = { registerPushToken, removePushToken };
