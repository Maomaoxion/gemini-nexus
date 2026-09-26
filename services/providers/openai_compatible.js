import { debugLog } from '../../shared/logging/debug.js';
import { assertCurrentAttachmentsSupported } from './shared/attachments.js';
import { normalizeBaseUrl } from './shared/urls.js';
import {
    buildChatMessages,
    buildResponsesInput,
    hasImageAttachmentsInRequest,
} from './openai_payloads.js';
import {
    extractReasoningSummaryFromCompletedResponse,
    extractReasoningSummaryFromResponseItem,
    extractSourcesFromAnnotation,
    extractSourcesFromResponseItem,
    extractTextFromCompletedResponse,
    readErrorMessage,
    assertResponseOk,
} from './openai_response_extractors.js';
import { readSseJson } from './sse.js';
import { throwIfTruncated } from './shared/finish_reason.js';

function isXAIBaseUrl(baseUrl) {
    try {
        const hostname = new URL(baseUrl).hostname.toLowerCase();
        return hostname === 'x.ai' || hostname.endsWith('.x.ai');
    } catch {
        return false;
    }
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Keys owned by the provider: user extras ride along but must never silently
// replace the request shape (e.g. { stream: false } would turn the SSE read
// into an empty "success").
const PROTECTED_CHAT_KEYS = new Set(['model', 'messages', 'stream']);
const PROTECTED_RESPONSES_KEYS = new Set(['model', 'input', 'stream']);
const PROTECTED_HEADER_NAMES = new Set(['authorization', 'content-type']);

function mergeUserPayload(target, source, protectedKeys) {
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

function mergeUserHeaders(target, source) {
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

function extractReasoningText(container = {}) {
    if (typeof container.reasoning_content === 'string') return container.reasoning_content;
    if (typeof container.reasoning === 'string') return container.reasoning;
    if (!Array.isArray(container.reasoning_details)) return '';

    return container.reasoning_details
        .map((detail) => detail?.text || detail?.summary || '')
        .filter(Boolean)
        .join('');
}

/**
 * Sends a message using an OpenAI Compatible API.
 */
export async function sendOpenAIMessage(
    prompt,
    systemInstruction,
    history,
    config,
    files,
    signal,
    onUpdate
) {
    let { baseUrl, apiKey, model } = config;

    if (!baseUrl) throw new Error('Base URL is missing.');
    if (!model) throw new Error('Model ID is missing.');

    baseUrl = normalizeBaseUrl(baseUrl);
    const useResponsesApi = config?.useResponsesApi === true;
    const webSearch = config?.webSearch === true;
    assertCurrentAttachmentsSupported(files);
    if (useResponsesApi) {
        return sendOpenAIResponsesMessage(
            prompt,
            systemInstruction,
            history,
            { ...config, baseUrl, apiKey, model },
            files,
            signal,
            onUpdate
        );
    }

    const url = `${baseUrl}/chat/completions`;

    const payload = {
        model: model,
        messages: buildChatMessages(prompt, systemInstruction, history, files),
        stream: true,
    };

    if (config.reasoningEffort) {
        payload.reasoning_effort = config.reasoningEffort;
    }

    if (webSearch) {
        payload.web_search_options = {};
    }
    mergeUserPayload(payload, config.chatPayload, PROTECTED_CHAT_KEYS);

    const headers = {
        'Content-Type': 'application/json',
    };

    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    mergeUserHeaders(headers, config.headers);

    const webSearchLabel = webSearch ? ' with Chat web search' : '';
    debugLog(`[OpenAI Compatible] Requesting ${model} at ${url}${webSearchLabel}...`);

    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        signal,
    });

    await assertResponseOk(response);

    const sources = [];
    const seenSourceUrls = new Set();
    let fullText = '';
    // Reasoning arrives on provider-specific fields (reasoning_content / reasoning /
    // reasoning_details), not the OpenAI `content` field.
    let fullThoughts = '';
    let finishReason = null;

    await readSseJson(
        response,
        (streamEvent) => {
            if (streamEvent.choices && streamEvent.choices.length > 0) {
                const choice = streamEvent.choices[0];
                finishReason = finishReason || choice.finish_reason || null;
                const delta = choice.delta || {};

                // Standard Content
                if (delta.content) {
                    fullText += delta.content;
                    onUpdate(fullText, fullThoughts);
                }

                const reasoningText = extractReasoningText(delta);
                if (reasoningText) {
                    fullThoughts += reasoningText;
                    onUpdate(fullText, fullThoughts);
                }

                const completedReasoningText = extractReasoningText(choice.message);
                if (completedReasoningText && !fullThoughts) {
                    fullThoughts = completedReasoningText;
                    onUpdate(fullText, fullThoughts);
                }

                if (Array.isArray(delta.annotations)) {
                    delta.annotations.forEach((annotation) =>
                        extractSourcesFromAnnotation(annotation, sources, seenSourceUrls)
                    );
                }

                if (Array.isArray(choice.message?.annotations)) {
                    choice.message.annotations.forEach((annotation) =>
                        extractSourcesFromAnnotation(annotation, sources, seenSourceUrls)
                    );
                }
            }
        },
        signal
    );

    throwIfTruncated(finishReason);

    return {
        text: fullText,
        thoughts: fullThoughts || null,
        sources,
        images: [],
        context: null,
    };
}

async function sendOpenAIResponsesMessage(
    prompt,
    systemInstruction,
    history,
    config,
    files,
    signal,
    onUpdate
) {
    const { baseUrl, apiKey, model } = config;
    const url = `${baseUrl}/responses`;
    const hasImages = hasImageAttachmentsInRequest(history, files);
    const payload = {
        model,
        input: buildResponsesInput(prompt, history, files),
        stream: true,
    };

    if (hasImages && isXAIBaseUrl(baseUrl)) {
        payload.store = false;
    }

    if (config.webSearch === true) {
        payload.tools = [{ type: 'web_search' }];
        payload.include = ['web_search_call.action.sources'];
    }

    if (systemInstruction) {
        payload.instructions = systemInstruction;
    }

    if (config.reasoningEffort) {
        payload.reasoning = {
            effort: config.reasoningEffort,
            summary: 'detailed',
        };
    }
    mergeUserPayload(payload, config.responsesPayload, PROTECTED_RESPONSES_KEYS);

    const headers = {
        'Content-Type': 'application/json',
    };

    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    mergeUserHeaders(headers, config.headers);

    const webSearchLabel = config.webSearch === true ? ' with web search' : '';
    debugLog(`[OpenAI Responses] Requesting ${model} at ${url}${webSearchLabel}...`);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
    });

    await assertResponseOk(response);

    const sources = [];
    const seenSourceUrls = new Set();
    let fullText = '';
    let fullThoughts = '';
    let streamError = null;
    let incompleteReason = null;

    await readSseJson(
        response,
        (streamEvent) => {
            if (streamEvent.error?.message) {
                streamError = streamEvent.error.message;
                return;
            }

            if (streamEvent.type === 'response.output_text.delta' && streamEvent.delta) {
                fullText += streamEvent.delta;
                onUpdate(fullText, fullThoughts);
                return;
            }

            if (
                (streamEvent.type === 'response.reasoning_summary_text.delta' ||
                    streamEvent.type === 'response.reasoning_text.delta') &&
                streamEvent.delta
            ) {
                fullThoughts += streamEvent.delta;
                onUpdate(fullText, fullThoughts);
                return;
            }

            if (
                (streamEvent.type === 'response.reasoning_summary_text.done' ||
                    streamEvent.type === 'response.reasoning_text.done') &&
                streamEvent.text &&
                !fullThoughts
            ) {
                fullThoughts = streamEvent.text;
                onUpdate(fullText, fullThoughts);
                return;
            }

            if (streamEvent.type === 'response.output_text.annotation.added') {
                extractSourcesFromAnnotation(streamEvent.annotation, sources, seenSourceUrls);
                return;
            }

            if (streamEvent.type === 'response.output_item.done') {
                extractSourcesFromResponseItem(streamEvent.item, sources, seenSourceUrls);
                if (!fullThoughts) {
                    const completedThoughts = extractReasoningSummaryFromResponseItem(
                        streamEvent.item
                    );
                    if (completedThoughts) {
                        fullThoughts = completedThoughts;
                        onUpdate(fullText, fullThoughts);
                    }
                }
                return;
            }

            if (streamEvent.type === 'response.completed' && streamEvent.response) {
                streamEvent.response.output?.forEach((item) =>
                    extractSourcesFromResponseItem(item, sources, seenSourceUrls)
                );
                if (streamEvent.response.status === 'incomplete') {
                    incompleteReason =
                        streamEvent.response.incomplete_details?.reason || 'incomplete';
                }
                if (!fullThoughts) {
                    fullThoughts = extractReasoningSummaryFromCompletedResponse(
                        streamEvent.response
                    );
                }
                if (!fullText) {
                    fullText = extractTextFromCompletedResponse(streamEvent.response);
                }
                onUpdate(fullText, fullThoughts);
            }
        },
        signal
    );

    if (streamError) {
        throw new Error(streamError);
    }

    throwIfTruncated(incompleteReason);

    return {
        text: fullText,
        thoughts: fullThoughts || null,
        sources,
        images: [],
        context: null,
    };
}
