import { appendMessage } from '../render/message.js';

/**
 * Appends a tool block to the active turn when the turn view supports it,
 * falling back to a standalone tool message for render paths without turns.
 * Keeps the caller's options untouched so per-call differences (autoScroll,
 * kind, tool fields) pass through unchanged.
 *
 * @param {object|null} turnView
 * @param {HTMLElement|null} historyDiv
 * @param {object} options
 * @returns {object|null} rendered message/tool block controller
 */
export function appendToolBlockToHistory(turnView, historyDiv, options) {
    if (turnView?.appendToolBlock) {
        return turnView.appendToolBlock(options);
    }

    return appendMessage(
        historyDiv,
        options.text,
        'user',
        options.attachment ?? null,
        null,
        null,
        options
    );
}

/**
 * Appends an AI text block to the active turn when the turn view supports it,
 * falling back to a standalone AI message for render paths without turns.
 * The caller passes the target container so the fallback keeps its own
 * container selection rules.
 *
 * @param {object|null} turnView
 * @param {HTMLElement|null} historyDiv
 * @param {object} options
 * @returns {object|null} rendered message/text block controller
 */
export function appendTextBlockToHistory(turnView, historyDiv, options) {
    if (turnView?.appendTextBlock) {
        return turnView.appendTextBlock(options);
    }

    return appendMessage(
        historyDiv,
        options.text || '',
        'ai',
        options.attachment ?? null,
        options.thoughts ?? '',
        options.sources ?? null,
        options
    );
}
