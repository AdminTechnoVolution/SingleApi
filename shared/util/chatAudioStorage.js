const AzureUploader = require('./AzureUploader');

/** Lazily created so tests and code paths that never touch audio don't need storage env vars. */
let uploader = null;
const getChatAudioUploader = () => {
    if (!uploader) uploader = new AzureUploader(process.env.S3_CONNECTION_STRING, process.env.S3_CONTAINER);
    return uploader;
};

module.exports = { getChatAudioUploader };
