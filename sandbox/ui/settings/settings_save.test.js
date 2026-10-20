import { describe, expect, it } from 'vitest';

import {
    buildConnectionSettingsForSave,
    buildContextSettingsForSave,
    normalizeAccountIndices,
} from './settings_save.js';

describe('settings save helpers', () => {
    it('normalizes comma-separated account indices before saving', () => {
        expect(normalizeAccountIndices('0, abc, 2, ,03')).toBe('0,2,03');
        expect(normalizeAccountIndices('abc')).toBe('0');
    });

    it('keeps the manual context window override when set', () => {
        expect(buildContextSettingsForSave({ contextWindowTokens: '200000' })).toEqual({
            windowAuto: false,
            windowTokens: 200000,
        });
        expect(buildContextSettingsForSave({ contextWindowTokens: '' })).toEqual({
            windowAuto: true,
            windowTokens: 0,
        });
    });

    it('preserves the currently selected OpenAI model while saving connection form data', () => {
        expect(
            buildConnectionSettingsForSave(
                {
                    provider: 'openai',
                    webTemporaryChat: true,
                    openaiModel: 'gpt-5,gpt-5-mini',
                    openaiUseResponsesApi: true,
                    openaiWebSearch: true,
                    mcpServers: [{ id: 'srv-1', url: 'http://localhost/mcp' }],
                },
                { openaiSelectedModel: 'gpt-5-mini', webThinkingLevel: 'minimal' }
            )
        ).toMatchObject({
            provider: 'openai',
            webThinkingLevel: 'minimal',
            webTemporaryChat: true,
            openaiModel: 'gpt-5,gpt-5-mini',
            openaiSelectedModel: 'gpt-5-mini',
            openaiUseResponsesApi: true,
            openaiWebSearch: true,
            mcpServers: [{ id: 'srv-1', url: 'http://localhost/mcp' }],
        });
    });

    it('normalizes dedicated provider settings while saving connection form data', () => {
        expect(
            buildConnectionSettingsForSave(
                {
                    provider: 'deepseek',
                    dedicatedApiProviders: {
                        deepseek: {
                            baseUrl: 'https://api.deepseek.com',
                            apiKey: 'deepseek-key',
                            model: 'deepseek-v4-pro',
                            selectedModel: 'deepseek-v4-pro',
                            thinkingLevel: 'high',
                        },
                    },
                },
                { webThinkingLevel: 'high' }
            )
        ).toMatchObject({
            provider: 'deepseek',
            dedicatedApiProviders: expect.objectContaining({
                deepseek: expect.objectContaining({
                    apiKey: 'deepseek-key',
                    selectedModel: 'deepseek-v4-pro',
                    thinkingLevel: 'high',
                }),
            }),
        });
    });

    it('keeps header-selected thinking levels while saving connection form data', () => {
        const saved = buildConnectionSettingsForSave(
            {
                provider: 'anthropic',
                thinkingLevel: 'low',
                openaiThinkingLevel: 'low',
                dedicatedApiProviders: {
                    anthropic: {
                        provider: 'anthropic',
                        model: 'claude-sonnet-5-5',
                        thinkingLevel: 'low',
                    },
                },
            },
            {
                thinkingLevel: 'max',
                openaiThinkingLevel: 'xhigh',
                dedicatedApiProviders: {
                    anthropic: { provider: 'anthropic', thinkingLevel: 'max' },
                },
            }
        );

        expect(saved.thinkingLevel).toBe('max');
        expect(saved.openaiThinkingLevel).toBe('xhigh');
        expect(saved.dedicatedApiProviders.anthropic.thinkingLevel).toBe('max');
    });
});
