import { buildToolOutputText } from '../../shared/text/tool_call_text.js';

export function buildToolOutputHistoryText(request) {
    const toolName = request.toolName || 'tool';
    const step = Number.isFinite(request.step) ? request.step : '';
    const suffix = step ? `\n\n[Proceeding to step ${step}]` : '';
    return `${buildToolOutputText(toolName, request.text || '')}${suffix}`;
}

export function getToolOutputKey(request) {
    if (!request) return '';
    if (typeof request.statusKey === 'string' && request.statusKey.trim()) {
        return `status:${request.statusKey.trim()}:output`;
    }
    return [
        request.sessionId || '',
        request.toolName || '',
        Number.isFinite(request.step) ? request.step : '',
        Number.isFinite(request.callIndex) ? request.callIndex : '',
        request.text || '',
    ].join('|');
}

export function getToolStatusKey(request) {
    if (!request) return '';
    if (typeof request.statusKey === 'string' && request.statusKey.trim()) {
        return request.statusKey;
    }
    const parts = [request.sessionId || '', request.toolName || ''];
    if (
        Number.isFinite(request.callIndex) &&
        Number.isFinite(request.callCount) &&
        request.callCount > 1
    ) {
        parts.push(String(request.callIndex));
    }
    return parts.join('|');
}

export function hasPersistedToolOutput(session, request) {
    if (!session || !Array.isArray(session.messages)) return false;
    const expected = buildToolOutputHistoryText(request);
    return session.messages.some((message) => {
        return message && message.role === 'user' && message.text === expected;
    });
}

export function getToolOutputStatus(request) {
    const text = typeof request?.text === 'string' ? request.text.trim() : '';
    return /^(Error\b|Error executing\b|Timed out\b|Script Exception:)/i.test(text)
        ? 'failed'
        : 'completed';
}
