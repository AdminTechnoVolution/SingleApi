const BlindDateService = require('../services/blindDate.service');

const handle = (action) => async (req, res, next) => {
  try {
    res.status(200).json(await action(req));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createRoom: handle(BlindDateService.createRoom),
  listRooms: handle(BlindDateService.listRooms),
  myRoom: handle(BlindDateService.myRoom),
  joinRoom: handle(BlindDateService.joinRoom),
  leaveRoom: handle(BlindDateService.leaveRoom),
  matchIntent: handle(BlindDateService.matchIntent),
  turnCredentials: handle(BlindDateService.turnCredentials),
  getPreferences: handle(BlindDateService.getPreferences),
  reportPeer: handle(BlindDateService.reportPeer)
};
