// Overall timeout for one-shot fetches (uploads, TTS, auth-style calls).
// Streaming requests use the idle timeout in sse.js instead: a long reasoning
// run is legitimate traffic, so only silence counts as a stall.
export const DEFAULT_FETCH_TIMEOUT_MS = 30000;

// Streaming chat requests only bound the wait for response HEADERS. The stream
// body itself stays unbounded (long reasoning runs are legitimate) and is
// guarded by the SSE idle timeout instead. The budget is deliberately generous:
// a relay that waits for the model's first token before sending headers is
// normal, and cancelling healthy slow channels would be worse than the hang.
export const DEFAULT_HEADERS_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Fetch that fails when response headers do not arrive within `timeoutMs`.
 * The abort reason is a TimeoutError (not AbortError), so callers can tell a
 * stalled provider apart from a user cancellation.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 */
export async function fetchWithHeadersTimeout(
    url,
    init = {},
    timeoutMs = DEFAULT_HEADERS_TIMEOUT_MS
) {
    const upstreamSignal = init.signal || null;
    const { signal, dispose } = withFetchTimeout(upstreamSignal, timeoutMs);

    try {
        return await fetch(url, { ...init, signal });
    } finally {
        dispose();
    }
}

/**
 * Combines an upstream abort signal with an overall timeout. The returned
 * signal aborts when either fires; call dispose() to clear the timer once
 * the request settles. Tolerates a missing upstream signal.
 *
 * @param {AbortSignal|null|undefined} inputSignal
 * @param {number} timeoutMs
 * @returns {{ signal: AbortSignal, dispose: () => void }}
 */
export function withFetchTimeout(inputSignal, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new DOMException(`Fetch timed out after ${timeoutMs}ms`, 'TimeoutError'));
    }, timeoutMs);

    const dispose = () => clearTimeout(timer);

    if (inputSignal) {
        if (inputSignal.aborted) {
            dispose();
            controller.abort(inputSignal.reason);
        } else {
            const onAbort = () => {
                dispose();
                controller.abort(inputSignal.reason);
            };
            inputSignal.addEventListener('abort', onAbort, { once: true });
        }
    }

    return { signal: controller.signal, dispose };
}
