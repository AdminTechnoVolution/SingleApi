const multer = require('multer');
const c = require('../util/constants.frontcodes');
const constants = require('../util/constants');
const BusinessException = require('../exceptionHandler/BusinessException');

/** Voice notes: one small AAC/m4a file kept in memory, then sent to Blob Storage. */
const allowedMimes = [
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/mpeg"
];

const fileFilter = (req, file, cb) => {
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new BusinessException(c.CODE_AUDIO_ONLY));
    }
};

const uploadAudio = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: { fileSize: constants.AUDIO_MAX_BYTES, files: 1 }
});

module.exports = uploadAudio;
module.exports.allowedMimes = allowedMimes;
