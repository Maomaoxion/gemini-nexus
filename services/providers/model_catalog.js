import {
    getDedicatedApiHeaders,
    getDedicatedApiProviderConfig,
} from '../../shared/settings/dedicated_providers.js';
import { normalizeBaseUrl } from './openai_payloads.js';
import { readContextWindow } from './shared/context_window_field.js';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithHeadersTimeout } from './shared/fetch_timeout.js';

const GEMINI_MODEL_LIST_PAGE_LIMIT = 5;

function getDefaultBaseUrl(provider, providerConfig) {
    if (provider === 'official') {
        return 'https://generativelanguage.googleapis.com/v1beta';
    }
    return providerConfig?.defaultBaseUrl || '';
}

function getModelsUrl(provider, providerConfig, baseUrl) {
    if (!baseUrl && providerConfig?.modelListUrl) return providerConfig.modelListUrl;
    const normalized = normalizeBaseUrl(baseUrl || getDefaultBaseUrl(provider, providerConfig));
    return normalized ? `${normalized}/models` : '';
}

function getRequestHeaders(provider, providerConfig, apiKey) {
    const headers = {
        Accept: 'application/json',
        ...getDedicatedApiHeaders(provider),
    };

    if (provider === 'official') {
        if (apiKey) headers['x-goog-api-key'] = apiKey;
        return headers;
    }

    if (providerConfig?.transport === 'anthropic-messages') {
        if (apiKey) headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        return headers;
    }

    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
}

function toEntry(id, item = null) {
    const modelId = String(id || '').trim();
    if (!modelId) return null;
    return {
        id: modelId,
        contextWindow: readContextWindow(item),
        fieldNames:
            item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item) : [],
    };
}

function extractOpenAiEntries(payload) {
    const items = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : Array.isArray(payload)
            ? payload
            : [];
    return items
        .map((item) =>
            toEntry(typeof item === 'string' ? item : item?.id || item?.model || item?.name, item)
        )
        .filter(Boolean);
}

function extractAnthropicEntries(payload) {
    return Array.isArray(payload?.data)
        ? payload.data.map((item) => toEntry(item?.id, item)).filter(Boolean)
        : [];
}

function extractGeminiEntries(payload) {
    return Array.isArray(payload?.models)
        ? payload.models
              .filter((model) =>
                  Array.isArray(model?.supportedGenerationMethods)
                      ? model.supportedGenerationMethods.includes('generateContent')
                      : true
              )
              .map((model) => toEntry(String(model?.name || '').replace(/^models\//, ''), model))
              .filter(Boolean)
        : [];
}

async function readErrorMessage(response) {
    try {
        const payload = await response.json();
        return payload?.error?.message || payload?.message || JSON.stringify(payload);
    } catch {
        try {
            return await response.text();
        } catch {
            return response.statusText || 'Unknown error';
        }
    }
}

async function fetchJson(url, headers, timeoutMs, signal) {
    const response = await fetchWithHeadersTimeout(
        url,
        { method: 'GET', headers, ...(signal ? { signal } : {}) },
        timeoutMs
    );
    if (!response.ok) {
        throw new Error(`API Error (${response.status}): ${await readErrorMessage(response)}`);
    }
    return response.json();
}

async function fetchGeminiEntries(url, headers, timeoutMs, signal) {
    const entries = [];
    let pageToken = '';

    for (let page = 0; page < GEMINI_MODEL_LIST_PAGE_LIMIT; page++) {
        const pageUrl = pageToken
            ? `${url}?pageSize=1000&pageToken=${encodeURIComponent(pageToken)}`
            : `${url}?pageSize=1000`;
        const payload = await fetchJson(pageUrl, headers, timeoutMs, signal);
        entries.push(...extractGeminiEntries(payload));
        pageToken = typeof payload?.nextPageToken === 'string' ? payload.nextPageToken : '';
        if (!pageToken) break;
    }

    return entries;
}

export async function fetchProviderModelEntries({
    provider,
    baseUrl = '',
    apiKey = '',
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    signal = null,
} = {}) {
    const providerId = String(provider || '').trim();
    if (providerId === 'web') {
        throw new Error('Gemini Web models are fixed and cannot be fetched.');
    }

    const providerConfig = getDedicatedApiProviderConfig(providerId);
    const isKnownProvider =
        providerId === 'official' || providerId === 'openai' || Boolean(providerConfig);
    if (!isKnownProvider) {
        throw new Error('Provider model list is not available.');
    }

    const url = getModelsUrl(providerId, providerConfig, baseUrl);
    if (!url) throw new Error('Model list URL is missing.');

    const headers = getRequestHeaders(providerId, providerConfig, apiKey);
    if (signal?.aborted) throw signal.reason || new Error('Request cancelled.');

    if (providerId === 'official') {
        return fetchGeminiEntries(url, headers, timeoutMs, signal);
    }
    if (providerConfig?.transport === 'anthropic-messages') {
        return extractAnthropicEntries(await fetchJson(url, headers, timeoutMs, signal));
    }
    return extractOpenAiEntries(await fetchJson(url, headers, timeoutMs, signal));
}
