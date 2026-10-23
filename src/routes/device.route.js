const express = require('express');
const validateToken = require('../../shared/middlewares/validateToken');
const validateBody = require('../../shared/middlewares/validateBody');
const { pushTokenSchema } = require('../validators/device.validator');
const DeviceController = require('../controllers/device.controller');

const router = express.Router();
router.put('/devices/push-token', validateToken, validateBody(pushTokenSchema), DeviceController.registerPushToken);
router.delete('/devices/push-token', validateToken, validateBody(pushTokenSchema), DeviceController.removePushToken);

module.exports = router;
