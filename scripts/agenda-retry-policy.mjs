export const AgendaRetryPolicy = {
  lockRetry: {
    maxAttempts: 6,
    delayMs: 30_000,
  },
};

export function shouldRetryLock(lockRetryCount) {
  return Number(lockRetryCount || 0) < AgendaRetryPolicy.lockRetry.maxAttempts;
}

export function nextLockRetryCount(lockRetryCount) {
  return Number(lockRetryCount || 0) + 1;
}

export function effectiveAutoRetries(maxRetriesFromSettings) {
  const n = Number(maxRetriesFromSettings ?? 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function shouldRunAnotherAttempt(currentRetryCount, maxRetries) {
  return Number(currentRetryCount || 0) < Math.max(0, effectiveAutoRetries(maxRetries) - 1);
}
