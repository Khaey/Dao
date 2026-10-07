export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { startReviewNotificationWorker } = await import('../dao-backend/src/services/ReviewNotificationWorker');
    startReviewNotificationWorker();
  }
}
