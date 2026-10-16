// Finish/stop reasons that mean the reply must NOT be treated as success.
// An empty (or cut-off) reply pinned into history poisons conversation
// continuity, so providers throw a descriptive error instead.
const LENGTH_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens', 'incomplete']);
const FILTER_REASONS = new Set([
    'content_filter',
    'refusal',
    'safety',
    'recitation',
    'blocklist',
    'prohibited_content',
    'spii',
]);

/**
 * Maps a provider finish/stop reason to a user-facing error, or null when the
 * reason is a normal completion (stop/end_turn/tool calls) or unknown.
 *
 * @param {unknown} reason
 * @returns {string|null}
 */
export function describeFinishReason(reason) {
    if (!reason || typeof reason !== 'string') return null;
    const normalized = reason.trim().toLowerCase();
    if (LENGTH_REASONS.has(normalized)) {
        return 'Response truncated: the output token limit was reached. Please retry with a shorter request or a higher limit.';
    }
    if (FILTER_REASONS.has(normalized)) {
        return 'Response blocked: the request or response was flagged by content filters. Please rephrase and retry.';
    }
    return null;
}

/**
 * Throws when the reason indicates truncation or filtering.
 *
 * @param {unknown} reason
 */
export function throwIfTruncated(reason) {
    const message = describeFinishReason(reason);
    if (message) throw new Error(message);
}

/**
 * Throws when a provider reported success without producing any content.
 * An empty reply written into history poisons every later turn (some providers
 * reject empty assistant turns outright), so it must surface as an error.
 *
 * @param {unknown} text
 * @param {unknown} thoughts
 */
export function assertNonEmptyResponse(text, thoughts) {
    const hasText = typeof text === 'string' && text.trim().length > 0;
    const hasThoughts = typeof thoughts === 'string' && thoughts.trim().length > 0;
    if (hasText || hasThoughts) return;

    throw new Error('Response was empty: the provider returned no content. Please retry.');
}
