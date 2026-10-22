import { debugLog } from '../../shared/logging/debug.js';
import { stripToolCallMarkup } from '../../shared/text/tool_call_text.js';
import { assertCurrentAttachmentsSupported } from './shared/attachments.js';
import { normalizeBaseUrl } from './shared/urls.js';
import {
    PROTECTED_CHAT_KEYS,
    buildChatMessages,
    isAutoThinkingLevel,
    mergeUserHeaders,
    mergeUserPayload,
    parseToolArguments,
    shouldReplayReasoningContent,
} from './openai_payloads.js';
import { sendOpenAIResponsesMessage } from './openai_responses.js';
import {
    extractContentText,
    extractSourcesFromAnnotation,
    assertResponseOk,
} from './openai_response_extractors.js';
import { readSseJson } from './sse.js';
import { assertNonEmptyResponse, throwIfTruncated } from './shared/finish_reason.js';
import { fetchWithHeadersTimeout } from './shared/fetch_timeout.js';

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
        messages: buildChatMessages(prompt, systemInstruction, history, files, {
            replayReasoningContent: shouldReplayReasoningContent({ baseUrl, model }),
        }),
        stream: true,
    };

    if (config.reasoningEffort && !isAutoThinkingLevel(config.reasoningEffort)) {
        payload.reasoning_effort = config.reasoningEffort;
    }

    const chatTools = Array.isArray(config.toolSchemas)
        ? config.toolSchemas.map((schema) => ({ type: 'function', function: schema }))
        : Array.isArray(config.tools)
          ? config.tools
          : [];
    if (chatTools.length > 0) {
        payload.tools = chatTools;
        payload.tool_choice = config.toolChoice || 'auto';
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

    const response = await fetchWithHeadersTimeout(url, {
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
    let streamError = null;
    const toolCallsByIndex = new Map();

    const appendToolCallDeltas = (calls) => {
        if (!Array.isArray(calls)) return;
        for (const call of calls) {
            if (!call || typeof call !== 'object') continue;
            const key = Number.isInteger(call.index)
                ? call.index
                : typeof call.id === 'string' && call.id
                  ? call.id
                  : 0;
            const current = toolCallsByIndex.get(key) || {
                id: null,
                name: '',
                arguments: '',
            };
            if (typeof call.id === 'string' && call.id) current.id = call.id;
            if (typeof call.function?.name === 'string' && call.function.name) {
                const incomingName = call.function.name;
                if (!current.name || incomingName.startsWith(current.name)) {
                    current.name = incomingName;
                } else {
                    current.name += incomingName;
                }
            }
            if (typeof call.function?.arguments === 'string') {
                current.arguments += call.function.arguments;
            }
            toolCallsByIndex.set(key, current);
        }
    };

    await readSseJson(
        response,
        (streamEvent) => {
            // Gateways report upstream failures inside the stream while the HTTP
            // response itself is already a 200.
            if (streamEvent.error?.message) {
                streamError = streamEvent.error.message;
                return;
            }

            if (streamEvent.choices && streamEvent.choices.length > 0) {
                const choice = streamEvent.choices[0];
                finishReason = finishReason || choice.finish_reason || null;
                const delta = choice.delta || {};
                appendToolCallDeltas(delta.tool_calls);
                appendToolCallDeltas(choice.message?.tool_calls);

                // Standard Content
                const deltaText = extractContentText(delta);
                if (deltaText) {
                    fullText += deltaText;
                    onUpdate(fullText, fullThoughts);
                }

                const reasoningText = extractReasoningText(delta);
                if (reasoningText) {
                    fullThoughts += reasoningText;
                    onUpdate(fullText, fullThoughts);
                }

                // Servers that ignore `stream: true` send the whole answer on
                // `choice.message` instead of deltas.
                const completedText = extractContentText(choice.message);
                if (completedText && !fullText) {
                    fullText = completedText;
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

    if (streamError) {
        throw new Error(streamError);
    }

    const functionCalls = Array.from(toolCallsByIndex.values())
        .filter((call) => call.name.trim())
        .map((call, index) => ({
            id: call.id || `call_${index + 1}`,
            name: call.name.trim(),
            args: parseToolArguments(call.arguments),
        }));

    throwIfTruncated(finishReason);
    if (functionCalls.length === 0) {
        assertNonEmptyResponse(fullText, fullThoughts);
    }

    return {
        text: stripToolCallMarkup(fullText),
        thoughts: fullThoughts || null,
        sources,
        images: [],
        context: null,
        functionCalls,
    };
}
