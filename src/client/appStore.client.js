const fs = require('fs');
const path = require('path');
const logger = require('../../shared/config/logger');
const filename = path.basename(__filename);

/**
 * StoreKit 2 / App Store Server Notifications v2 JWS verification with Apple's official
 * library (@apple/app-store-server-library): x5c chain up to the Apple Root CA - G3,
 * Apple OIDs, ES256 signature, bundle id and environment.
 *
 * Env:
 *   APPLE_BUNDLE_ID              bundle id of the iOS app (first value if comma-separated)
 *   APPLE_APP_APPLE_ID           numeric App Store app id (required to accept Production)
 *   APPLE_IAP_ALLOW_SANDBOX      'false' to reject Sandbox/TestFlight transactions (default: accepted)
 *   APPLE_IAP_ONLINE_CHECKS      'false' to skip OCSP revocation checks (default: on)
 *   APPLE_ROOT_CA_PATHS          extra root certificates (comma-separated .cer paths), optional
 */
const DEFAULT_ROOT_CA = path.join(__dirname, '../../shared/certs/AppleRootCA-G3.cer');

let cached;

const loadRootCertificates = (env = process.env) => {
    const paths = [DEFAULT_ROOT_CA, ...String(env.APPLE_ROOT_CA_PATHS || '').split(',').map(p => p.trim()).filter(Boolean)];
    return paths.map(p => fs.readFileSync(p));
};

/** Verifiers to try in order (Production first, then Sandbox). */
const buildVerifiers = (env = process.env) => {
    const { SignedDataVerifier, Environment } = require('@apple/app-store-server-library');
    const bundleId = String(env.APPLE_BUNDLE_ID || '').split(',')[0].trim();
    if (!bundleId) throw new Error('APPLE_BUNDLE_ID is not configured');
    const roots = loadRootCertificates(env);
    const onlineChecks = env.APPLE_IAP_ONLINE_CHECKS !== 'false';
    const verifiers = [];
    const appAppleId = Number(env.APPLE_APP_APPLE_ID);
    if (Number.isFinite(appAppleId) && appAppleId > 0) {
        verifiers.push({ environment: 'Production', verifier: new SignedDataVerifier(roots, onlineChecks, Environment.PRODUCTION, bundleId, appAppleId) });
    }
    if (env.APPLE_IAP_ALLOW_SANDBOX !== 'false') {
        verifiers.push({ environment: 'Sandbox', verifier: new SignedDataVerifier(roots, onlineChecks, Environment.SANDBOX, bundleId) });
    }
    if (verifiers.length === 0) throw new Error('No App Store environment enabled (set APPLE_APP_APPLE_ID)');
    return verifiers;
};

const getVerifiers = () => {
    if (!cached) cached = buildVerifiers();
    return cached;
};

const tryVerifiers = async (method, jws) => {
    const errors = [];
    for (const { environment, verifier } of getVerifiers()) {
        try {
            return await verifier[method](jws);
        } catch (err) {
            errors.push(`${environment}: ${err?.status ?? err?.message ?? err}`);
        }
    }
    logger.error({ message: `App Store JWS rejected (${method}): ${errors.join('; ')}`, className: filename });
    const error = new Error('Invalid App Store signed data');
    error.appStoreInvalid = true;
    throw error;
};

const verifyTransaction = (signedTransaction) => tryVerifiers('verifyAndDecodeTransaction', signedTransaction);
const verifyRenewalInfo = (signedRenewalInfo) => tryVerifiers('verifyAndDecodeRenewalInfo', signedRenewalInfo);
const verifyNotification = (signedPayload) => tryVerifiers('verifyAndDecodeNotification', signedPayload);

module.exports = { verifyTransaction, verifyRenewalInfo, verifyNotification, buildVerifiers, loadRootCertificates };
