import { getDataUrlMime, normalizeUserAttachments } from '../../shared/attachments/index.js';
import { debugLog } from '../../shared/logging/debug.js';
import { toAnthropicTools } from '../../shared/tools/tool_definitions.js';
import { assertResponseOk } from './openai_response_extractors.js';
import { readSseJson } from './sse.js';
import { throwIfTruncated } from './shared/finish_reason.js';
import {
    getMessageAttachments,
    assertCurrentAttachmentsSupported,
    textWithUnsupportedFileNotice,
} from './shared/attachments.js';
import {
    TOOL_RESULT_UNAVAILABLE,
    createPendingToolCalls,
    flushPendingToolCalls,
    getToolOutputContent,
    isToolCallTurnMessage,
    isToolOutputHistoryMessage,
    resolveToolOutputPairing,
} from './shared/tool_call_history.js';
import { normalizeBaseUrl, getDataUrlPayload } from './shared/urls.js';
import { fetchWithHeadersTimeout } from './shared/fetch_timeout.js';

const DEFAULT_MAX_TOKENS = 8192;
// Budget used by Claude models without adaptive thinking. xhigh/max exist only
// for adaptive models; legacy models cap at the high budget so thinking still
// leaves room for the answer inside max_tokens.
const THINKING_BUDGET_BY_LEVEL = Object.freeze({
    low: 1024,
    medium: 2048,
    high: 4096,
    xhigh: 4096,
    max: 4096,
});
const ADAPTIVE_THINKING_MODEL_PATTERNS = Object.freeze([
    /^claude-jupiter(?:-|$)/i,
    /^claude-mythos(?:-|$)/i,
    /^claude-opus-4-(?:[7-9]|\d{2,})(?:-|$)/i,
    /^claude-(?:[a-z0-9]+-)*5(?:-|\.|$)/i,
]);

function buildUserContent(text, attachments) {
    const normalized = normalizeUserAttachments(attachments);
    const content = [];

    normalized
        .filter((attachment) => attachment.type.startsWith('image/'))
        .forEach((attachment) => {
            content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: attachment.type || getDataUrlMime(attachment.base64) || 'image/png',
                    data: getDataUrlPayload(attachment.base64),
                },
            });
        });

    const textContent = textWithUnsupportedFileNotice(text, normalized);
    if (textContent) {
        content.push({ type: 'text', text: textContent });
    }

    return content.length > 0 ? content : [{ type: 'text', text: '' }];
}

/**
 * Rebuilds the raw assistant content saved from an Anthropic stream. Thinking
 * blocks without a signature (and redacted blocks without data) cannot be sent
 * back: the API rejects them, so they are dropped instead of replayed.
 * @param {unknown} historyMessage
 * @returns {Array<object>|null}
 */
function getReplayableAnthropicContent(historyMessage) {
    if (!historyMessage || historyMessage.role !== 'ai') return null;
    const rawContent = historyMessage.anthropicContent;
    if (!Array.isArray(rawContent) || rawContent.length === 0) return null;

    const content = rawContent.filter((block) => {
        if (!block || typeof block !== 'object') return false;
        if (block.type === 'thinking') {
            return typeof block.signature === 'string' && block.signature.length > 0;
        }
        if (block.type === 'redacted_thinking') {
            return typeof block.data === 'string' && block.data.length > 0;
        }
        return true;
    });
    if (content.length === 0) return null;

    return JSON.parse(JSON.stringify(content));
}

function buildMessages(prompt, history, files) {
    const messages = [];

    // The Messages API needs non-empty, alternating turns. Editing or deleting
    // history can leave two same-role rows in a row (and rows with nothing to
    // say), so normalise here instead of sending a payload the API rejects.
    const pushTurn = (role, content) => {
        if (content.length === 0) return;
        const previous = messages[messages.length - 1];
        if (previous && previous.role === role) {
            previous.content = [...previous.content, ...content];
            return;
        }
        messages.push({ role, content });
    };

    // Thinking blocks keep their generated content and signature, so they are
    // replayed as their own turn instead of being merged with a neighbouring
    // assistant turn (merging would rewrite the stored message). Consecutive
    // assistant turns are accepted by the Messages API, which combines them
    // server-side.
    const pushRawAssistantTurn = (content) => {
        messages.push({ role: 'assistant', content });
    };

    if (Array.isArray(history)) {
        // id → tool name, in call order. Pairing falls back to insertion order
        // when a stored result row lost or changed its id.
        let pendingToolUses = new Map();

        const flushPendingToolUses = (nextMessage) => {
            const missingCalls = flushPendingToolCalls(pendingToolUses, nextMessage);
            if (missingCalls.length === 0) return;
            pushTurn(
                'user',
                missingCalls.map((call) => ({
                    type: 'tool_result',
                    tool_use_id: call.toolCallId,
                    content: TOOL_RESULT_UNAVAILABLE,
                }))
            );
        };

        history.forEach((historyMessage, index) => {
            const nextMessage = history[index + 1];

            const replayContent = getReplayableAnthropicContent(historyMessage);
            if (replayContent) {
                flushPendingToolUses(historyMessage);
                pendingToolUses = createPendingToolCalls(
                    replayContent
                        .filter((block) => block.type === 'tool_use')
                        .map((block) => ({ id: block.id, name: block.name }))
                );
                pushRawAssistantTurn(replayContent);
                return;
            }

            if (isToolCallTurnMessage(historyMessage)) {
                const content = [];
                const text =
                    typeof historyMessage.text === 'string' ? historyMessage.text.trim() : '';
                if (text) content.push({ type: 'text', text });
                pendingToolUses = createPendingToolCalls(historyMessage.toolCalls);
                historyMessage.toolCalls.forEach((call) => {
                    content.push({
                        type: 'tool_use',
                        id: call.id,
                        name: call.name,
                        input: call.args || {},
                    });
                });
                pushTurn('assistant', content);
                return;
            }

            if (isToolOutputHistoryMessage(historyMessage)) {
                const paired = resolveToolOutputPairing(
                    pendingToolUses,
                    historyMessage,
                    nextMessage
                );
                if (!paired) return;
                pushTurn('user', [
                    {
                        type: 'tool_result',
                        tool_use_id: paired.toolCallId,
                        content: getToolOutputContent(historyMessage),
                    },
                ]);
                return;
            }

            flushPendingToolUses(historyMessage);

            const role = historyMessage.role === 'ai' ? 'assistant' : 'user';
            if (role === 'user') {
                pushTurn(
                    role,
                    buildUserContent(historyMessage.text, getMessageAttachments(historyMessage))
                );
                return;
            }

            const text = typeof historyMessage.text === 'string' ? historyMessage.text.trim() : '';
            if (!text) return;
            pushTurn(role, [{ type: 'text', text }]);
        });

        flushPendingToolUses(null);
    }

    if (prompt || (Array.isArray(files) && files.length > 0)) {
        pushTurn('user', buildUserContent(prompt, files));
    }

    return messages;
}

function shouldUseAdaptiveThinking(model) {
    const modelId = String(model || '').trim();
    return ADAPTIVE_THINKING_MODEL_PATTERNS.some((pattern) => pattern.test(modelId));
}

function getThinkingConfig(thinkingLevel, model) {
    const budgetTokens = THINKING_BUDGET_BY_LEVEL[thinkingLevel];
    if (!budgetTokens) return null;
    if (shouldUseAdaptiveThinking(model)) {
        return {
            thinking: { type: 'adaptive' },
            outputConfig: { effort: thinkingLevel },
        };
    }
    return {
        thinking: {
            type: 'enabled',
            budget_tokens: budgetTokens,
        },
    };
}

function parseAnthropicToolInput(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function getStreamBlockIndex(streamEvent, state) {
    return Number.isInteger(streamEvent.index) ? streamEvent.index : state.lastBlockIndex;
}

function applyAnthropicStreamEvent(streamEvent, state, onUpdate) {
    if (streamEvent.type === 'content_block_start') {
        const block = streamEvent.content_block || {};
        const index = Number.isInteger(streamEvent.index) ? streamEvent.index : state.blocks.size;
        state.lastBlockIndex = index;

        if (block.type === 'thinking') {
            const thinking = typeof block.thinking === 'string' ? block.thinking : '';
            state.blocks.set(index, {
                type: 'thinking',
                thinking,
                signature: typeof block.signature === 'string' ? block.signature : '',
            });
            if (thinking) {
                state.thoughts += thinking;
                onUpdate(state.text, state.thoughts);
            }
            return;
        }

        if (block.type === 'redacted_thinking') {
            state.blocks.set(index, {
                type: 'redacted_thinking',
                data: typeof block.data === 'string' ? block.data : '',
            });
            state.thoughts += state.thoughts ? '\n[redacted thinking]' : '[redacted thinking]';
            onUpdate(state.text, state.thoughts);
            return;
        }

        if (block.type === 'text') {
            const text = typeof block.text === 'string' ? block.text : '';
            state.blocks.set(index, { type: 'text', text });
            if (text) {
                state.text += text;
                onUpdate(state.text, state.thoughts);
            }
            return;
        }

        if (block.type === 'tool_use') {
            state.blocks.set(index, {
                type: 'tool_use',
                id: typeof block.id === 'string' ? block.id : null,
                name: typeof block.name === 'string' ? block.name : '',
                input: {},
                inputJson: '',
            });
        }
        return;
    }

    if (streamEvent.type === 'content_block_stop') {
        const block = state.blocks.get(getStreamBlockIndex(streamEvent, state));
        if (block && block.type === 'tool_use') {
            block.input = parseAnthropicToolInput(block.inputJson);
        }
        return;
    }

    if (streamEvent.type === 'content_block_delta') {
        const delta = streamEvent.delta || {};
        const block = state.blocks.get(getStreamBlockIndex(streamEvent, state));
        if (delta.type === 'input_json_delta') {
            if (block && block.type === 'tool_use') block.inputJson += delta.partial_json || '';
            return;
        }
        if (delta.type === 'signature_delta' && delta.signature) {
            if (block && block.type === 'thinking') block.signature += delta.signature;
            return;
        }
        if (delta.type === 'text_delta' && delta.text) {
            if (block && block.type === 'text') block.text += delta.text;
            state.text += delta.text;
            onUpdate(state.text, state.thoughts);
            return;
        }
        if (delta.type === 'thinking_delta' && delta.thinking) {
            if (block && block.type === 'thinking') block.thinking += delta.thinking;
            state.thoughts += delta.thinking;
            onUpdate(state.text, state.thoughts);
        }
        return;
    }

    if (streamEvent.type === 'error' && streamEvent.error?.message) {
        state.error = streamEvent.error.message;
    }

    if (streamEvent.type === 'message_delta' && streamEvent.delta?.stop_reason) {
        state.stopReason = state.stopReason || streamEvent.delta.stop_reason;
    }
}

/**
 * Orders streamed content blocks by their stream index and resolves tool_use
 * inputs accumulated from input_json_delta events.
 * @param {Map<number, object>} blocks
 * @returns {Array<object>}
 */
function finalizeAnthropicBlocks(blocks) {
    return Array.from(blocks.entries())
        .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
        .map(([, block]) => {
            if (block.type !== 'tool_use') return block;
            return {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.inputJson
                    ? parseAnthropicToolInput(block.inputJson)
                    : block.input || {},
            };
        });
}

/**
 * Raw assistant content that must be replayed verbatim on the next turn.
 * Thinking blocks keep the signature from the stream; blocks that cannot be
 * replayed (no signature / no data) are dropped. Returns null when the turn has
 * no thinking blocks, so plain replies keep the reconstruction path.
 * @param {Array<object>} blocks
 * @returns {Array<object>|null}
 */
function buildAnthropicContent(blocks) {
    const content = [];

    blocks.forEach((block) => {
        if (block.type === 'thinking') {
            if (typeof block.signature !== 'string' || !block.signature) return;
            content.push({
                type: 'thinking',
                thinking: block.thinking || '',
                signature: block.signature,
            });
            return;
        }
        if (block.type === 'redacted_thinking') {
            if (typeof block.data !== 'string' || !block.data) return;
            content.push({ type: 'redacted_thinking', data: block.data });
            return;
        }
        if (block.type === 'tool_use') {
            content.push({
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input || {},
            });
            return;
        }
        if (block.type === 'text' && block.text) {
            content.push({ type: 'text', text: block.text });
        }
    });

    const hasThinking = content.some(
        (block) => block.type === 'thinking' || block.type === 'redacted_thinking'
    );
    return hasThinking ? content : null;
}

export async function sendAnthropicMessage(
    prompt,
    systemInstruction,
    history,
    config,
    files,
    signal,
    onUpdate
) {
    const baseUrl = normalizeBaseUrl(config?.baseUrl);
    const apiKey = config?.apiKey || '';
    const model = config?.model || '';

    if (!baseUrl) throw new Error('Base URL is missing.');
    if (!apiKey) throw new Error('API Key is missing.');
    if (!model) throw new Error('Model ID is missing.');

    assertCurrentAttachmentsSupported(files);

    const payload = {
        model,
        messages: buildMessages(prompt, history, files),
        max_tokens: config?.maxTokens || DEFAULT_MAX_TOKENS,
        stream: true,
    };

    const toolSchemas = Array.isArray(config?.toolSchemas) ? config.toolSchemas : [];
    if (toolSchemas.length > 0) {
        payload.tools = toAnthropicTools(toolSchemas);
    }

    if (systemInstruction) {
        payload.system = systemInstruction;
    }

    const thinkingConfig = getThinkingConfig(config?.thinkingLevel, model);
    if (thinkingConfig) {
        payload.thinking = thinkingConfig.thinking;
        if (thinkingConfig.outputConfig) {
            payload.output_config = thinkingConfig.outputConfig;
        }
    }

    const url = `${baseUrl}/messages`;
    debugLog(`[Anthropic API] Requesting ${model} at ${url}...`);

    const response = await fetchWithHeadersTimeout(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': config?.anthropicVersion || '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal,
    });

    await assertResponseOk(response);

    const state = {
        text: '',
        thoughts: '',
        error: null,
        stopReason: null,
        blocks: new Map(),
        lastBlockIndex: null,
    };

    await readSseJson(
        response,
        (streamEvent) => {
            applyAnthropicStreamEvent(streamEvent, state, onUpdate);
        },
        signal
    );

    if (state.error) {
        throw new Error(state.error);
    }

    throwIfTruncated(state.stopReason);

    const blocks = finalizeAnthropicBlocks(state.blocks);
    const functionCalls = blocks
        .filter((block) => block.type === 'tool_use' && block.name)
        .map((block, index) => ({
            id: block.id || `call_${index + 1}`,
            name: block.name,
            args: block.input || {},
        }));

    return {
        text: state.text,
        thoughts: state.thoughts || null,
        sources: [],
        images: [],
        context: null,
        functionCalls,
        // Raw thinking/tool blocks kept for verbatim replay on the next turn.
        anthropicContent: buildAnthropicContent(blocks),
    };
}
