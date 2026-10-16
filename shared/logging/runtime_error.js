/**
 * Readers for `chrome.runtime.lastError`.
 *
 * Chrome only exposes the last error inside an async callback, and it surfaces
 * as a plain string rather than an Error. Callers that log want the string and
 * callers that throw or compare want an Error, so both shapes live here instead
 * of every call site repeating the optional-chaining guard.
 */

/** @returns {Error | null} */
export function getRuntimeLastError() {
    const message = chrome.runtime?.lastError?.message;
    return message ? new Error(message) : null;
}

/** @returns {string | null} */
export function getRuntimeLastErrorMessage() {
    return chrome.runtime?.lastError?.message || null;
}
