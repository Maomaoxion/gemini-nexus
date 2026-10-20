import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CONTEXT_WINDOW_TOKENS,
    estimateHistoryTokens,
    estimateMessageTokens,
    estimateTextTokens,
    getAutoCompactBudget,
    getBuiltinContextWindow,
    normalizeContextWindowTokens,
} from './context_window.js';

describe('context window helpers', () => {
    it('estimates tokens for latin and CJK text', () => {
        expect(estimateTextTokens('')).toBe(0);
        expect(estimateTextTokens('hello world')).toBe(3);
        expect(estimateTextTokens('你好世界')).toBe(4);
        expect(estimateTextTokens('你好 world')).toBe(4);
    });

    it('uses conservative built-in windows when the API has no metadata', () => {
        expect(getBuiltinContextWindow('gemini-4-argon')).toBe(1048576);
        expect(getBuiltinContextWindow('google/gemini-3.8-flash')).toBe(1048576);
        expect(getBuiltinContextWindow('claude-sonnet-5-5')).toBe(200000);
        expect(getBuiltinContextWindow('gpt-6-astra')).toBe(400000);
        expect(getBuiltinContextWindow('deepseek-v4-pro')).toBe(1048576);
        expect(getBuiltinContextWindow('unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
    });

    it('clamps manual windows to the supported range', () => {
        expect(normalizeContextWindowTokens('200000')).toBe(200000);
        expect(normalizeContextWindowTokens('1')).toBe(4000);
        expect(normalizeContextWindowTokens('999999999')).toBe(10000000);
        expect(normalizeContextWindowTokens('bad', 0)).toBe(0);
    });

    it('counts text and attachment costs per message', () => {
        expect(estimateMessageTokens({ role: 'user', text: 'hello world' })).toBe(7);
        expect(
            estimateMessageTokens({
                role: 'user',
                text: '',
                attachments: [{ type: 'image/png', base64: 'x'.repeat(10000) }],
            })
        ).toBe(1204);
        expect(
            estimateHistoryTokens([
                { role: 'user', text: 'hello' },
                { role: 'ai', text: 'world' },
            ])
        ).toBe(12);
    });

    it('reserves output and system space in the auto-compact budget', () => {
        const budget = getAutoCompactBudget(128000);
        expect(budget.contextWindow).toBe(128000);
        expect(budget.outputReserve).toBe(19200);
        expect(budget.usableTokens).toBe(100800);
        expect(budget.triggerTokens).toBe(90720);

        const tiny = getAutoCompactBudget(4000);
        expect(tiny.usableTokens).toBe(4000);
        expect(tiny.triggerTokens).toBe(3600);
    });
});
