import { debugLog } from '../../shared/logging/debug.js';
import { toOpenAIResponsesTools } from '../../shared/tools/tool_definitions.js';
import {
    PROTECTED_RESPONSES_KEYS,
    buildResponsesInput,
    hasImageAttachmentsInRequest,
    isAutoThinkingLevel,
    mergeUserHeaders,
    mergeUserPayload,
    parseToolArguments,
} from './openai_payloads.js';
import {
    assertResponseOk,
    extractReasoningSummaryFromCompletedResponse,
    extractReasoningSummaryFromResponseItem,
    extractSourcesFromAnnotation,
    extractSourcesFromResponseItem,
    extractTextFromCompletedResponse,
} from './openai_response_extractors.js';
import { readSseJson } from './sse.js';
import { assertNonEmptyResponse, throwIfTruncated } from './shared/finish_reason.js';
import { fetchWithHeadersTimeout } from './shared/fetch_timeout.js';

function isXAIBaseUrl(baseUrl) {
    try {
        const hostname = new URL(baseUrl).hostname.toLowerCase();
        return hostname === 'x.ai' || hostname.endsWith('.x.ai');
    } catch {
        return false;
    }
}

export async function sendOpenAIResponsesMessage(
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

    const responsesTools = Array.isArray(config.toolSchemas)
        ? toOpenAIResponsesTools(config.toolSchemas)
        : [];
    if (config.webSearch === true) {
        responsesTools.push({ type: 'web_search' });
        payload.include = ['web_search_call.action.sources'];
    }
    if (responsesTools.length > 0) {
        payload.tools = responsesTools;
    }

    if (systemInstruction) {
        payload.instructions = systemInstruction;
    }

    if (config.reasoningEffort && !isAutoThinkingLevel(config.reasoningEffort)) {
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

    const response = await fetchWithHeadersTimeout(url, {
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
    const functionCallItems = new Map();

    const collectFunctionCallItem = (item) => {
        if (!item || item.type !== 'function_call') return;
        const key = item.call_id || item.id;
        if (key) functionCallItems.set(key, item);
    };

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
                collectFunctionCallItem(streamEvent.item);
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
                streamEvent.response.output?.forEach((item) => {
                    collectFunctionCallItem(item);
                    extractSourcesFromResponseItem(item, sources, seenSourceUrls);
                });
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

    const functionCalls = Array.from(functionCallItems.values())
        .filter((item) => typeof item.name === 'string' && item.name.trim())
        .map((item, index) => ({
            id: item.call_id || item.id || `call_${index + 1}`,
            name: item.name.trim(),
            args: parseToolArguments(item.arguments),
        }));

    throwIfTruncated(incompleteReason);
    if (functionCalls.length === 0) {
        assertNonEmptyResponse(fullText, fullThoughts);
    }

    return {
        text: fullText,
        thoughts: fullThoughts || null,
        sources,
        images: [],
        context: null,
        functionCalls,
    };
}
