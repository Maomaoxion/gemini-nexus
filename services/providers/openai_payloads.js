import { debugLog } from '../../shared/logging/debug.js';
import {
    getImageAttachmentDataUrls,
    normalizeUserAttachments,
} from '../../shared/attachments/index.js';
import { getMessageAttachments, textWithUnsupportedFileNotice } from './shared/attachments.js';
import {
    TOOL_RESULT_UNAVAILABLE,
    createPendingToolCalls,
    flushPendingToolCalls,
    getToolOutputContent,
    isToolCallTurnMessage,
    isToolOutputHistoryMessage,
    resolveToolOutputPairing,
} from './shared/tool_call_history.js';

export { normalizeBaseUrl } from './shared/urls.js';

// Keys owned by the provider: user extras ride along but must never silently
// replace the request shape (e.g. { stream: false } would turn the SSE read
// into an empty "success").
export const PROTECTED_CHAT_KEYS = new Set(['model', 'messages', 'stream', 'tools', 'tool_choice']);
export const PROTECTED_RESPONSES_KEYS = new Set(['model', 'input', 'stream', 'tools']);
const PROTECTED_HEADER_NAMES = new Set(['authorization', 'content-type']);

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// "auto" means omit the effort field so the provider applies its default.
export function isAutoThinkingLevel(level) {
    return (
        String(level || '')
            .trim()
            .toLowerCase() === 'auto'
    );
}

export function mergeUserPayload(target, source, protectedKeys) {
    if (!isPlainObject(source)) return target;
    for (const [key, value] of Object.entries(source)) {
        if (protectedKeys.has(key)) {
            debugLog(`[OpenAI Compatible] Ignoring protected payload key: ${key}`);
            continue;
        }
        target[key] = value;
    }
    return target;
}

export function mergeUserHeaders(target, source) {
    if (!isPlainObject(source)) return target;
    for (const [name, value] of Object.entries(source)) {
        if (PROTECTED_HEADER_NAMES.has(String(name).trim().toLowerCase())) {
            debugLog(`[OpenAI Compatible] Ignoring protected header: ${name}`);
            continue;
        }
        target[name] = value;
    }
    return target;
}

export function parseToolArguments(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return isPlainObject(parsed) ? parsed : {};
    } catch {
        debugLog('[OpenAI Compatible] Failed to parse tool arguments:', raw);
        return {};
    }
}

function buildOpenAIContent(text, images) {
    if (!images || images.length === 0) {
        return text || '';
    }

    const content = [];
    images.forEach((imageUrl) => {
        content.push({
            type: 'image_url',
            image_url: {
                url: imageUrl,
                detail: 'high',
            },
        });
    });

    if (text) {
        content.push({ type: 'text', text });
    }

    return content;
}

function buildOpenAIUserContent(text, attachments) {
    const normalizedAttachments = normalizeUserAttachments(attachments);
    return buildOpenAIContent(
        textWithUnsupportedFileNotice(text, normalizedAttachments),
        getImageAttachmentDataUrls(normalizedAttachments)
    );
}

// DeepSeek thinking mode requires the assistant's reasoning_content to be sent
// back alongside tool_calls; omitting it fails the next request with HTTP 400.
// OpenRouter carries reasoning on a different field, so its endpoints are
// excluded even when the model id contains "deepseek".
export function shouldReplayReasoningContent({ baseUrl, model } = {}) {
    const base = String(baseUrl || '').toLowerCase();
    if (base.includes('openrouter.ai')) return false;
    return base.includes('deepseek') || /(^|\/)deepseek[-/]/i.test(String(model || ''));
}

function buildResponsesContent(text, images) {
    if (!images || images.length === 0) {
        return text || '';
    }

    const content = [];
    images.forEach((imageUrl) => {
        content.push({
            type: 'input_image',
            image_url: imageUrl,
            detail: 'high',
        });
    });

    if (text) {
        content.push({ type: 'input_text', text });
    }

    return content;
}

function buildResponsesUserContent(text, attachments) {
    const normalizedAttachments = normalizeUserAttachments(attachments);
    return buildResponsesContent(
        textWithUnsupportedFileNotice(text, normalizedAttachments),
        getImageAttachmentDataUrls(normalizedAttachments)
    );
}

export function buildChatMessages(
    prompt,
    systemInstruction,
    history,
    files,
    { replayReasoningContent = false } = {}
) {
    const messages = [];

    if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
    }

    if (Array.isArray(history)) {
        // id → tool name, in call order. Pairing falls back to insertion order
        // when a stored result row lost or changed its id.
        let pendingToolCalls = new Map();

        history.forEach((historyMessage, index) => {
            const nextMessage = history[index + 1];

            if (isToolCallTurnMessage(historyMessage)) {
                pendingToolCalls = createPendingToolCalls(historyMessage.toolCalls);
                const assistantMessage = {
                    role: 'assistant',
                    content: historyMessage.text || null,
                    tool_calls: historyMessage.toolCalls.map((call) => ({
                        id: call.id,
                        type: 'function',
                        function: {
                            name: call.name,
                            arguments: JSON.stringify(call.args || {}),
                        },
                    })),
                };
                // Thinking-mode providers reject the next request when this is
                // missing.
                if (replayReasoningContent && historyMessage.thoughts) {
                    assistantMessage.reasoning_content = historyMessage.thoughts;
                }
                messages.push(assistantMessage);
                return;
            }

            if (isToolOutputHistoryMessage(historyMessage)) {
                // History trimming/compression may cut the matching assistant
                // tool_calls row; an orphan tool message makes OpenAI reject
                // the whole request, so drop it.
                const paired = resolveToolOutputPairing(
                    pendingToolCalls,
                    historyMessage,
                    nextMessage
                );
                if (!paired) return;
                messages.push({
                    role: 'tool',
                    tool_call_id: paired.toolCallId,
                    content: getToolOutputContent(historyMessage),
                });
                return;
            }

            // A trimmed/compressed history can end a tool_calls row without
            // its tool rows; OpenAI rejects that pairing.
            for (const call of flushPendingToolCalls(pendingToolCalls, historyMessage)) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.toolCallId,
                    content: TOOL_RESULT_UNAVAILABLE,
                });
            }

            const attachments = getMessageAttachments(historyMessage);
            const genericMessage = {
                role: historyMessage.role === 'ai' ? 'assistant' : 'user',
                content:
                    historyMessage.role === 'user'
                        ? buildOpenAIUserContent(historyMessage.text, attachments)
                        : buildOpenAIContent(historyMessage.text, []),
            };
            if (
                genericMessage.role === 'assistant' &&
                replayReasoningContent &&
                historyMessage.thoughts
            ) {
                genericMessage.reasoning_content = historyMessage.thoughts;
            }
            messages.push(genericMessage);
        });

        for (const call of flushPendingToolCalls(pendingToolCalls)) {
            messages.push({
                role: 'tool',
                tool_call_id: call.toolCallId,
                content: TOOL_RESULT_UNAVAILABLE,
            });
        }
    }

    if (prompt || (Array.isArray(files) && files.length > 0)) {
        messages.push({
            role: 'user',
            content: buildOpenAIUserContent(prompt, files),
        });
    }

    return messages;
}

export function hasImageAttachmentsInRequest(history, files) {
    if (getImageAttachmentDataUrls(files).length > 0) return true;
    return (Array.isArray(history) ? history : []).some(
        (historyMessage) =>
            getImageAttachmentDataUrls(getMessageAttachments(historyMessage)).length > 0
    );
}

export function buildResponsesInput(prompt, history, files) {
    const input = [];
    let pendingToolCalls = new Map();

    if (Array.isArray(history)) {
        history.forEach((historyMessage, index) => {
            const nextMessage = history[index + 1];

            if (isToolCallTurnMessage(historyMessage)) {
                pendingToolCalls = createPendingToolCalls(historyMessage.toolCalls);
                historyMessage.toolCalls.forEach((call) => {
                    input.push({
                        type: 'function_call',
                        call_id: call.id,
                        name: call.name,
                        arguments: JSON.stringify(call.args || {}),
                    });
                });
                return;
            }

            if (isToolOutputHistoryMessage(historyMessage)) {
                // Same fallback as the Chat path: an orphan result row is
                // dropped, a row whose id was lost is paired by call order.
                const paired = resolveToolOutputPairing(
                    pendingToolCalls,
                    historyMessage,
                    nextMessage
                );
                if (!paired) return;
                input.push({
                    type: 'function_call_output',
                    call_id: paired.toolCallId,
                    output: getToolOutputContent(historyMessage),
                });
                return;
            }

            for (const call of flushPendingToolCalls(pendingToolCalls, historyMessage)) {
                input.push({
                    type: 'function_call_output',
                    call_id: call.toolCallId,
                    output: TOOL_RESULT_UNAVAILABLE,
                });
            }

            const attachments = getMessageAttachments(historyMessage);
            input.push({
                role: historyMessage.role === 'ai' ? 'assistant' : 'user',
                content:
                    historyMessage.role === 'user'
                        ? buildResponsesUserContent(historyMessage.text, attachments)
                        : buildResponsesContent(historyMessage.text, []),
            });
        });

        for (const call of flushPendingToolCalls(pendingToolCalls)) {
            input.push({
                type: 'function_call_output',
                call_id: call.toolCallId,
                output: TOOL_RESULT_UNAVAILABLE,
            });
        }
    }

    if (prompt || (Array.isArray(files) && files.length > 0)) {
        input.push({
            role: 'user',
            content: buildResponsesUserContent(prompt, files),
        });
    }

    return input;
}
