import { getDataUrlMime, normalizeUserAttachments } from '../../shared/attachments/index.js';
import { debugLog } from '../../shared/logging/debug.js';
import { assertResponseOk } from './openai_response_extractors.js';
import { readSseJson } from './sse.js';
import { throwIfTruncated } from './shared/finish_reason.js';
import {
    getMessageAttachments,
    assertCurrentAttachmentsSupported,
    textWithUnsupportedFileNotice,
} from './shared/attachments.js';
import { normalizeBaseUrl, getDataUrlPayload } from './shared/urls.js';
import { fetchWithHeadersTimeout } from './shared/fetch_timeout.js';

const DEFAULT_MAX_TOKENS = 8192;
const THINKING_BUDGET_BY_LEVEL = Object.freeze({
    low: 1024,
    medium: 2048,
    high: 4096,
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

function buildMessages(prompt, history, files) {
    const messages = [];

    // The Messages API needs non-empty, alternating turns. Editing or deleting
    // history can leave two same-role rows in a row (and rows with nothing to
    // say), so normalise here instead of sending a payload the API rejects.
    const pushTurn = (role, content) => {
        const previous = messages[messages.length - 1];
        if (previous && previous.role === role) {
            previous.content = [...previous.content, ...content];
            return;
        }
        messages.push({ role, content });
    };

    if (Array.isArray(history)) {
        history.forEach((historyMessage) => {
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
    }

    pushTurn('user', buildUserContent(prompt, files));

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

function applyAnthropicStreamEvent(streamEvent, state, onUpdate) {
    if (streamEvent.type === 'content_block_delta') {
        const delta = streamEvent.delta || {};
        if (delta.type === 'text_delta' && delta.text) {
            state.text += delta.text;
            onUpdate(state.text, state.thoughts);
            return;
        }
        if (delta.type === 'thinking_delta' && delta.thinking) {
            state.thoughts += delta.thinking;
            onUpdate(state.text, state.thoughts);
            return;
        }
        if (delta.type === 'redacted_thinking_delta') {
            state.thoughts += state.thoughts ? '\n[redacted thinking]' : '[redacted thinking]';
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

    return {
        text: state.text,
        thoughts: state.thoughts || null,
        sources: [],
        images: [],
        context: null,
    };
}
