import { readContextWindow } from './shared/context_window_field.js';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithHeadersTimeout } from './shared/fetch_timeout.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Public OpenRouter model catalog, used when a relay strips the context
 * metadata from its own /models response. No API key is required.
 */
export async function fetchPublicModelCatalog({
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    signal = null,
} = {}) {
    const response = await fetchWithHeadersTimeout(
        OPENROUTER_MODELS_URL,
        {
            method: 'GET',
            headers: { Accept: 'application/json' },
            ...(signal ? { signal } : {}),
        },
        timeoutMs
    );
    if (!response.ok) {
        throw new Error(`OpenRouter catalog error (${response.status}).`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data : [];
    return items
        .map((item) => {
            const id = String(item?.id || '').trim();
            if (!id) return null;
            return {
                id,
                contextWindow: readContextWindow(item),
                fieldNames: Object.keys(item || {}),
            };
        })
        .filter(Boolean);
}
