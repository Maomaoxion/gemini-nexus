import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendRawMessages, appendUserMessage } from '../../../managers/history_manager.js';
import {
    buildNarrationNudgePrompt,
    executePendingToolResult,
    injectBrowserControlSnapshot,
    looksLikeUnexecutedBrowserActionPlan,
    looksLikeUnexecutedDebugPlan,
    persistToolOutputMessages,
} from './tool_loop.js';

vi.mock('../../../managers/history_manager.js', () => ({
    appendAiMessageIfDisplayable: vi.fn(),
    appendRawMessages: vi.fn(),
    appendUserMessage: vi.fn(),
}));

describe('looksLikeUnexecutedDebugPlan', () => {
    it('detects a transitional debug step without tool JSON', () => {
        expect(looksLikeUnexecutedDebugPlan('网络请求为空。接下来先检查控制台报错：')).toBe(true);
        expect(looksLikeUnexecutedDebugPlan('Let me check the console logs next.')).toBe(true);
    });

    it('detects a named debug tool without a JSON block', () => {
        expect(
            looksLikeUnexecutedDebugPlan(
                'I will use get_network_requests to inspect the failed calls.'
            )
        ).toBe(true);
    });

    it('ignores tool JSON, completion summaries, and plain answers', () => {
        expect(
            looksLikeUnexecutedDebugPlan(
                'Next I will check.\n```json\n{"tool":"get_page_errors","args":{}}\n```'
            )
        ).toBe(false);
        expect(looksLikeUnexecutedDebugPlan('调试检查已完成，没有发现异常。')).toBe(false);
        expect(looksLikeUnexecutedDebugPlan('Hello there.')).toBe(false);
    });

    it('does not nudge when a final answer only names debug tools', () => {
        expect(
            looksLikeUnexecutedDebugPlan(
                '可用的调试工具包括 get_page_errors、get_network_requests 和 get_storage。'
            )
        ).toBe(false);
        expect(
            looksLikeUnexecutedDebugPlan('get_console_logs 返回了 3 条日志，没有发现错误。')
        ).toBe(false);
    });

    it('nudges when an inspection intent names a debug tool', () => {
        expect(
            looksLikeUnexecutedDebugPlan('接下来我会调用 get_network_requests 查看失败的请求。')
        ).toBe(true);
    });
});

describe('looksLikeUnexecutedBrowserActionPlan', () => {
    it('detects Chinese narration that plans a fill without tool JSON', () => {
        const text =
            '语言下拉菜单的最新 UID 为 `13_147`。现在，我将在这个下拉菜单中选择“简体中文”。\n' +
            '由于“简体中文”是该选项对应的文本，我将直接使用 `fill` 工具进行操作。';
        expect(looksLikeUnexecutedBrowserActionPlan(text)).toBe(true);
    });

    it('detects Chinese 点击 + uid without an English tool name (Win11 SERP failure mode)', () => {
        const text =
            '已经点击了微软官方的 Windows 11 下载页面，现在我需要导航到微软官网。\n\n' +
            '我将点击该官方链接 `uid=8_67`（"Download Windows 11"），进入该页面以获取 ISO 镜像下载选项。';
        expect(looksLikeUnexecutedBrowserActionPlan(text)).toBe(true);
    });

    it('detects English intent + tool name without tool JSON', () => {
        expect(
            looksLikeUnexecutedBrowserActionPlan(
                'I will click the Confirm button next using the click tool on uid 10_127.'
            )
        ).toBe(true);
    });

    it('ignores completed summaries and plain answers', () => {
        expect(
            looksLikeUnexecutedBrowserActionPlan(
                '任务已完成。微软已开始提供 Windows 11 ISO 下载链接。'
            )
        ).toBe(false);
        expect(looksLikeUnexecutedBrowserActionPlan('Hello, how can I help you today?')).toBe(
            false
        );
    });

    it('does not treat status text with bare 现在+下载 as an action plan', () => {
        // Bare 「现在」 must not match intent; otherwise status descriptions nudge forever.
        expect(
            looksLikeUnexecutedBrowserActionPlan('页面现在显示了下载按钮，进度条在加载中。')
        ).toBe(false);
        expect(looksLikeUnexecutedBrowserActionPlan('现在下载进度显示为 50%。')).toBe(false);
    });

    it('ignores replies that already include a tool-call JSON block', () => {
        const text =
            'Next I will select the language.\n```json\n{"tool":"fill","args":{"uid":"13_147","value":"简体中文"}}\n```';
        expect(looksLikeUnexecutedBrowserActionPlan(text)).toBe(false);
    });

    it('builds a bilingual nudge that demands a tool JSON call', () => {
        expect(buildNarrationNudgePrompt('zh')).toContain('工具调用');
        expect(buildNarrationNudgePrompt('zh')).toContain('"tool"');
        expect(buildNarrationNudgePrompt('default')).toContain('tool call');
    });
});

describe('browser-control tool loop handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not inject a fresh page snapshot into generic failed browser-control outputs', async () => {
        const controlManager = {
            getSnapshot: vi.fn(() => Promise.resolve('snapshot')),
        };

        const output = await injectBrowserControlSnapshot({
            toolResult: {
                source: 'browser_control',
                toolName: 'click',
                status: 'failed',
            },
            outputForModel: 'Error: Target tab is outside the controlled tab group.',
            request: {
                enableBrowserControl: true,
            },
            controlManager,
        });

        expect(output).toBe('Error: Target tab is outside the controlled tab group.');
        expect(controlManager.getSnapshot).not.toHaveBeenCalled();
    });

    it('injects a recovery snapshot for UID-resolution failures', async () => {
        const controlManager = {
            getSnapshot: vi.fn(() => Promise.resolve('uid=9_1 RootWebArea "Home"')),
            getTargetTabId: vi.fn(() => null),
        };

        const output = await injectBrowserControlSnapshot({
            toolResult: {
                source: 'browser_control',
                toolName: 'click',
                status: 'failed',
            },
            outputForModel:
                "Error: Element '3_64' not found in current snapshot. Please verify the UID or take a new snapshot.",
            request: {
                enableBrowserControl: true,
            },
            controlManager,
        });

        expect(controlManager.getSnapshot).toHaveBeenCalled();
        expect(output).toContain('not found in current snapshot');
        expect(output).toContain('Updated Page Accessibility Tree');
        expect(output).toContain('uid=9_1');
    });

    it('persists native function responses and UI tool output with the same batch id', async () => {
        const sendRuntimeMessage = vi.fn(async () => {});
        const toolResult = {
            toolName: 'take_snapshot',
            source: 'browser_control',
            output: 'Snapshot text',
            outputForModel: 'Snapshot text',
            status: 'completed',
            statusKey: 'session-1|take_snapshot|call:call-1',
            officialResponseBatchId: 'official-tools|session-1|123|1',
            officialResponseParts: [
                {
                    functionResponse: {
                        id: 'call-1',
                        name: 'take_snapshot',
                        response: {
                            output: 'Snapshot text',
                            status: 'completed',
                        },
                    },
                },
            ],
            results: [
                {
                    id: 'call-1',
                    toolName: 'take_snapshot',
                    args: { uid: 'root' },
                    output: 'Snapshot text',
                    status: 'completed',
                    statusKey: 'session-1|take_snapshot|call:call-1',
                    startedAt: 100,
                    completedAt: 140,
                    durationMs: 40,
                    callIndex: 1,
                    callCount: 1,
                },
            ],
        };

        const persistedHistoryText = await persistToolOutputMessages({
            request: { sessionId: 'session-1' },
            result: {
                text: 'I need a snapshot.',
                thoughts: 'Thinking',
                officialContent: {
                    role: 'model',
                    parts: [{ functionCall: { id: 'call-1', name: 'take_snapshot', args: {} } }],
                },
                functionCalls: [{ id: 'call-1', name: 'take_snapshot', args: {} }],
            },
            toolResult,
            loopCount: 1,
            pendingNativeCalls: true,
            sendRuntimeMessage,
        });

        expect(persistedHistoryText).toBe('');
        expect(sendRuntimeMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'TOOL_OUTPUT_MESSAGE',
                sessionId: 'session-1',
                toolName: 'take_snapshot',
                text: 'Snapshot text',
                toolCallText: JSON.stringify({ uid: 'root' }, null, 2),
                status: 'completed',
                step: 1,
            })
        );
        expect(appendRawMessages).toHaveBeenCalledWith('session-1', [
            expect.objectContaining({
                role: 'ai',
                text: 'I need a snapshot.',
                officialContent: expect.objectContaining({ role: 'model' }),
            }),
            expect.objectContaining({
                role: 'user',
                text: '',
                officialFunctionResponseBatchId: 'official-tools|session-1|123|1',
                officialContent: expect.objectContaining({ role: 'user' }),
            }),
            expect.objectContaining({
                role: 'user',
                kind: 'tool-output',
                toolName: 'take_snapshot',
                officialFunctionResponseBatchId: 'official-tools|session-1|123|1',
            }),
        ]);
        expect(appendUserMessage).not.toHaveBeenCalled();
    });
});

describe('executePendingToolResult native calls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not attach official response parts to OpenAI/Anthropic native results', async () => {
        const toolExecutor = {
            executeFunctionCalls: vi.fn(async () => [
                {
                    id: 'call_1',
                    toolName: 'get_page_errors',
                    args: {},
                    output: 'no errors',
                    status: 'completed',
                },
            ]),
        };

        const { toolResult, pendingNativeCalls } = await executePendingToolResult({
            result: {
                text: '',
                functionCalls: [{ id: 'call_1', name: 'get_page_errors', args: {} }],
            },
            request: { sessionId: 'session-1', enableDebugTools: true },
            loopCount: 0,
            toolExecutor,
            onUpdate: vi.fn(),
        });

        expect(pendingNativeCalls).toBe(true);
        expect(toolResult).not.toBeNull();
        expect(toolResult.officialResponseParts).toBeNull();
        expect(toolResult.officialResponseBatchId).toBeNull();
        expect(toolResult.results).toHaveLength(1);
    });

    it('keeps official response parts for Gemini official native results', async () => {
        const toolExecutor = {
            executeFunctionCalls: vi.fn(async () => [
                {
                    id: 'call_1',
                    toolName: 'take_snapshot',
                    args: {},
                    output: 'Snapshot text',
                    status: 'completed',
                },
            ]),
        };

        const { toolResult } = await executePendingToolResult({
            result: {
                text: '',
                officialContent: {
                    role: 'model',
                    parts: [{ functionCall: { id: 'call_1', name: 'take_snapshot', args: {} } }],
                },
                functionCalls: [{ id: 'call_1', name: 'take_snapshot', args: {} }],
            },
            request: { sessionId: 'session-1', enableBrowserControl: true },
            loopCount: 0,
            toolExecutor,
            onUpdate: vi.fn(),
        });

        expect(toolResult).not.toBeNull();
        expect(toolResult.officialResponseParts).toEqual([
            {
                functionResponse: {
                    id: 'call_1',
                    name: 'take_snapshot',
                    response: { output: 'Snapshot text', status: 'completed' },
                },
            },
        ]);
        expect(toolResult.officialResponseBatchId).toBeTypeOf('string');
    });
});

describe('persistToolOutputMessages native tools', () => {
    it('persists assistant tool_calls and tool rows for OpenAI native calls', async () => {
        const result = {
            text: 'Checking...',
            thoughts: null,
            functionCalls: [{ id: 'call_1', name: 'get_page_errors', args: {} }],
        };
        const toolResult = {
            toolName: 'get_page_errors',
            output: 'no errors',
            outputForModel: 'no errors',
            status: 'completed',
            id: 'call_1',
            results: [
                {
                    id: 'call_1',
                    toolName: 'get_page_errors',
                    output: 'no errors',
                    status: 'completed',
                },
            ],
            officialResponseParts: [{ functionResponse: {} }],
            officialResponseBatchId: 'batch',
        };

        const sendRuntimeMessage = vi.fn();
        const output = await persistToolOutputMessages({
            request: { sessionId: 'session-1', nativeTools: true },
            result,
            toolResult,
            loopCount: 1,
            pendingNativeCalls: true,
            sendRuntimeMessage,
        });

        expect(output).toBe('');
        expect(sendRuntimeMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'TOOL_OUTPUT_MESSAGE',
                toolName: 'get_page_errors',
                toolCallId: 'call_1',
            })
        );
        expect(appendRawMessages).toHaveBeenCalledWith('session-1', [
            expect.objectContaining({
                role: 'ai',
                text: 'Checking...',
                toolCalls: [{ id: 'call_1', name: 'get_page_errors', args: {} }],
            }),
            expect.objectContaining({
                role: 'user',
                kind: 'tool-output',
                toolCallId: 'call_1',
                toolOutput: 'no errors',
            }),
        ]);
    });

    it('persists raw Anthropic content on the native assistant row', async () => {
        const anthropicContent = [
            { type: 'thinking', thinking: 'check', signature: 'sig-1' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_page_errors', input: {} },
        ];
        const result = {
            text: '',
            thoughts: 'check',
            functionCalls: [{ id: 'toolu_1', name: 'get_page_errors', args: {} }],
            anthropicContent,
        };
        const toolResult = {
            toolName: 'get_page_errors',
            output: 'no errors',
            status: 'completed',
            id: 'toolu_1',
            results: [{ id: 'toolu_1', toolName: 'get_page_errors', output: 'no errors' }],
            officialResponseParts: null,
            officialResponseBatchId: null,
        };

        await persistToolOutputMessages({
            request: { sessionId: 'session-1', nativeTools: true },
            result,
            toolResult,
            loopCount: 1,
            pendingNativeCalls: true,
            sendRuntimeMessage: vi.fn(),
        });

        expect(appendRawMessages).toHaveBeenCalledWith('session-1', [
            expect.objectContaining({
                role: 'ai',
                toolCalls: [{ id: 'toolu_1', name: 'get_page_errors', args: {} }],
                anthropicContent,
            }),
            expect.objectContaining({
                role: 'user',
                kind: 'tool-output',
                toolCallId: 'toolu_1',
            }),
        ]);
    });
});
