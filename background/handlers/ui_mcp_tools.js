import { respondWithUiTask } from './ui_async.js';

// Transports understood downstream (see inferMcpTransport in
// shared/mcp/transport.js). Anything else is rejected before any fetch.
const MCP_TRANSPORTS = new Set(['sse', 'streamable-http', 'streamablehttp', 'ws', 'websocket']);

// Header names that would pollute the merged object instead of sending a header.
const UNSAFE_MCP_HEADER_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeMcpUrl(rawUrl) {
    const url = String(rawUrl ?? '').trim();
    if (!url) throw new Error('Server URL is empty');
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('Server URL is invalid');
    }
    // Loopback is allowed on purpose (the default local bridge runs on
    // 127.0.0.1); anything non-http(s) — file://, chrome://, etc. — is not.
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
        throw new Error('Server URL must use http(s)');
    }
    return url;
}

function sanitizeMcpTransport(rawTransport) {
    const transport = String(rawTransport || 'sse').toLowerCase();
    if (!MCP_TRANSPORTS.has(transport)) {
        throw new Error(`Unsupported MCP transport: ${rawTransport}`);
    }
    return transport;
}

function sanitizeMcpHeaders(headers) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
    const result = {};
    for (const [name, value] of Object.entries(headers)) {
        const key = String(name || '').trim();
        if (!key || value === undefined || value === null) continue;
        if (UNSAFE_MCP_HEADER_NAMES.has(key.toLowerCase())) continue;
        const text = String(value).trim();
        if (!text) continue;
        result[key] = text;
    }
    return result;
}

async function loadMcpTools(mcpManager, request, fallbackServerId) {
    if (!mcpManager) throw new Error('MCP manager not available');

    const url = sanitizeMcpUrl(request.url);
    const transport = sanitizeMcpTransport(request.transport);

    const tools = await mcpManager.listTools({
        enableMcpTools: true,
        mcpTransport: transport,
        mcpServerUrl: url,
        mcpServerId: request.serverId || fallbackServerId,
        mcpHeaders: sanitizeMcpHeaders(request.headers),
    });

    return { tools, transport, url };
}

export function handleMcpTestConnection(mcpManager, request, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            const { tools, transport, url } = await loadMcpTools(mcpManager, request, '_test_');

            return {
                action: 'MCP_TEST_RESULT',
                ok: true,
                serverId: request.serverId || null,
                transport,
                url,
                toolsCount: Array.isArray(tools) ? tools.length : 0,
            };
        },
        {
            errorResponse: (error) => ({
                action: 'MCP_TEST_RESULT',
                ok: false,
                serverId: request.serverId || null,
                transport: request.transport || 'sse',
                url: request.url || '',
                error: error.message || String(error),
            }),
        }
    );
}

export function handleMcpListTools(mcpManager, request, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            const { tools, transport, url } = await loadMcpTools(mcpManager, request, '_tools_');

            return {
                action: 'MCP_TOOLS_RESULT',
                ok: true,
                serverId: request.serverId || null,
                requestKey: request.requestKey || null,
                transport,
                url,
                tools: toSafeMcpTools(tools),
            };
        },
        {
            errorResponse: (error) => ({
                action: 'MCP_TOOLS_RESULT',
                ok: false,
                serverId: request.serverId || null,
                requestKey: request.requestKey || null,
                transport: request.transport || 'sse',
                url: request.url || '',
                error: error.message || String(error),
                tools: [],
            }),
        }
    );
}

// Disconnect the live transport (and clear its tool-list cache) for one or
// more MCP servers. Called by the settings UI when a server is removed,
// disabled, or its transport/URL/headers change on save — without this the
// old SSE/WebSocket/streamable-HTTP transport stays open in the background's
// connection map and the UI keeps showing stale tools for a server that no
// longer exists or was reconfigured. disconnect() is a no-op if the server
// was never connected, so it is safe to call speculatively.
export function handleMcpDisconnect(mcpManager, request, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            if (!mcpManager) throw new Error('MCP manager not available');
            const serverIds = Array.isArray(request?.serverIds)
                ? request.serverIds.filter(Boolean)
                : request?.serverId
                  ? [request.serverId]
                  : [];
            await Promise.all(
                serverIds.map((serverId) =>
                    mcpManager.disconnect(serverId).catch((error) => {
                        console.warn(
                            '[MCP] Failed to disconnect server',
                            serverId,
                            error?.message || error
                        );
                    })
                )
            );
            // Best-effort ack: the caller does not await this, so the payload is
            // plain data rather than a message the UI is expected to handle.
            return { status: 'disconnected', serverIds };
        },
        {
            errorResponse: (error) => ({
                status: 'error',
                error: error.message || String(error),
            }),
        }
    );
}

function toSafeMcpTools(tools) {
    return Array.isArray(tools)
        ? tools.map((tool) => ({
              name: tool.name,
              description: tool.description || '',
          }))
        : [];
}
