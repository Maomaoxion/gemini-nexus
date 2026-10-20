import {
    getBuiltinContextWindow,
    normalizeContextWindowTokens,
} from '../../../shared/models/context_window.js';
import { getProviderConnectionSettings } from '../../../shared/settings/connection.js';
import { isDedicatedApiProvider } from '../../../shared/settings/dedicated_providers.js';
import { fetchProviderModelEntries } from '../../../services/providers/model_catalog.js';
import { fetchPublicModelCatalog } from '../../../services/providers/public_model_catalog.js';

const ENTRIES_TTL_MS = 30 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOG_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

function supportsApiContext(providerId) {
    return (
        providerId === 'official' || providerId === 'openai' || isDedicatedApiProvider(providerId)
    );
}

const entriesCache = new Map();
const resultCache = new Map();
const failureUntil = new Map();

let catalogCache = null;
let catalogFailureUntil = 0;

function normalizeCatalogModelKey(modelId) {
    return String(modelId || '')
        .toLowerCase()
        .trim()
        .replace(/^~/, '')
        .replace(/^[^/]+\//, '')
        .replace(/[._]/g, '-')
        .replace(/-latest$/, '');
}

function findCatalogMatch(entries, modelId) {
    const targetFull = String(modelId || '')
        .toLowerCase()
        .trim();
    const targetKey = normalizeCatalogModelKey(modelId);
    if (!targetKey) return null;

    return (
        entries.find((entry) => entry.id.toLowerCase() === targetFull) ||
        entries.find((entry) => normalizeCatalogModelKey(entry.id) === targetKey) ||
        null
    );
}

async function getPublicCatalog() {
    const now = Date.now();
    if (catalogCache?.entries && now - catalogCache.fetchedAt < CATALOG_TTL_MS) {
        return catalogCache.entries;
    }
    if (catalogCache?.pending) return catalogCache.pending;
    if (catalogFailureUntil > now) throw new Error('Public catalog cooldown.');

    const pending = fetchPublicModelCatalog({ timeoutMs: FETCH_TIMEOUT_MS });
    catalogCache = { ...(catalogCache || {}), pending };
    try {
        const entries = await pending;
        catalogCache = { entries, fetchedAt: Date.now() };
        return entries;
    } catch (error) {
        catalogCache = null;
        catalogFailureUntil = Date.now() + CATALOG_FAILURE_COOLDOWN_MS;
        throw error;
    }
}

function getRequestDetails(provider, settings = {}, overrides = {}) {
    if (overrides.baseUrl != null || overrides.apiKey != null) {
        return {
            baseUrl: String(overrides.baseUrl || ''),
            apiKey: String(overrides.apiKey || ''),
        };
    }

    return getProviderConnectionSettings(provider, settings);
}

async function getProviderEntries(provider, request, { force = false, signal = null } = {}) {
    const cacheKey = `${provider}|${request.baseUrl}`;
    const now = Date.now();
    const cached = entriesCache.get(cacheKey);
    if (!force && cached && now - cached.fetchedAt < ENTRIES_TTL_MS) {
        return cached.entries;
    }
    if (!force && cached?.pending) return cached.pending;

    const pending = fetchProviderModelEntries({
        provider,
        baseUrl: request.baseUrl,
        apiKey: request.apiKey,
        timeoutMs: FETCH_TIMEOUT_MS,
        signal,
    });

    entriesCache.set(cacheKey, { ...(cached || {}), pending });
    try {
        const entries = await pending;
        entriesCache.set(cacheKey, { entries, fetchedAt: Date.now() });
        return entries;
    } catch (error) {
        entriesCache.delete(cacheKey);
        throw error;
    }
}

export async function resolveContextWindow({
    provider,
    model,
    settings = {},
    baseUrl,
    apiKey,
    signal = null,
    force = false,
} = {}) {
    const providerId = String(provider || '').trim();
    const modelId = String(model || '').trim();

    if (settings.contextWindowAuto === false) {
        return {
            tokens: normalizeContextWindowTokens(settings.contextWindowTokens),
            source: 'manual',
            diagnostics: null,
        };
    }

    const request = getRequestDetails(providerId, settings, { baseUrl, apiKey });
    const cacheKey = `${providerId}|${modelId}|${request.baseUrl}`;
    const now = Date.now();
    const cached = resultCache.get(cacheKey);
    if (!force && cached && now - cached.fetchedAt < ENTRIES_TTL_MS) {
        return cached.result;
    }

    let contextWindow = null;
    let diagnostics = { reason: 'provider-not-supported', fields: [] };

    if (supportsApiContext(providerId) && (force || !(failureUntil.get(providerId) > now))) {
        try {
            const entries = await getProviderEntries(providerId, request, { force, signal });
            failureUntil.delete(providerId);
            const match = entries.find((entry) => entry.id.toLowerCase() === modelId.toLowerCase());
            if (!match) {
                diagnostics = { reason: 'model-not-listed', fields: [] };
            } else {
                const fields = Array.isArray(match.fieldNames) ? match.fieldNames : [];
                contextWindow = match.contextWindow || null;
                diagnostics = contextWindow
                    ? { reason: 'api', fields }
                    : { reason: 'no-context-field', fields };
                if (!contextWindow) {
                    console.info('[Gemini Nexus] Provider /models has no context field', {
                        provider: providerId,
                        model: modelId,
                        fields,
                    });
                }
            }
        } catch (error) {
            // Do not retry a provider that is unreachable on every request.
            failureUntil.set(providerId, now + FAILURE_COOLDOWN_MS);
            diagnostics = {
                reason: 'request-failed',
                fields: [],
                error: error?.message || String(error),
            };
            console.warn(
                `[Gemini Nexus] Could not read the context window for ${providerId}:`,
                error?.message || error
            );
        }
    } else if (supportsApiContext(providerId)) {
        diagnostics = { reason: 'failure-cooldown', fields: [] };
    }

    // Relays commonly strip context metadata from /models. Fall back to the
    // public OpenRouter catalog, matched by the model id, before using the
    // built-in family table.
    if (!contextWindow) {
        try {
            const catalogEntries = await getPublicCatalog();
            const catalogMatch = findCatalogMatch(catalogEntries, modelId);
            if (catalogMatch?.contextWindow) {
                contextWindow = catalogMatch.contextWindow;
                diagnostics = {
                    reason: 'public-catalog',
                    fields: catalogMatch.fieldNames || [],
                };
            }
        } catch {
            // Best-effort; keep the provider diagnostics.
        }
    }

    const source = contextWindow
        ? diagnostics.reason === 'public-catalog'
            ? 'catalog'
            : 'api'
        : 'default';
    const result = contextWindow
        ? {
              tokens: normalizeContextWindowTokens(contextWindow),
              source,
              diagnostics,
          }
        : {
              tokens: getBuiltinContextWindow(modelId),
              source,
              diagnostics,
          };

    resultCache.set(cacheKey, { result, fetchedAt: Date.now() });
    return result;
}

export function resetContextWindowCacheForTest() {
    entriesCache.clear();
    resultCache.clear();
    failureUntil.clear();
    catalogCache = null;
    catalogFailureUntil = 0;
}
