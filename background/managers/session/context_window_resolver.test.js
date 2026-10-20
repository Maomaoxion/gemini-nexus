import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveContextWindow, resetContextWindowCacheForTest } from './context_window_resolver.js';
import { fetchProviderModelEntries } from '../../../services/providers/model_catalog.js';
import { fetchPublicModelCatalog } from '../../../services/providers/public_model_catalog.js';

vi.mock('../../../services/providers/model_catalog.js', () => ({
    fetchProviderModelEntries: vi.fn(),
}));

vi.mock('../../../services/providers/public_model_catalog.js', () => ({
    fetchPublicModelCatalog: vi.fn(),
}));

describe('context window resolver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetContextWindowCacheForTest();
        fetchPublicModelCatalog.mockResolvedValue([]);
    });

    it('uses the manual window without calling the provider', async () => {
        const result = await resolveContextWindow({
            provider: 'official',
            model: 'gemini-4-argon',
            settings: { contextWindowAuto: false, contextWindowTokens: 200000 },
        });

        expect(result).toEqual({ tokens: 200000, source: 'manual', diagnostics: null });
        expect(fetchProviderModelEntries).not.toHaveBeenCalled();
    });

    it('reads the window from the provider models API and caches it', async () => {
        fetchProviderModelEntries.mockResolvedValue([
            {
                id: 'gemini-4-argon',
                contextWindow: 1048576,
                fieldNames: ['name', 'inputTokenLimit'],
            },
        ]);

        const first = await resolveContextWindow({
            provider: 'official',
            model: 'gemini-4-argon',
            settings: { officialBaseUrl: 'https://api.test', apiKey: 'key' },
        });
        const second = await resolveContextWindow({
            provider: 'official',
            model: 'gemini-4-argon',
            settings: { officialBaseUrl: 'https://api.test', apiKey: 'key' },
        });

        expect(first).toMatchObject({ tokens: 1048576, source: 'api' });
        expect(first.diagnostics).toMatchObject({ reason: 'api' });
        expect(second).toEqual(first);
        expect(fetchProviderModelEntries).toHaveBeenCalledTimes(1);
        expect(fetchProviderModelEntries).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'official',
                baseUrl: 'https://api.test',
                apiKey: 'key',
            })
        );
    });

    it('uses the built-in table for providers without metadata support', async () => {
        const result = await resolveContextWindow({
            provider: 'unknown-provider',
            model: 'claude-sonnet-5-5',
            settings: {},
        });

        expect(result).toMatchObject({ tokens: 200000, source: 'default' });
        expect(result.diagnostics).toMatchObject({ reason: 'provider-not-supported' });
        expect(fetchProviderModelEntries).not.toHaveBeenCalled();
    });

    it('reads the window from a dedicated provider models API', async () => {
        fetchProviderModelEntries.mockResolvedValue([
            {
                id: 'deepseek-flash',
                contextWindow: 1048576,
                fieldNames: ['id', 'context_length'],
            },
        ]);

        const result = await resolveContextWindow({
            provider: 'deepseek',
            model: 'deepseek-flash',
            settings: {
                dedicatedApiProviders: {
                    deepseek: { baseUrl: 'https://api.deepseek.com', apiKey: 'key' },
                },
            },
        });

        expect(result).toMatchObject({ tokens: 1048576, source: 'api' });
        expect(result.diagnostics).toMatchObject({ reason: 'api' });
        expect(fetchProviderModelEntries).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'deepseek',
                baseUrl: 'https://api.deepseek.com',
                apiKey: 'key',
            })
        );
    });

    it('falls back to the built-in table when the API lookup fails', async () => {
        fetchProviderModelEntries.mockRejectedValue(new Error('offline'));

        const result = await resolveContextWindow({
            provider: 'openai',
            model: 'gpt-6-astra',
            settings: { openaiBaseUrl: 'https://relay.test/v1', openaiApiKey: 'key' },
        });

        expect(result).toMatchObject({ tokens: 400000, source: 'default' });
        expect(result.diagnostics).toMatchObject({
            reason: 'request-failed',
            error: 'offline',
        });

        await resolveContextWindow({
            provider: 'openai',
            model: 'gpt-6-astra',
            settings: { openaiBaseUrl: 'https://relay.test/v1', openaiApiKey: 'key' },
        });
        expect(fetchProviderModelEntries).toHaveBeenCalledTimes(1);
    });

    it('reports the fields returned when the API has no context metadata', async () => {
        fetchProviderModelEntries.mockResolvedValue([
            {
                id: 'deepseek-flash',
                contextWindow: null,
                fieldNames: ['id', 'object', 'created', 'owned_by'],
            },
        ]);

        const result = await resolveContextWindow({
            provider: 'openai',
            model: 'deepseek-flash',
            settings: { openaiBaseUrl: 'https://relay.test/v1', openaiApiKey: 'key' },
        });

        expect(result).toMatchObject({ tokens: 1048576, source: 'default' });
        expect(result.diagnostics).toMatchObject({
            reason: 'no-context-field',
            fields: ['id', 'object', 'created', 'owned_by'],
        });
    });

    it('falls back to the public catalog when the relay strips context metadata', async () => {
        fetchProviderModelEntries.mockResolvedValue([
            {
                id: 'deepseek-flash',
                contextWindow: null,
                fieldNames: ['id', 'object', 'created', 'owned_by'],
            },
        ]);
        fetchPublicModelCatalog.mockResolvedValue([
            {
                id: '~deepseek/deepseek-flash-latest',
                contextWindow: 1048576,
                fieldNames: ['id', 'context_length'],
            },
        ]);

        const result = await resolveContextWindow({
            provider: 'openai',
            model: 'deepseek-flash',
            settings: { openaiBaseUrl: 'https://relay.test/v1', openaiApiKey: 'key' },
        });

        expect(result).toMatchObject({ tokens: 1048576, source: 'catalog' });
        expect(result.diagnostics).toMatchObject({ reason: 'public-catalog' });
    });

    it('matches dotted catalog ids against dashed model ids', async () => {
        fetchProviderModelEntries.mockResolvedValue([
            { id: 'claude-sonnet-5-5', contextWindow: null, fieldNames: ['id'] },
        ]);
        fetchPublicModelCatalog.mockResolvedValue([
            {
                id: 'anthropic/claude-sonnet-5.5',
                contextWindow: 200000,
                fieldNames: ['id', 'context_length'],
            },
        ]);

        const result = await resolveContextWindow({
            provider: 'openai',
            model: 'claude-sonnet-5-5',
            settings: { openaiBaseUrl: 'https://relay.test/v1', openaiApiKey: 'key' },
        });

        expect(result).toMatchObject({ tokens: 200000, source: 'catalog' });
    });
});
