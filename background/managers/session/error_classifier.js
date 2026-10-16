// Shared provider-error classification and retry helpers.
//
// Provides a machine-readable taxonomy (errorKind + retryable) so the prompt
// loop, Quick Ask, and the UI can agree on whether an error is worth retrying
// without each site re-implementing its own string matching.

function isUnavailableWebAuthError(message = '') {
    return (
        message.includes('未登录') ||
        message.includes('Not logged in') ||
        message.includes('Sign in') ||
        // Covers atValue / blValue / fSid and any future token field name.
        message.includes('Missing Gemini Web auth token:') ||
        message.includes('Gemini Web request tokens unavailable')
    );
}

function isRefreshableWebAuthError(message = '') {
    return (
        message.includes('401') ||
        message.includes('403') ||
        message.includes('Missing Gemini Web upload tokens')
    );
}

function isNetworkError(message = '') {
    return (
        message.includes('fetch failed') ||
        message.includes('Network Error') ||
        message.includes('Failed to fetch') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('Check network') ||
        message.includes('No valid response found')
    );
}

function isRateLimited(message = '') {
    return message.includes('429') || message.includes('Too Many Requests');
}

function extractHttpStatusCode(message = '') {
    const match = message.match(/API Error \((\d{3})\)/);
    return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Classifies a provider error message into a machine-readable kind and
 * indicates whether the caller may safely retry the request.
 *
 * @param {string|Error} input - Error message or Error object.
 * @returns {{ kind: string, retryable: boolean }}
 */
export function classifyProviderError(input) {
    const message = input instanceof Error ? input.message || '' : String(input || '');

    // Unavailable web auth (not logged in) cannot be retried automatically;
    // the user must sign in or refresh.
    if (isUnavailableWebAuthError(message)) {
        return { kind: 'auth', retryable: false };
    }

    // Refreshable auth errors (expired tokens, missing upload tokens) are
    // retryable for the Web provider which can force a context refresh.
    if (isRefreshableWebAuthError(message)) {
        return { kind: 'auth', retryable: true };
    }

    if (isRateLimited(message)) {
        return { kind: 'rate_limit', retryable: true };
    }

    const statusCode = extractHttpStatusCode(message);
    if (statusCode !== null) {
        if (statusCode >= 500) return { kind: 'server', retryable: true };
        if (statusCode === 408) return { kind: 'network', retryable: true };
        if (statusCode === 429) return { kind: 'rate_limit', retryable: true };
        // 4xx (other than the handled cases) are request-level problems.
        if (statusCode >= 400 && statusCode < 500) {
            return { kind: 'validation', retryable: false };
        }
    }

    if (isNetworkError(message)) {
        return { kind: 'network', retryable: true };
    }

    return { kind: 'unknown', retryable: false };
}

/**
 * Runs an async operation with automatic retry on transient (retryable)
 * errors. Mirrors the backoff used by the Web provider: exponential delay
 * (2^attempt * 1000ms) with up to 1s jitter, up to `maxAttempts` total tries.
 *
 * AbortError is never retried and propagates immediately so callers can
 * distinguish cancellation from real failures.
 *
 * Auth errors (401/403, expired tokens) are only retryable when the caller
 * can actually refresh credentials between attempts. The Web provider does
 * this via account rotation + context refresh; dedicated API providers
 * (Official/OpenAI/Anthropic) hold a static key, so a 401/403 is guaranteed
 * to fail again and must NOT be retried. Callers opt into refresh-retries by
 * passing `canRefreshAuth: true`.
 *
 * @param {() => Promise<T>} fn - Operation to run.
 * @param {{ signal?: AbortSignal, maxAttempts?: number, canRefreshAuth?: boolean }} [options]
 * @returns {Promise<T>}
 * @template T
 */
export async function withProviderRetry(fn, options = {}) {
    const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 3;
    const canRefreshAuth = options.canRefreshAuth === true;

    let attempt = 0;
    while (true) {
        attempt++;
        try {
            return await fn();
        } catch (error) {
            if (error?.name === 'AbortError') throw error;

            const { kind, retryable } = classifyProviderError(error);
            // A static-key caller cannot fix an auth error by retrying, so
            // never loop on it — surface it to the user immediately.
            const shouldRetry = retryable && !(kind === 'auth' && !canRefreshAuth);
            if (!shouldRetry || attempt >= maxAttempts) throw error;

            const baseDelay = Math.pow(2, attempt) * 1000;
            const jitter = Math.random() * 1000;
            console.warn(
                `[Gemini Nexus] Retryable provider error (${error.message}), retrying... (Attempt ${attempt}/${maxAttempts})`
            );
            await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
        }
    }
}

export { isRefreshableWebAuthError, isUnavailableWebAuthError };
