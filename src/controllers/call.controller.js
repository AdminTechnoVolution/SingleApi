const CallService = require('../services/call.service');

const handle = (action) => async (req, res, next) => {
  try {
    res.status(200).json(await action(req));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  startCall: handle(CallService.startCall),
  getCall: handle(CallService.getCall),
  acceptCall: handle(CallService.acceptCall),
  declineCall: handle(CallService.declineCall),
  cancelCall: handle(CallService.cancelCall),
  endCall: handle(CallService.endCall)
};
