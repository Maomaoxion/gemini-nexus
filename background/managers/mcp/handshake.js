import { sendNotification } from './rpc_messages.js';
import { isStreamableHttpFallbackError } from './streamable_http.js';

const DEFAULT_PROTOCOL_VERSIONS = [
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    '2024-11-05',
    '2024-10-07',
    '2024-06-20',
];

function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUnsupportedProtocolError(error) {
    return (
        error &&
        typeof error.message === 'string' &&
        error.message.startsWith('Unsupported MCP protocol version:')
    );
}

export async function initializeMcpHandshake(
    conn,
    { clientName, clientVersion, sendRpc, sleep = defaultSleep }
) {
    let lastError = null;
    let firstError = null;
    for (let i = 0; i < DEFAULT_PROTOCOL_VERSIONS.length; i++) {
        const protocolVersion = DEFAULT_PROTOCOL_VERSIONS[i];
        try {
            const result = await sendRpc('initialize', {
                protocolVersion,
                capabilities: {},
                clientInfo: { name: clientName, version: clientVersion },
            });

            const selectedProtocolVersion =
                result && typeof result.protocolVersion === 'string'
                    ? result.protocolVersion
                    : protocolVersion;
            if (!DEFAULT_PROTOCOL_VERSIONS.includes(selectedProtocolVersion)) {
                throw new Error(`Unsupported MCP protocol version: ${selectedProtocolVersion}`);
            }

            conn.protocolVersion = selectedProtocolVersion;
            conn.serverCapabilities =
                result && result.capabilities && typeof result.capabilities === 'object'
                    ? result.capabilities
                    : {};
            conn.serverInfo =
                result && result.serverInfo && typeof result.serverInfo === 'object'
                    ? result.serverInfo
                    : null;
            conn.instructions =
                result && typeof result.instructions === 'string' ? result.instructions : '';
            sendNotification(conn, 'notifications/initialized', {});
            conn.initialized = true;
            return;
        } catch (error) {
            lastError = error;
            if (!firstError) firstError = error;
            if (isStreamableHttpFallbackError(error)) throw error;
            if (isUnsupportedProtocolError(error)) throw error;
            // Don't retry on 4xx client errors (except protocol mismatch handled above)
            const msg = String(error?.message || '');
            if (/\(4\d{2}\)/.test(msg) && !msg.includes('Unsupported MCP protocol version')) {
                throw error;
            }
            if (i < DEFAULT_PROTOCOL_VERSIONS.length - 1) {
                const backoff = 150 * Math.pow(2, i) + Math.random() * 100;
                await sleep(Math.min(backoff, 2000));
            }
        }
    }
    throw firstError || lastError || new Error('Failed to initialize MCP connection');
}
