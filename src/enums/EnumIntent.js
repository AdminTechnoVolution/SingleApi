/**
 * What a user wants from a connection (Kultura).
 * Absent intents = legacy client/user = dating (Single).
 */
const Intent = Object.freeze({
    FRIENDS: 'friends',
    LANGUAGE_EXCHANGE: 'language_exchange',
    DATING: 'dating'
});

module.exports = Intent;
