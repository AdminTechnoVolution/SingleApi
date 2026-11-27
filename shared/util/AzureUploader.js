const { BlobServiceClient } = require('@azure/storage-blob');

class AzureUploader {

    constructor(connectionString, containerName) {
        this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        this.containerClient = this.blobServiceClient.getContainerClient(containerName);
    }

    async uploadOne(path, blobName, buffer) {
        const fullPath = path + blobName;
        const blockBlobClient = this.containerClient.getBlockBlobClient(fullPath);

        await blockBlobClient.uploadData(buffer, {
            blobHTTPHeaders: { blobContentType: this.getMimeType(fullPath) }
        });

        return { path: path, name: blobName, url: blockBlobClient.url };
    }

    async uploadBatch(files) {
        return Promise.all(
            files.map(async (f) => {
                const sizes = await Promise.all(
                    f.sizes.map(async (sizeObj) => {
                        const responseUpload = await this.uploadOne(f.path, sizeObj.name, sizeObj.file);
                        return {
                            size: sizeObj.size,
                            name: responseUpload.name,
                            url: responseUpload.url
                        };
                    })
                );

                return {
                    isProfile: f.isProfile,
                    path: f.path,
                    sizes
                };
            })
        );
    }

    /** Base URL of the container, with a trailing slash. Blob URLs start with it. */
    get containerUrl() {
        const url = this.containerClient.url;
        return url.endsWith('/') ? url : url + '/';
    }

    async deleteOne(blobName) {
        const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.deleteIfExists();
        return { name: blobName, deleted: true };
    }

    async deleteBatch(blobNames) {
        return Promise.all(
            blobNames.map((name) => this.deleteOne(name))
        );
    }

    getMimeType(filename) {
        const lower = filename.toLowerCase();
        if (lower.endsWith('.png')) return 'image/png';
        if (lower.endsWith('.webp')) return 'image/webp';
        if (lower.endsWith('.m4a')) return 'audio/mp4';
        return 'image/jpeg';
    }
}

module.exports = AzureUploader;
