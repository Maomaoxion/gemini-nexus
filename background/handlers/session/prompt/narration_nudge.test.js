import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendAiMessageIfDisplayable } from '../../../managers/history_manager.js';
import { detectNarrationNudgeKind, runNarrationNudge } from './narration_nudge.js';

vi.mock('../../../managers/history_manager.js', () => ({
    appendAiMessage: vi.fn(),
    appendAiMessageIfDisplayable: vi.fn(),
    appendRawMessages: vi.fn(),
    appendUserMessage: vi.fn(),
}));

describe('detectNarrationNudgeKind', () => {
    it('never nudges in native tool mode', () => {
        const request = {
            nativeTools: true,
            enableBrowserControl: true,
            enableDebugTools: true,
        };

        expect(detectNarrationNudgeKind(request, '接下来我会调用 get_page_errors 检查。')).toBe(
            null
        );
        expect(detectNarrationNudgeKind(request, '我将点击提交按钮。')).toBe(null);
    });

    it('detects a debug inspection plan when only debug is enabled', () => {
        expect(
            detectNarrationNudgeKind({ enableDebugTools: true }, '接下来先检查控制台报错：')
        ).toBe('debug');
    });

    it('detects a browser action plan when only browser control is enabled', () => {
        expect(
            detectNarrationNudgeKind(
                { enableBrowserControl: true },
                '我将点击该链接 `uid=8_67`，然后等待结果。'
            )
        ).toBe('browser');
    });

    it('prefers browser control when both toggles are enabled', () => {
        expect(
            detectNarrationNudgeKind(
                { enableBrowserControl: true, enableDebugTools: true },
                '接下来我会使用 click 工具点击按钮。'
            )
        ).toBe('browser');
        expect(
            detectNarrationNudgeKind(
                { enableBrowserControl: true, enableDebugTools: true },
                '接下来我会调用 get_network_requests 查看失败的请求。'
            )
        ).toBe('debug');
    });

    it('ignores plain answers and completion statements', () => {
        expect(
            detectNarrationNudgeKind(
                { enableDebugTools: true },
                'get_console_logs 返回了 3 条日志，没有发现错误。'
            )
        ).toBe(null);
        expect(detectNarrationNudgeKind({ enableDebugTools: true }, '任务已完成。')).toBe(null);
    });
});

describe('runNarrationNudge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.chrome = {
            runtime: {
                sendMessage: vi.fn(() => Promise.resolve()),
            },
        };
    });

    it('persists and broadcasts the narration-only reply before the retry', async () => {
        const wait = vi.fn(() => Promise.resolve());

        const nudge = await runNarrationNudge({
            kind: 'debug',
            runId: 'run-1',
            loop: 2,
            request: { sessionId: 'session-1' },
            result: { text: '接下来先检查控制台报错：' },
            language: 'zh',
            wait,
        });

        expect(appendAiMessageIfDisplayable).toHaveBeenCalledWith(
            'session-1',
            expect.objectContaining({ text: '接下来先检查控制台报错：', suppressCopy: true })
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'AGENT_INTERMEDIATE_MESSAGE',
                sessionId: 'session-1',
                text: '接下来先检查控制台报错：',
                suppressCopy: true,
            })
        );
        expect(wait).toHaveBeenCalledTimes(1);
        expect(nudge.promptText).toContain('调试工具调用');
        expect(nudge.historyText).toBe('接下来先检查控制台报错：');
    });

    it('uses the browser nudge prompt for browser-control plans', async () => {
        const nudge = await runNarrationNudge({
            kind: 'browser',
            runId: 'run-2',
            loop: 1,
            request: { sessionId: null },
            result: { text: '我将点击提交按钮。' },
            language: 'default',
        });

        expect(appendAiMessageIfDisplayable).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'AGENT_INTERMEDIATE_MESSAGE', sessionId: null })
        );
        expect(nudge.promptText).toContain('tool call');
    });
});
