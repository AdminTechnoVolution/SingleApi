const NextLevelService = require('../services/nextLevel.service');

const handle = (run) => async (req, res, next) => {
  try { res.status(200).json(await run(req)); }
  catch (err) { next(err); }
};

const getNextLevel = handle(req => NextLevelService.getStatus(req));
const setNextLevel = handle(req => NextLevelService.setWish(req));

module.exports = { getNextLevel, setNextLevel };
