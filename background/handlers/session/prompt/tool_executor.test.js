import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutor } from './tool_executor.js';

describe('ToolExecutor routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.chrome = {
            runtime: {
                sendMessage: vi.fn(() => Promise.resolve()),
            },
        };
    });

    it('routes local-name tools to MCP when browser control is disabled', async () => {
        const controlManager = {
            execute: vi.fn(async () => 'local click'),
        };
        const mcpManager = {
            isEnabled: vi.fn(() => true),
            callTool: vi.fn(async () => ({ text: 'remote click', files: [] })),
        };
        const executor = new ToolExecutor(controlManager, mcpManager);

        const result = await executor.executeCommand(
            { name: 'click', args: { selector: '#remote' } },
            {
                sessionId: 'session-1',
                enableBrowserControl: false,
                enableMcpTools: true,
                mcpTransport: 'sse',
                mcpServerUrl: 'http://127.0.0.1:3006/sse',
            },
            '{"tool":"click","args":{"selector":"#remote"}}'
        );

        expect(controlManager.execute).not.toHaveBeenCalled();
        expect(mcpManager.callTool).toHaveBeenCalledWith(
            expect.objectContaining({ enableMcpTools: true }),
            'click',
            { selector: '#remote' }
        );
        expect(result).toEqual(
            expect.objectContaining({
                source: 'mcp_remote',
                output: 'remote click',
                status: 'completed',
            })
        );
    });

    it('blocks routed MCP tools that are not selected for their server', async () => {
        const mcpManager = {
            isEnabled: vi.fn(() => true),
            callToolById: vi.fn(async () => ({ text: 'secret result', files: [] })),
        };
        const executor = new ToolExecutor(null, mcpManager);

        const result = await executor.executeCommand(
            { name: 'srv1__secret', args: {} },
            {
                sessionId: 'session-1',
                enableMcpTools: true,
                mcpServers: [
                    {
                        id: 'srv1',
                        transport: 'sse',
                        url: 'http://127.0.0.1:3006/sse',
                        enabled: true,
                        toolMode: 'selected',
                        enabledTools: ['allowed'],
                    },
                ],
            },
            '{"tool":"srv1__secret","args":{}}'
        );

        expect(mcpManager.callToolById).not.toHaveBeenCalled();
        expect(result).toEqual(
            expect.objectContaining({
                source: 'mcp_remote',
                status: 'failed',
                output: expect.stringContaining(
                    "External MCP tool 'secret' is disabled (not in selected tools)."
                ),
            })
        );
    });

    it('uses an enabled duplicate tool when an earlier server has the same tool disabled', async () => {
        const mcpManager = {
            isEnabled: vi.fn(() => true),
            listAllActiveTools: vi.fn(async () => [
                { name: 'search', _serverId: 'srv1', _toolId: 'srv1__search' },
                { name: 'search', _serverId: 'srv2', _toolId: 'srv2__search' },
            ]),
            callToolById: vi.fn(async () => ({ text: 'enabled search', files: [] })),
        };
        const executor = new ToolExecutor(null, mcpManager);

        const servers = [
            {
                id: 'srv1',
                transport: 'sse',
                url: 'http://127.0.0.1:3006/sse',
                enabled: true,
                toolMode: 'selected',
                enabledTools: ['read'],
            },
            {
                id: 'srv2',
                transport: 'sse',
                url: 'http://127.0.0.1:3007/sse',
                enabled: true,
                toolMode: 'selected',
                enabledTools: ['search'],
            },
        ];

        const result = await executor.executeCommand(
            { name: 'search', args: { q: 'mcp' } },
            {
                sessionId: 'session-1',
                enableMcpTools: true,
                mcpServers: servers,
            },
            '{"tool":"search","args":{"q":"mcp"}}'
        );

        expect(mcpManager.callToolById).toHaveBeenCalledWith('srv2__search', { q: 'mcp' }, servers);
        expect(result).toEqual(
            expect.objectContaining({
                source: 'mcp_remote',
                status: 'completed',
                output: 'enabled search',
            })
        );
    });

    it('fails clearly when a multi-server plain tool belongs to a removed server', async () => {
        const mcpManager = {
            isEnabled: vi.fn(() => true),
            listAllActiveTools: vi.fn(async () => [
                { name: 'search', _serverId: 'gone-server', _toolId: 'gone-server__search' },
            ]),
            callToolById: vi.fn(async () => ({ text: 'should not run', files: [] })),
        };
        const executor = new ToolExecutor(null, mcpManager);

        const result = await executor.executeCommand(
            { name: 'search', args: {} },
            {
                sessionId: 'session-1',
                enableMcpTools: true,
                mcpServers: [
                    {
                        id: 'still-here',
                        transport: 'sse',
                        url: 'http://127.0.0.1:3006/sse',
                        enabled: true,
                    },
                ],
            },
            '{"tool":"search","args":{}}'
        );

        expect(mcpManager.callToolById).not.toHaveBeenCalled();
        expect(result).toEqual(
            expect.objectContaining({
                source: 'mcp_remote',
                status: 'failed',
                output: expect.stringContaining('no longer configured'),
            })
        );
    });

    it('marks MCP tool-call results with isError as failed execution status', async () => {
        const mcpManager = {
            isEnabled: vi.fn(() => true),
            callTool: vi.fn(async () => ({
                text: 'permission denied',
                files: [],
                isError: true,
            })),
        };
        const executor = new ToolExecutor(null, mcpManager);

        const result = await executor.executeCommand(
            { name: 'read_secret', args: {} },
            {
                sessionId: 'session-1',
                enableMcpTools: true,
                mcpTransport: 'streamable-http',
                mcpServerUrl: 'http://127.0.0.1:3006/mcp',
            },
            '{"tool":"read_secret","args":{}}'
        );

        expect(result).toEqual(
            expect.objectContaining({
                source: 'mcp_remote',
                status: 'failed',
                output: 'permission denied',
            })
        );
        expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                status: 'failed',
                text: 'permission denied',
            })
        );
    });

    it('marks browser-control string errors as failed execution status', async () => {
        const controlManager = {
            execute: vi.fn(async () => 'Error: Element 1_2 not found in current snapshot.'),
        };
        const executor = new ToolExecutor(controlManager, null);

        const result = await executor.executeCommand(
            { name: 'click', args: { uid: '1_2' } },
            {
                sessionId: 'session-1',
                enableBrowserControl: true,
            },
            '{"tool":"click","args":{"uid":"1_2"}}'
        );

        expect(result).toEqual(
            expect.objectContaining({
                source: 'browser_control',
                status: 'failed',
                output: 'Error: Element 1_2 not found in current snapshot.',
            })
        );
        expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                status: 'failed',
                text: 'Error: Element 1_2 not found in current snapshot.',
            })
        );
    });

    it('forwards browser-control progress updates to the tool status card', async () => {
        const controlManager = {
            execute: vi.fn(async (toolCall, options = {}) => {
                options.onProgress?.({
                    phase: 'prepare',
                    text: 'Preparing the controlled tab and debugger session...',
                });
                options.onProgress?.({
                    phase: 'execute',
                    text: 'Running click...',
                });
                return 'Clicked element 1_2';
            }),
        };
        const executor = new ToolExecutor(controlManager, null);

        const result = await executor.executeCommand(
            { name: 'click', args: { uid: '1_2' } },
            {
                sessionId: 'session-1',
                enableBrowserControl: true,
            },
            '{"tool":"click","args":{"uid":"1_2"}}'
        );

        expect(result).toEqual(
            expect.objectContaining({
                source: 'browser_control',
                status: 'completed',
                output: 'Clicked element 1_2',
            })
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'running',
                phase: 'prepare',
                text: 'Preparing the controlled tab and debugger session...',
            })
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'running',
                phase: 'execute',
                text: 'Running click...',
            })
        );
    });

    it('uses unique status keys and records duration for repeated same-name tool calls', async () => {
        const now = vi
            .spyOn(Date, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(140)
            .mockReturnValueOnce(200)
            .mockReturnValueOnce(275);
        const controlManager = {
            execute: vi.fn(async () => 'clicked'),
        };
        const executor = new ToolExecutor(controlManager, null);
        const request = {
            sessionId: 'session-1',
            enableBrowserControl: true,
        };

        try {
            const first = await executor.executeCommand(
                { name: 'click', args: { uid: '1_2' } },
                request,
                '{"tool":"click","args":{"uid":"1_2"}}'
            );
            const second = await executor.executeCommand(
                { name: 'click', args: { uid: '1_3' } },
                request,
                '{"tool":"click","args":{"uid":"1_3"}}'
            );

            expect(first.statusKey).toMatch(/^session-1\|click\|local:/);
            expect(first.durationMs).toBe(40);
            expect(second.statusKey).toMatch(/^session-1\|click\|local:/);
            expect(second.statusKey).not.toBe(first.statusKey);
            expect(second.durationMs).toBe(75);
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    statusKey: expect.stringMatching(/^session-1\|click\|local:/),
                    status: 'running',
                    startedAt: 100,
                })
            );
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    statusKey: expect.stringMatching(/^session-1\|click\|local:/),
                    status: 'completed',
                    durationMs: 75,
                })
            );
        } finally {
            now.mockRestore();
        }
    });

    it('routes debug tools to the debug manager when debug tools are enabled', async () => {
        const debugManager = {
            execute: vi.fn(async () => 'console output'),
        };
        const executor = new ToolExecutor(null, null, debugManager);

        const result = await executor.executeCommand(
            { name: 'get_console_logs', args: { level: 'error' } },
            {
                sessionId: 'session-1',
                enableDebugTools: true,
            },
            '{"tool":"get_console_logs","args":{"level":"error"}}'
        );

        expect(debugManager.execute).toHaveBeenCalledWith('get_console_logs', { level: 'error' });
        expect(result).toEqual(
            expect.objectContaining({
                source: 'debug_tools',
                output: 'console output',
                status: 'completed',
            })
        );
    });

    it('marks debug tool error output as failed', async () => {
        const debugManager = {
            execute: vi.fn(async () => 'Error: Debug tools are not enabled for this tab.'),
        };
        const executor = new ToolExecutor(null, null, debugManager);

        const result = await executor.executeCommand(
            { name: 'get_page_errors', args: {} },
            {
                sessionId: 'session-1',
                enableDebugTools: true,
            },
            '{"tool":"get_page_errors","args":{}}'
        );

        expect(result).toEqual(
            expect.objectContaining({ source: 'debug_tools', status: 'failed' })
        );
    });

    it('does not route debug tools when debug tools are disabled', async () => {
        const debugManager = {
            execute: vi.fn(async () => 'should not be used'),
        };
        const executor = new ToolExecutor(null, null, debugManager);

        const result = await executor.executeCommand(
            { name: 'get_console_logs', args: {} },
            {
                sessionId: 'session-1',
                enableDebugTools: false,
            },
            '{"tool":"get_console_logs","args":{}}'
        );

        expect(debugManager.execute).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ source: 'unknown', status: 'failed' }));
    });
});
