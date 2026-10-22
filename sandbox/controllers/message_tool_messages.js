import { appendToolBlockToHistory } from './block_render.js';
import {
    buildToolOutputHistoryText,
    getToolOutputKey,
    getToolOutputStatus,
    getToolStatusKey,
    hasPersistedToolOutput,
} from './message_tools.js';
import {
    findRenderedToolStatus,
    hasRenderedToolOutput,
    removeRenderedToolStatus,
} from './message_tool_render_state.js';

export function handleToolOutputMessage(handler, request) {
    if (!handler.isGeneratingSessionMessage(request)) return;
    handler.app?.prompt?.markGenerationActivity?.();
    const sessionId = handler.getRequestSessionId(request);
    const toolCallText = handler.getRequestToolCallText(request, sessionId);
    // Capture the user's position before the row changes the scroll height.
    const autoScroll = shouldAutoScroll(handler);

    if (!handler.isCurrentSessionMessage(request)) {
        handler.clearStreamState(sessionId);
        return;
    }

    handler.finalizeActiveStream({
        text: handler.getStreamRawText(sessionId) || request.toolCallText,
        thoughts: handler.getStreamThoughts(sessionId),
        clearToolCallJson: true,
    });
    handler.clearStreamState(sessionId);

    const session = handler.sessionManager.getCurrentSession();
    const renderedKey = getToolOutputKey(request);
    if (renderedKey && hasRenderedToolOutput(handler.ui?.historyDiv, renderedKey)) {
        removeRenderedToolStatus(handler.ui?.historyDiv, getToolStatusKey(request));
        return;
    }

    removeRenderedToolStatus(handler.ui?.historyDiv, getToolStatusKey(request));

    if (session && !hasPersistedToolOutput(session, request)) {
        session.messages.push({
            role: 'user',
            text: buildToolOutputHistoryText(request),
            image: request.images || null,
            kind: 'tool-output',
            toolName: request.toolName || '',
            toolStatus: request.status || getToolOutputStatus(request),
            toolCallText,
            toolDurationMs: request.durationMs,
            toolStep: request.step,
            toolCallIndex: request.callIndex,
            toolCallCount: request.callCount,
            toolCallId: request.toolCallId || null,
            toolOutput: request.text || '',
            toolStatusKey: request.statusKey || null,
        });
        session.timestamp = Date.now();
        handler.app.sessionFlow.refreshHistoryUI();
    }

    const toolOptions = {
        text: request.text || '',
        attachment: request.images || null,
        kind: 'tool-output',
        toolName: request.toolName || '',
        toolStatus: request.status || getToolOutputStatus(request),
        toolCallText,
        toolDurationMs: request.durationMs,
        step: request.step,
        callIndex: request.callIndex,
        callCount: request.callCount,
        toolOutputKey: renderedKey,
        autoScroll,
    };
    const turnView = handler.ui.getTurnView?.();
    appendToolBlockToHistory(turnView, handler.ui.historyDiv, toolOptions);
    handler.ui.followStreamingContent?.();
}

function shouldAutoScroll(handler) {
    const state = handler.ui?.getChatScrollState?.();
    return !state || state.isNearBottom !== false;
}

export function handleToolCallStatusMessage(handler, request) {
    if (!handler.isGeneratingSessionMessage(request)) return;
    handler.app?.prompt?.markGenerationActivity?.();
    if (!handler.isCurrentSessionMessage(request)) return;
    const autoScroll = shouldAutoScroll(handler);

    const sessionId = handler.getRequestSessionId(request);
    const toolCallText = handler.getRequestToolCallText(request, sessionId);
    handler.finalizeActiveStream({
        text: handler.getStreamRawText(sessionId) || request.toolCallText,
        thoughts: handler.getStreamThoughts(sessionId),
        clearToolCallJson: true,
    });
    handler.clearStreamState(sessionId);

    const statusKey = request.statusKey || getToolStatusKey(request);
    const existing = findRenderedToolStatus(handler.ui?.historyDiv, statusKey);
    if (existing && typeof existing.update === 'function') {
        existing.update(request.text || '', null, {
            toolStatus: request.status || 'completed',
            toolCallText,
            toolDurationMs: request.durationMs,
            callIndex: request.callIndex,
            callCount: request.callCount,
            isCollapsed: true,
        });
        handler.ui.followStreamingContent?.();
        return;
    }

    const statusOptions = {
        text: request.text || '',
        kind: 'tool-status',
        toolName: request.toolName || '',
        toolStatus: request.status || 'running',
        toolCallText,
        toolDurationMs: request.durationMs,
        callIndex: request.callIndex,
        callCount: request.callCount,
        toolStatusKey: statusKey,
        isCollapsed: true,
        autoScroll,
    };
    const turnView = handler.ui.getTurnView?.();
    const controller = appendToolBlockToHistory(turnView, handler.ui.historyDiv, statusOptions);

    handler.ui.followStreamingContent?.();
    return controller;
}
