import { describe, expect, it } from 'vitest';
import { getConfiguredModels, parseConfiguredModels } from './model_selection.js';

describe('provider model selection', () => {
    it('parses comma-separated model lists', () => {
        expect(parseConfiguredModels(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
    });

    it('reads the configured models for each provider', () => {
        const settings = {
            officialModel: 'gemini-4-argon, gemini-3.8-flash',
            openaiModel: 'gpt-6-astra',
            dedicatedApiProviders: {
                anthropic: {
                    provider: 'anthropic',
                    model: 'claude-sonnet-5-5, claude-opus-5-5',
                },
            },
        };

        expect(getConfiguredModels(settings, 'official')).toEqual([
            'gemini-4-argon',
            'gemini-3.8-flash',
        ]);
        expect(getConfiguredModels(settings, 'openai')).toEqual(['gpt-6-astra']);
        expect(getConfiguredModels(settings, 'anthropic')).toEqual([
            'claude-sonnet-5-5',
            'claude-opus-5-5',
        ]);
        expect(getConfiguredModels(settings, 'web')).toEqual([]);
    });
});
