import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    TOOL_RESULT_UNAVAILABLE,
    createPendingToolCalls,
    flushPendingToolCalls,
    getToolOutputContent,
    isToolCallTurnMessage,
    isToolOutputHistoryMessage,
    resolveToolOutputPairing,
} from './tool_call_history.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('isToolOutputHistoryMessage', () => {
    it('accepts tool-output rows by kind or by text header', () => {
        expect(isToolOutputHistoryMessage({ role: 'user', kind: 'tool-output' })).toBe(true);
        expect(isToolOutputHistoryMessage({ role: 'user', text: '[Tool Output: click]\nok' })).toBe(
            true
        );
    });

    it('rejects other rows', () => {
        expect(isToolOutputHistoryMessage({ role: 'ai', text: '[Tool Output: click]' })).toBe(
            false
        );
        expect(isToolOutputHistoryMessage({ role: 'user', text: 'hello' })).toBe(false);
        expect(isToolOutputHistoryMessage(null)).toBe(false);
    });
});

describe('isToolCallTurnMessage', () => {
    it('requires an ai row with tool calls', () => {
        expect(isToolCallTurnMessage({ role: 'ai', toolCalls: [{ id: 'call_1' }] })).toBe(true);
        expect(isToolCallTurnMessage({ role: 'ai', toolCalls: [] })).toBe(false);
        expect(isToolCallTurnMessage({ role: 'user', toolCalls: [{ id: 'call_1' }] })).toBe(false);
    });
});

describe('resolveToolOutputPairing', () => {
    it('pairs by order when the stored id is missing and warns with context', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pending = createPendingToolCalls([{ id: 'call_1', name: 'get_console_logs' }]);

        const paired = resolveToolOutputPairing(
            pending,
            {
                role: 'user',
                kind: 'tool-output',
                toolName: 'get_console_logs',
                toolOutput: 'log line',
            },
            { role: 'ai', kind: 'text' }
        );

        expect(paired).toEqual({ toolCallId: 'call_1', toolName: 'get_console_logs' });
        expect(pending.size).toBe(0);
        expect(warnSpy).toHaveBeenCalledWith(
            '[Gemini Nexus] Tool result id mismatch; pairing by order',
            expect.objectContaining({
                storedToolCallId: '',
                pairedToolCallId: 'call_1',
                toolName: 'get_console_logs',
                expectedToolName: 'get_console_logs',
                nextMessageRole: 'ai',
                nextMessageKind: 'text',
            })
        );
    });

    it('pairs by order when the stored id does not match', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pending = createPendingToolCalls([{ id: 'call_1', name: 'get_page_errors' }]);

        const paired = resolveToolOutputPairing(pending, {
            role: 'user',
            kind: 'tool-output',
            toolCallId: 'call_other',
            toolOutput: 'no errors',
        });

        expect(paired).toEqual({ toolCallId: 'call_1', toolName: 'get_page_errors' });
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps the exact id when it matches even out of order', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pending = createPendingToolCalls([
            { id: 'call_1', name: 'first' },
            { id: 'call_2', name: 'second' },
        ]);

        const paired = resolveToolOutputPairing(pending, { toolCallId: 'call_2' });

        expect(paired).toEqual({ toolCallId: 'call_2', toolName: 'second' });
        expect(pending.has('call_1')).toBe(true);
        expect(pending.has('call_2')).toBe(false);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('falls back to call order across multiple results without ids', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pending = createPendingToolCalls([
            { id: 'call_1', name: 'first' },
            { id: 'call_2', name: 'second' },
        ]);

        expect(resolveToolOutputPairing(pending, { toolOutput: 'a' })?.toolCallId).toBe('call_1');
        expect(resolveToolOutputPairing(pending, { toolOutput: 'b' })?.toolCallId).toBe('call_2');
        expect(pending.size).toBe(0);
    });

    it('drops orphan results when no call is pending', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const paired = resolveToolOutputPairing(new Map(), {
            role: 'user',
            kind: 'tool-output',
            toolCallId: 'missing',
            toolOutput: 'orphan',
        });

        expect(paired).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe('flushPendingToolCalls', () => {
    it('returns pending calls in order, warns, and clears the map', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pending = createPendingToolCalls([
            { id: 'call_1', name: 'first' },
            { id: 'call_2', name: 'second' },
        ]);

        const flushed = flushPendingToolCalls(pending, {
            role: 'user',
            kind: 'tool-output',
            toolCallId: 'call_1',
        });

        expect(flushed).toEqual([
            { toolCallId: 'call_1', toolName: 'first' },
            { toolCallId: 'call_2', toolName: 'second' },
        ]);
        expect(pending.size).toBe(0);
        expect(warnSpy).toHaveBeenCalledWith(
            '[Gemini Nexus] Tool results missing from history',
            expect.objectContaining({
                toolCallIds: ['call_1', 'call_2'],
                toolNames: ['first', 'second'],
                nextMessageRole: 'user',
                nextMessageKind: 'tool-output',
                nextMessageToolCallId: 'call_1',
            })
        );
    });

    it('uses the end-of-history warning when no next message exists', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pending = createPendingToolCalls([{ id: 'call_1', name: 'get_page_errors' }]);

        flushPendingToolCalls(pending);

        expect(warnSpy).toHaveBeenCalledWith(
            '[Gemini Nexus] Tool results missing at end of history',
            expect.objectContaining({
                toolCallIds: ['call_1'],
                toolNames: ['get_page_errors'],
                nextMessageRole: '',
                nextMessageKind: '',
            })
        );
    });

    it('stays silent when nothing is pending', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(flushPendingToolCalls(new Map())).toEqual([]);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe('getToolOutputContent', () => {
    it('prefers the stored tool output over the history text', () => {
        expect(getToolOutputContent({ toolOutput: 'body', text: '[Tool Output: x]' })).toBe('body');
        expect(getToolOutputContent({ text: '[Tool Output: x]' })).toBe('[Tool Output: x]');
    });
});

describe('TOOL_RESULT_UNAVAILABLE', () => {
    it('matches the placeholder required by native tool replay', () => {
        expect(TOOL_RESULT_UNAVAILABLE).toBe('[Tool result unavailable]');
    });
});
