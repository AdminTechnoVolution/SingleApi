const Joi = require('joi');

const pushTokenSchema = Joi.object({
    token: Joi.string().max(4096).required()
});

module.exports = { pushTokenSchema };
