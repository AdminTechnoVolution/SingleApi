const InterestService = require('../services/interest.service');

const getInterests = async (req, res, next) => {
  try {
    const jsonResponse = await InterestService.getInterests();
    res.status(200).json(jsonResponse);
  } catch (err) {
    next(err);
  }
};

module.exports = { getInterests };
