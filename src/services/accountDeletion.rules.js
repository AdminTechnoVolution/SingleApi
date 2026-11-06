/**
 * Pure rules for account deletion (no I/O), shared by user.service and the tests.
 */

/** Report reason that marks a child-safety (CSAM/CSAE) case: its evidence is kept. */
const CHILD_SAFETY_REASON = 'minor_safety';
const LEGAL_HOLD_REASON = 'child_safety_report';

/** Web/app subscription statuses that still renew and must be cancelled at the provider. */
const RENEWING_STATUSES = ['active', 'trialing', 'past_due', 'incomplete'];

/** Reports involving the user, in either direction. */
const reportsOfUser = (userId) => ({ $or: [{ reporterUserId: userId }, { reportedUserId: userId }] });

/** Reports that are deleted with the account: everything except child-safety ones. */
const deletableReportsOfUser = (userId) => ({ ...reportsOfUser(userId), reportReason: { $ne: CHILD_SAFETY_REASON } });

/** True when the user was reported for child safety: their evidence goes to a legal hold. */
const requiresLegalHold = (reports, userId) => reports.some(report =>
    report.reportReason === CHILD_SAFETY_REASON && String(report.reportedUserId) === String(userId));

/** Every Azure blob (all sizes) of the user's photos. */
const photoBlobNames = (user) => (user?.photos || []).flatMap(photo =>
    (photo.sizes || []).map(size => photo.path + size.name));

/** Whether a stored subscription still renews and must be cancelled at its provider. */
const needsProviderCancel = (subscription, now = new Date()) => {
    if (subscription.provider === 'google_play') {
        const toDate = subscription.paymentInfo?.toDate;
        const cancelled = subscription.paymentInfo?.cancelReason !== undefined && subscription.paymentInfo?.cancelReason !== null;
        return Boolean(toDate && new Date(toDate) > now && !cancelled);
    }
    return RENEWING_STATUSES.includes(subscription.status) && subscription.cancelAtPeriodEnd !== true;
};

module.exports = {
    CHILD_SAFETY_REASON, LEGAL_HOLD_REASON, RENEWING_STATUSES,
    reportsOfUser, deletableReportsOfUser, requiresLegalHold, photoBlobNames, needsProviderCancel
};
