import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleProviderModelList } from './ui_provider_models.js';

function jsonResponse(payload, ok = true, status = 200) {
    return {
        ok,
        status,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
    };
}

function callHandler(request) {
    return new Promise((resolve) => {
        handleProviderModelList(request, resolve);
    });
}

describe('provider model list', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches Gemini models page by page', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(
                jsonResponse({
                    models: [
                        {
                            name: 'models/gemini-4-argon',
                            supportedGenerationMethods: ['generateContent'],
                        },
                        {
                            name: 'models/text-embedding-004',
                            supportedGenerationMethods: ['embedContent'],
                        },
                    ],
                    nextPageToken: 'next-page',
                })
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    models: [
                        {
                            name: 'models/gemini-3.8-flash',
                            supportedGenerationMethods: ['generateContent'],
                        },
                    ],
                })
            );

        const response = await callHandler({
            provider: 'official',
            baseUrl: 'https://api.example.test/v1beta',
            apiKey: 'key',
        });

        expect(response).toMatchObject({ ok: true, provider: 'official' });
        expect(globalThis.fetch.mock.calls[0][0]).toBe(
            'https://api.example.test/v1beta/models?pageSize=1000'
        );
        expect(globalThis.fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('key');
        expect(globalThis.fetch.mock.calls[1][0]).toContain('pageToken=next-page');
        expect(response.models).toEqual(['gemini-3.8-flash', 'gemini-4-argon']);
    });

    it('fetches OpenAI-compatible model ids with a bearer key', async () => {
        globalThis.fetch.mockResolvedValueOnce(
            jsonResponse({
                data: [{ id: 'gpt-6-astra' }, { id: 'text-embedding-3-large' }],
            })
        );

        const response = await callHandler({
            provider: 'openai',
            baseUrl: 'https://relay.test/v1/',
            apiKey: 'sk-test',
        });

        expect(globalThis.fetch.mock.calls[0][0]).toBe('https://relay.test/v1/models');
        expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
        expect(response.models).toEqual(['gpt-6-astra', 'text-embedding-3-large']);
    });

    it('fetches Anthropic models with the messages API headers', async () => {
        globalThis.fetch.mockResolvedValueOnce(
            jsonResponse({
                data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }],
            })
        );

        const response = await callHandler({
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com/v1',
            apiKey: 'anthropic-key',
        });

        const headers = globalThis.fetch.mock.calls[0][1].headers;
        expect(headers['x-api-key']).toBe('anthropic-key');
        expect(headers['anthropic-version']).toBe('2023-06-01');
        expect(response.models).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    });

    it('reports provider errors instead of returning a partial list', async () => {
        globalThis.fetch.mockResolvedValueOnce(
            jsonResponse({ error: { message: 'invalid api key' } }, false, 401)
        );

        const response = await callHandler({
            provider: 'openai',
            baseUrl: 'https://relay.test/v1',
            apiKey: 'bad-key',
        });

        expect(response.ok).toBe(false);
        expect(response.models).toEqual([]);
        expect(response.error).toContain('401');
        expect(response.error).toContain('invalid api key');
    });

    it('does not fetch models for the Gemini Web provider', async () => {
        const response = await callHandler({ provider: 'web' });

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(response.ok).toBe(false);
        expect(response.error).toContain('fixed');
    });
});
