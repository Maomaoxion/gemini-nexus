import { appendTextBlockToHistory } from './block_render.js';
import { isToolOutputText } from '../../shared/text/tool_call_text.js';
import { hasMatchingReplyMedia } from './message_matchers.js';

export class MessageReplyRenderState {
    constructor() {
        this.storageRenderedMessageCounts = new Map();
    }

    hasPersistedAiReply(session, request) {
        if (!session || !Array.isArray(session.messages) || session.messages.length === 0) {
            return false;
        }

        const lastMessage = session.messages[session.messages.length - 1];
        if (!lastMessage || lastMessage.role !== 'ai') return false;

        const expectedText = request.text || '';
        const actualText = lastMessage.text || '';
        const mediaMatches = hasMatchingReplyMedia(lastMessage, request);
        const textMatches = expectedText
            ? actualText === expectedText || actualText.startsWith(expectedText)
            : actualText.length > 0 || mediaMatches;
        if (!textMatches) return false;

        if (request.thoughts) {
            const actualThoughts = lastMessage.thoughts || '';
            return (
                actualThoughts === request.thoughts || actualThoughts.startsWith(request.thoughts)
            );
        }

        return true;
    }

    markSessionRenderedFromStorage(sessionId, messageCount) {
        if (!sessionId || !Number.isInteger(messageCount)) return;
        this.storageRenderedMessageCounts.set(sessionId, messageCount);
    }

    hasStorageRenderedAiReply(session, request) {
        if (!session || !session.id) return false;
        const renderedCount = this.storageRenderedMessageCounts.get(session.id);
        if (!Number.isInteger(renderedCount)) return false;
        if (!Array.isArray(session.messages) || renderedCount < session.messages.length) {
            return false;
        }
        return this.hasPersistedAiReply(session, request);
    }
}

// Keep the session model in step with what is on screen. The chat view is
// rebuilt from session.messages on every switch, so a terminal reply the
// storage round-trip did not carry (storage write failed / skipped) would
// disappear as soon as the user switches chats.
function ensureSessionAiRow(handler, session, request) {
    if (request.status !== 'success' && request.status !== 'error') return;
    if (handler.hasPersistedAiReply(session, request)) return;

    handler.sessionManager.addAiMessage(session.id, request);
}

export function renderGeminiReply(handler, session, request) {
    if (!session) return;

    if (request.status === 'success') {
        handler.sessionManager.updateContext(session.id, request.context);
    }

    ensureSessionAiRow(handler, session, request);

    // Error and cancelled replies need the same streaming-bubble teardown
    // as success, otherwise the partial streaming bubble is left dangling
    // (visible ghost with stale content, no way to dismiss).
    const isTerminal =
        request.status === 'success' ||
        request.status === 'error' ||
        request.status === 'cancelled';

    // The reply row was just recorded on the session, so its index is the last
    // one; retrying resends the user turn above it.
    const replyIndex = session.messages.length - 1;
    const retryHandler = handler.app?.prompt?.getMessageRetryOptions?.(replyIndex)?.onRetry || null;
    const turnRetryHandler =
        request.status === 'error' && request.retryable === false ? null : retryHandler;
    const turnStartIndex = findTurnStartIndex(session.messages, replyIndex);
    const deleteHandler =
        (turnStartIndex >= 0
            ? handler.app?.prompt?.getTurnDeleteOptions?.(turnStartIndex)?.onDelete
            : null) ||
        handler.app?.prompt?.getMessageDeleteOptions?.(replyIndex)?.onDelete ||
        null;
    const turnView = handler.ui.getTurnView?.();

    if (handler.streamingBubble) {
        if (handler.hasStorageRenderedAiReply(session, request)) {
            handler.resetStream({ remove: true });
            return;
        }

        if (isTerminal) {
            // Finalize the streaming bubble with the terminal text so the
            // partial stream is replaced by the final (possibly error) text.
            // For error/cancelled we still finalize — the bubble then shows
            // the error message with the appropriate styling from the
            // render layer.
            handler.streamingBubble.finalize(request.text, request.thoughts, {
                thoughtsDurationSeconds: request.thoughtsDurationSeconds,
            });
            handler.streamingBubble.setRetryHandler?.(retryHandler);
            turnView?.setRetryHandler?.(turnRetryHandler);
            turnView?.setDeleteHandler?.(deleteHandler);

            if (request.status === 'success') {
                if (request.images && request.images.length > 0) {
                    handler.streamingBubble.addImages(request.images);
                }

                if (request.sources && request.sources.length > 0) {
                    handler.streamingBubble.addSources(request.sources);
                }
            }

            // Error replies get the error tint on the already-rendered bubble.
            if (
                request.status === 'error' &&
                typeof handler.streamingBubble.markError === 'function'
            ) {
                handler.streamingBubble.markError(request.errorKind, request.retryable);
            }

            handler.streamingBubble = null;
            return;
        }

        // Non-terminal status (shouldn't happen, but be safe): keep streaming.
        handler.streamingBubble.update(request.text || '', request.thoughts, { isStreaming: true });
        return;
    }

    // No active streaming bubble — append a new message.
    if (handler.hasStorageRenderedAiReply(session, request)) {
        return;
    }

    const textBlockOptions = {
        text: request.text,
        attachment: request.images,
        thoughts: request.thoughts,
        sources: request.sources,
        isFinal: true,
        thoughtsDurationSeconds: request.thoughtsDurationSeconds,
        isError: request.status === 'error',
        errorKind: request.status === 'error' ? request.errorKind : undefined,
        retryable: request.status === 'error' ? request.retryable : undefined,
        onRetry: retryHandler,
        onDelete: deleteHandler,
    };
    const hasTurnTextBlock = typeof turnView?.appendTextBlock === 'function';
    const textBlockContainer = hasTurnTextBlock
        ? null
        : handler.ui.getTurnContainer?.() || handler.ui.historyDiv;
    appendTextBlockToHistory(turnView, textBlockContainer, textBlockOptions);
    if (hasTurnTextBlock) {
        turnView.setRetryHandler(turnRetryHandler);
        turnView.setDeleteHandler(deleteHandler);
    }
}

function findTurnStartIndex(messages, endIndex) {
    if (!Array.isArray(messages)) return -1;

    for (let index = endIndex - 1; index >= 0; index--) {
        const message = messages[index];
        if (!message || message.role !== 'user') continue;
        if (message.kind === 'tool-output' || isToolOutputText(message.text)) continue;
        return index;
    }

    return -1;
}
