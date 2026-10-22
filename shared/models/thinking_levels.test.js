import { describe, expect, it } from 'vitest';
import {
    getProviderThinkingLevel,
    getProviderThinkingLevels,
    getThinkingLevelStorageKey,
    normalizeThinkingLevelForProvider,
    setProviderThinkingLevel,
} from './thinking_levels.js';

describe('provider thinking levels', () => {
    it('offers provider-specific levels, including auto and xhigh/max where supported', () => {
        expect(getProviderThinkingLevels('official')).toEqual(['auto', 'low', 'medium', 'high']);
        expect(getProviderThinkingLevels('openai')).toEqual([
            'auto',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ]);
        expect(getProviderThinkingLevels('anthropic')).toEqual([
            'auto',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ]);
        expect(getProviderThinkingLevels('dashscope')).toEqual(['auto', 'off', 'on']);
        expect(getProviderThinkingLevels('deepseek')).toEqual([
            'auto',
            'low',
            'medium',
            'high',
            'max',
        ]);
        expect(getProviderThinkingLevels('web', '56fdd199312815e2')).toEqual(['low', 'high']);
        expect(getProviderThinkingLevels('web', 'unknown-model')).toEqual([]);
    });

    it('clamps levels the provider cannot accept', () => {
        expect(normalizeThinkingLevelForProvider('official', 'gemini-3.8-flash', 'max')).toBe(
            'low'
        );
        expect(normalizeThinkingLevelForProvider('openai', 'gpt-6-astra', 'max')).toBe('max');
        expect(normalizeThinkingLevelForProvider('deepseek', 'deepseek-v4-pro', 'max')).toBe('max');
        expect(normalizeThinkingLevelForProvider('deepseek', 'deepseek-v4-pro', 'auto')).toBe(
            'auto'
        );
        expect(normalizeThinkingLevelForProvider('dashscope', 'qwen3.8-max', 'high')).toBe('on');
        expect(normalizeThinkingLevelForProvider('dashscope', 'qwen3.8-max', 'off')).toBe('off');
        expect(normalizeThinkingLevelForProvider('dashscope', 'qwen3.8-max', 'auto')).toBe('auto');
        expect(normalizeThinkingLevelForProvider('web', '56fdd199312815e2', 'low')).toBe('low');
        expect(normalizeThinkingLevelForProvider('web', '56fdd199312815e2', 'medium')).toBe('high');
    });

    it('reads and writes levels on the connection settings object', () => {
        const settings = {
            webThinkingLevel: 'high',
            thinkingLevel: 'medium',
            openaiThinkingLevel: 'max',
            dedicatedApiProviders: {
                deepseek: { provider: 'deepseek', thinkingLevel: 'low' },
            },
        };

        expect(getProviderThinkingLevel(settings, 'web')).toBe('high');
        expect(getProviderThinkingLevel(settings, 'official')).toBe('medium');
        expect(getProviderThinkingLevel(settings, 'openai')).toBe('max');
        expect(getProviderThinkingLevel(settings, 'deepseek')).toBe('low');

        setProviderThinkingLevel(settings, 'anthropic', 'xhigh');

        expect(settings.dedicatedApiProviders.anthropic.thinkingLevel).toBe('xhigh');
    });

    it('maps providers to their storage keys', () => {
        expect(getThinkingLevelStorageKey('web')).toBe('geminiWebThinkingLevel');
        expect(getThinkingLevelStorageKey('official')).toBe('geminiThinkingLevel');
        expect(getThinkingLevelStorageKey('openai')).toBe('geminiOpenaiThinkingLevel');
        expect(getThinkingLevelStorageKey('deepseek')).toBe('geminiDeepseekThinkingLevel');
        expect(getThinkingLevelStorageKey('unknown')).toBeNull();
    });
});
