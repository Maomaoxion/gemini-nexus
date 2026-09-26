/**
 * Shared provider utilities for Gemini Web authentication
 */

/**
 * Assert that a specific auth token exists in context
 * @throws {Error} If token is missing
 */
export function assertAuthToken(context, fieldName) {
    if (!context?.[fieldName]) {
        throw new Error(`Missing Gemini Web auth token: ${fieldName}`);
    }
}

/**
 * Gemini Web client capabilities constant
 */
export const WEB_CLIENT_CAPABILITIES = Object.freeze([4, 5, 6, 8]);

/**
 * Drop `contextIds` from a fetched Web auth context before storing or reusing it.
 * The ids are single-use per request; persisting them makes the next request reuse
 * a stale batch. Returns the remaining auth fields.
 * @param {Record<string, unknown>} context
 */
export function stripNativeContextIds(context = {}) {
    const { contextIds, ...authContext } = context;
    return authContext;
}
