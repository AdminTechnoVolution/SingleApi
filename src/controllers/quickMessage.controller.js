const QuickMessageService = require('../services/quickMessage.service');

const sendQuickMessage = async (req, res, next) => {
  try {
    res.status(200).json(await QuickMessageService.sendQuickMessage(req));
  } catch (err) {
    next(err);
  }
};

const quickMessagesReceived = async (req, res, next) => {
  try {
    res.status(200).json(await QuickMessageService.quickMessagesReceived(req));
  } catch (err) {
    next(err);
  }
};

module.exports = { sendQuickMessage, quickMessagesReceived };
