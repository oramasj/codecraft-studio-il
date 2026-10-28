/**
 * parabola_issue_12_solution.ts
 * פתרון מלא ומוכן להגשה עבור Bounty $75 (~275 ₪):
 * Expose retry/backoff knobs for Stellar allowance wait and RPC-lag retry (Parabola-org/parabola#12)
 */

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffFactor?: number;
}

const DEFAULT_ALLOWANCE_RETRY: Required<RetryOptions> = {
  maxAttempts: 6,
  delayMs: 1500,
  backoffFactor: 1.0,
};

const DEFAULT_RPC_LAG_RETRY: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 2000,
  backoffFactor: 1.0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for Stellar allowance with caller-configurable retry and backoff knobs.
 */
export async function waitForAllowance<T>(
  checkFn: (attempt: number) => Promise<T | null | undefined>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_ALLOWANCE_RETRY.maxAttempts);
  const baseDelayMs = Math.max(0, options.delayMs ?? DEFAULT_ALLOWANCE_RETRY.delayMs);
  const backoffFactor = Math.max(1, options.backoffFactor ?? DEFAULT_ALLOWANCE_RETRY.backoffFactor);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await checkFn(attempt);
    if (result !== null && result !== undefined && result !== false) {
      return result;
    }
    if (attempt < maxAttempts && baseDelayMs > 0) {
      const waitTime = Math.round(baseDelayMs * Math.pow(backoffFactor, attempt - 1));
      await sleep(waitTime);
    }
  }
  throw new Error(`Stellar allowance check timed out after ${maxAttempts} attempts`);
}

/**
 * Retries transient Stellar RPC lag errors with caller-configurable retry and backoff knobs.
 */
export async function retryOnTransientRpcLag<T>(
  operation: (attempt: number) => Promise<T>,
  isTransientError: (err: unknown) => boolean = () => true,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_RPC_LAG_RETRY.maxAttempts);
  const baseDelayMs = Math.max(0, options.delayMs ?? DEFAULT_RPC_LAG_RETRY.delayMs);
  const backoffFactor = Math.max(1, options.backoffFactor ?? DEFAULT_RPC_LAG_RETRY.backoffFactor);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt >= maxAttempts) {
        throw err;
      }
      if (baseDelayMs > 0) {
        const waitTime = Math.round(baseDelayMs * Math.pow(backoffFactor, attempt - 1));
        await sleep(waitTime);
      }
    }
  }
  throw lastError;
}
