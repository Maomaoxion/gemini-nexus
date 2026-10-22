import { isToolOutputText } from '../../../shared/text/tool_call_text.js';

// Content used when a tool call has no result row at all (history trimming or
// compression cut it). Providers require one result row per call.
export const TOOL_RESULT_UNAVAILABLE = '[Tool result unavailable]';

/**
 * @param {unknown} message
 * @returns {boolean}
 */
export function isToolCallTurnMessage(message) {
    return Boolean(
        message &&
        message.role === 'ai' &&
        Array.isArray(message.toolCalls) &&
        message.toolCalls.length > 0
    );
}

/**
 * @param {unknown} message
 * @returns {boolean}
 */
export function isToolOutputHistoryMessage(message) {
    if (!message || message.role !== 'user') return false;
    return message.kind === 'tool-output' || isToolOutputText(message.text);
}

/**
 * Maps tool call id → tool name in call order. Pairing falls back to this
 * insertion order when a stored result row lost or changed its id.
 * @param {unknown} toolCalls
 * @returns {Map<string, string>}
 */
export function createPendingToolCalls(toolCalls) {
    return new Map(
        (Array.isArray(toolCalls) ? toolCalls : [])
            .filter((call) => call && call.id)
            .map((call) => [call.id, call.name || ''])
    );
}

/**
 * @param {unknown} message
 * @returns {string}
 */
export function getToolOutputContent(message) {
    return message?.toolOutput || message?.text || '';
}

/**
 * Pairs a tool-output row with a still-pending tool call. Returns null for an
 * orphan row (its originating tool_calls turn was trimmed away); providers must
 * drop those because the API rejects unpaired results.
 * @param {Map<string, string>} pendingToolCalls
 * @param {object} message
 * @param {object|null} nextMessage message following the result row, for diagnostics
 * @returns {{ toolCallId: string, toolName: string } | null}
 */
export function resolveToolOutputPairing(pendingToolCalls, message, nextMessage = null) {
    if (!pendingToolCalls || pendingToolCalls.size === 0) return null;

    const storedId = typeof message?.toolCallId === 'string' ? message.toolCallId.trim() : '';
    const toolCallId = pendingToolCalls.has(storedId)
        ? storedId
        : pendingToolCalls.keys().next().value;
    if (!toolCallId) return null;

    if (storedId !== toolCallId) {
        console.warn('[Gemini Nexus] Tool result id mismatch; pairing by order', {
            storedToolCallId: storedId,
            pairedToolCallId: toolCallId,
            toolName: message?.toolName || '',
            expectedToolName: pendingToolCalls.get(toolCallId) || '',
            nextMessageRole: nextMessage?.role || '',
            nextMessageKind: nextMessage?.kind || '',
        });
    }

    const toolName = pendingToolCalls.get(toolCallId) || '';
    pendingToolCalls.delete(toolCallId);
    return { toolCallId, toolName };
}

/**
 * Warns about and clears pending calls that never received a result row.
 * @param {Map<string, string>} pendingToolCalls
 * @param {object|null} nextMessage next history message, or null at history end
 * @returns {Array<{ toolCallId: string, toolName: string }>}
 */
export function flushPendingToolCalls(pendingToolCalls, nextMessage = null) {
    if (!pendingToolCalls || pendingToolCalls.size === 0) return [];

    const pending = Array.from(pendingToolCalls, ([toolCallId, toolName]) => ({
        toolCallId,
        toolName,
    }));
    console.warn(
        nextMessage
            ? '[Gemini Nexus] Tool results missing from history'
            : '[Gemini Nexus] Tool results missing at end of history',
        {
            toolCallIds: pending.map((entry) => entry.toolCallId),
            toolNames: pending.map((entry) => entry.toolName),
            nextMessageRole: nextMessage?.role || '',
            nextMessageKind: nextMessage?.kind || '',
            nextMessageToolCallId: nextMessage?.toolCallId || '',
        }
    );
    pendingToolCalls.clear();
    return pending;
}
