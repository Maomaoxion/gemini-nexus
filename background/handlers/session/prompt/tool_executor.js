import { parseToolCommand } from '../../../../shared/text/tool_call_text.js';
import { ToolDispatcher } from '../../../control/dispatcher.js';
import { isDebugTool } from '../../../debug/debug_tools.js';

export class ToolExecutor {
    constructor(controlManager, mcpManager, debugManager = null) {
        this.controlManager = controlManager;
        this.mcpManager = mcpManager;
        this.debugManager = debugManager;
        this.invocationCounter = 0;
    }

    async executeIfPresent(text, request, onUpdate) {
        const toolCommand = parseToolCommand(text);
        if (!toolCommand) return null;

        return this.executeCommand(toolCommand, request, text || '');
    }

    async executeFunctionCalls(functionCalls, request) {
        const calls = Array.isArray(functionCalls) ? functionCalls : [];
        const validCalls = calls.filter(
            (call) => call && typeof call.name === 'string' && call.name.trim()
        );
        const results = [];

        for (const [index, call] of validCalls.entries()) {
            results.push(
                await this.executeCommand(
                    {
                        name: call.name,
                        args: call.args || {},
                        id: call.id || null,
                    },
                    request,
                    this.formatFunctionCallText(call),
                    {
                        callIndex: index + 1,
                        callCount: validCalls.length,
                    }
                )
            );
        }

        return results;
    }

    async executeCommand(toolCommand, request, toolCallText = '', callMeta = {}) {
        const toolName = toolCommand.name;
        const callIndex = Number.isFinite(callMeta.callIndex) ? callMeta.callIndex : null;
        const callCount = Number.isFinite(callMeta.callCount) ? callMeta.callCount : null;
        const invocationId = this.createToolInvocationId(toolCommand);
        const statusKey = this.createToolStatusKey(request, toolName, invocationId);
        const startedAt = Date.now();
        this.sendToolStatus(request, {
            statusKey,
            toolName,
            status: 'running',
            toolCallText,
            callIndex,
            callCount,
            text: `Starting ${toolName}...`,
            startedAt,
        });

        let output = '';
        let files = null;
        let source = 'unknown';
        let status = 'completed';

        try {
            if (request.enableDebugTools === true && isDebugTool(toolName)) {
                if (!this.debugManager) {
                    throw new Error('Debug tools are unavailable.');
                }

                source = 'debug_tools';
                output = await this.debugManager.execute(toolName, toolCommand.args || {});
                if (isFailedToolOutput(output)) {
                    status = 'failed';
                }
            } else if (
                ToolDispatcher.isLocalTool(toolName) &&
                request.enableBrowserControl === true
            ) {
                if (!this.controlManager) {
                    throw new Error('Browser control is unavailable.');
                }

                source = 'browser_control';
                const execResult = await this.controlManager.execute(
                    {
                        name: toolName,
                        args: toolCommand.args || {},
                    },
                    {
                        onProgress: (progress) => {
                            const progressText =
                                typeof progress?.text === 'string' ? progress.text.trim() : '';
                            if (!progressText) return;
                            this.sendToolStatus(request, {
                                statusKey,
                                toolName,
                                status: 'running',
                                toolCallText,
                                callIndex,
                                callCount,
                                text: progressText,
                                phase: progress?.phase || '',
                                startedAt,
                            });
                        },
                    }
                );

                if (execResult && typeof execResult === 'object' && execResult.image) {
                    output = execResult.text;
                    files = [
                        {
                            base64: execResult.image,
                            type: 'image/png',
                            name: 'screenshot.png',
                        },
                    ];
                } else {
                    output = execResult;
                }

                if (isFailedToolOutput(output)) {
                    status = 'failed';
                }
            } else {
                const servers = Array.isArray(request.mcpServers) ? request.mcpServers : [];
                const isMultiServer = request.enableMcpTools === true && servers.length > 0;
                const mcpEnabled =
                    request.enableMcpTools === true &&
                    (isMultiServer || this.mcpManager.isEnabled(request));

                if (!this.mcpManager || !mcpEnabled) {
                    throw new Error(
                        `Unknown tool '${toolName}'. (External MCP tools are disabled)`
                    );
                }

                source = 'mcp_remote';
                let remote;

                const isMultiServerTool = toolName.includes('__');

                if (isMultiServerTool && isMultiServer) {
                    const { server, routedToolName } = this.resolveRoutedMcpTool(toolName, servers);
                    this.assertMcpToolEnabled(server, routedToolName);

                    remote = await this.mcpManager.callToolById(
                        toolName,
                        toolCommand.args || {},
                        servers
                    );
                } else if (isMultiServer) {
                    // Multi-server but plain tool name - try to find it in any server
                    const allTools = await this.mcpManager.listAllActiveTools(servers);
                    const matchingTools = allTools.filter((tool) => tool.name === toolName);

                    if (matchingTools.length === 0) {
                        throw new Error(`Tool '${toolName}' not found in any enabled MCP server.`);
                    }

                    const matchingTool = matchingTools.find((tool) => {
                        const server = servers.find(
                            (serverConfig) => serverConfig.id === tool._serverId
                        );
                        // Require a known server config — a missing server is not
                        // "enabled"; treating !server as true previously let the
                        // path fall through to matchingTool._toolId and throw.
                        return Boolean(server) && this.isMcpToolEnabled(server, toolName);
                    });

                    if (!matchingTool) {
                        const firstServer = servers.find(
                            (serverConfig) => serverConfig.id === matchingTools[0]._serverId
                        );
                        if (!firstServer) {
                            throw new Error(
                                `Tool '${toolName}' belongs to an MCP server that is no longer configured.`
                            );
                        }
                        this.assertMcpToolEnabled(firstServer, toolName);
                        // assertMcpToolEnabled always throws when this line is reached: a tool
                        // it considers enabled would already have matched the predicate above.
                        // The throw below only keeps `matchingTool._toolId` from NPE-ing if that
                        // invariant is ever broken.
                        throw new Error(
                            `Tool '${toolName}' is not available on any enabled MCP server.`
                        );
                    }

                    remote = await this.mcpManager.callToolById(
                        matchingTool._toolId,
                        toolCommand.args || {},
                        servers
                    );
                } else {
                    // Legacy single-server mode
                    if (request && request.mcpToolMode === 'selected') {
                        const enabled = Array.isArray(request.mcpEnabledTools)
                            ? request.mcpEnabledTools
                            : [];
                        const enabledSet = new Set(enabled);
                        if (!enabledSet.has(toolName)) {
                            throw new Error(
                                `External MCP tool '${toolName}' is disabled (not in selected tools).`
                            );
                        }
                    }
                    remote = await this.mcpManager.callTool(
                        request,
                        toolName,
                        toolCommand.args || {}
                    );
                }

                output = remote.text;
                files = remote.files && remote.files.length ? remote.files : null;
                if (remote.isError === true) status = 'failed';
            }
        } catch (error) {
            output = `Error executing tool: ${error.message}`;
            status = 'failed';
        }

        const completedAt = Date.now();
        const durationMs = Math.max(0, completedAt - startedAt);

        this.sendToolStatus(request, {
            statusKey,
            toolName,
            status,
            toolCallText,
            callIndex,
            callCount,
            text: status === 'failed' ? output : '',
            startedAt,
            completedAt,
            durationMs,
        });

        return {
            id: toolCommand.id || null,
            toolName,
            args: toolCommand.args || {},
            output,
            files,
            source,
            status,
            statusKey,
            startedAt,
            completedAt,
            durationMs,
            callIndex,
            callCount,
        };
    }

    formatFunctionCallText(call) {
        if (!call || typeof call.name !== 'string') return '';
        try {
            return JSON.stringify(isPlainObject(call.args) ? call.args : {}, null, 2);
        } catch {
            return '';
        }
    }

    createToolInvocationId(toolCommand) {
        if (typeof toolCommand?.id === 'string' && toolCommand.id.trim()) {
            return `call:${toolCommand.id.trim()}`;
        }
        this.invocationCounter += 1;
        // Include random to survive SW restart counter reset (avoid Date.now to keep Date.now mock deterministic)
        return `local:${this.invocationCounter}-${Math.random().toString(36).slice(2, 6)}`;
    }

    createToolStatusKey(request, toolName, invocationId) {
        const parts = [request?.sessionId || 'no-session', toolName || 'tool', invocationId];
        return parts.join('|');
    }

    resolveRoutedMcpTool(toolName, servers) {
        const sep = typeof toolName === 'string' ? toolName.indexOf('__') : -1;
        const serverId = sep === -1 ? '' : toolName.slice(0, sep);
        const routedToolName = sep === -1 ? toolName : toolName.slice(sep + 2);
        const server = servers.find((candidate) => candidate && candidate.id === serverId);

        if (!server) {
            throw new Error(`Server not found: ${serverId}`);
        }

        return { server, routedToolName };
    }

    assertMcpToolEnabled(server, toolName) {
        if (this.isMcpToolEnabled(server, toolName)) return;

        throw new Error(`External MCP tool '${toolName}' is disabled (not in selected tools).`);
    }

    isMcpToolEnabled(server, toolName) {
        // Missing server config is never "enabled" — callers must handle this
        // as a hard failure rather than treating it as an open allow.
        if (!server) return false;
        if (server.toolMode !== 'selected') return true;

        const enabled = Array.isArray(server.enabledTools)
            ? new Set(server.enabledTools)
            : new Set();
        return enabled.has(toolName);
    }

    sendToolStatus(request, status) {
        if (!request?.sessionId) return;
        chrome.runtime
            .sendMessage({
                action: 'TOOL_CALL_STATUS_MESSAGE',
                sessionId: request.sessionId,
                ...status,
            })
            .catch(() => {});
    }
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function isFailedToolOutput(output) {
    const text = typeof output === 'string' ? output.trim() : '';
    return /^(Error\b|Timed out\b|Script Exception:)/i.test(text);
}
