import { sendToBackground } from '../../../../shared/messaging/index.js';
import { inferMcpTransport, normalizeMcpHeaders } from '../../../../shared/mcp/transport.js';
import {
    getDedicatedApiProviderConfig,
    isDedicatedApiProvider,
} from '../../../../shared/settings/dedicated_providers.js';
import { t } from '../../../core/i18n.js';
import {
    CONTEXT_WINDOW_MIN_TOKENS,
    normalizeContextWindowTokens,
} from '../../../../shared/models/context_window.js';

export function bindConnectionSectionEvents(section) {
    const { providerSelect } = section.elements;
    if (providerSelect) {
        providerSelect.addEventListener('change', (event) => {
            section._saveDedicatedApiProviderEdits(section.activeProvider);
            section.updateVisibility(event.target.value);
            section.callbacks?.onProviderChange?.(event.target.value);
        });
    }

    const { dedicatedApiRefreshModels } = section.elements;
    if (dedicatedApiRefreshModels) {
        dedicatedApiRefreshModels.addEventListener('click', () => {
            const provider = providerSelect?.value || section.activeProvider;
            const config = getDedicatedApiProviderConfig(provider);
            if (!isDedicatedApiProvider(provider)) return;

            section._saveDedicatedApiProviderEdits(provider);
            const providerSettings = section.dedicatedApiProviders[provider] || {};
            section.setProviderModelListStatus(t('modelListFetching'), false, provider);
            dedicatedApiRefreshModels.disabled = true;
            sendToBackground({
                action: 'GET_PROVIDER_MODELS',
                provider,
                baseUrl: providerSettings.baseUrl || config.defaultBaseUrl,
                apiKey: providerSettings.apiKey || '',
            });
        });
    }

    const { officialRefreshModels, openaiRefreshModels } = section.elements;
    if (officialRefreshModels) {
        officialRefreshModels.addEventListener('click', () => {
            section.setProviderModelListStatus(t('modelListFetching'), false, 'official');
            officialRefreshModels.disabled = true;
            sendToBackground({
                action: 'GET_PROVIDER_MODELS',
                provider: 'official',
                baseUrl: section.elements.officialBaseUrl?.value.trim() || '',
                apiKey: section.elements.apiKeyInput?.value.trim() || '',
            });
        });
    }

    if (openaiRefreshModels) {
        openaiRefreshModels.addEventListener('click', () => {
            section.setProviderModelListStatus(t('modelListFetching'), false, 'openai');
            openaiRefreshModels.disabled = true;
            sendToBackground({
                action: 'GET_PROVIDER_MODELS',
                provider: 'openai',
                baseUrl: section.elements.openaiBaseUrl?.value.trim() || '',
                apiKey: section.elements.openaiApiKey?.value.trim() || '',
            });
        });
    }

    const { contextWindowTokens } = section.elements;
    if (contextWindowTokens) {
        contextWindowTokens.addEventListener('change', (event) => {
            if (!event.target.value.trim()) return;
            const value = normalizeContextWindowTokens(
                event.target.value,
                CONTEXT_WINDOW_MIN_TOKENS
            );
            event.target.value = String(value);
        });
    }

    const { mcpEnabled } = section.elements;
    if (mcpEnabled) {
        mcpEnabled.addEventListener('change', (event) => {
            section.updateMcpVisibility(event.target.checked === true);
        });
    }

    const {
        mcpServerSelect,
        mcpAddServer,
        mcpRemoveServer,
        mcpServerName,
        mcpTransport,
        mcpServerUrl,
        mcpHeaders,
        mcpServerEnabled,
        mcpTestConnection,
        mcpToolMode,
        mcpRefreshTools,
        mcpEnableAllTools,
        mcpDisableAllTools,
        mcpToolSearch,
    } = section.elements;

    if (mcpServerSelect) {
        mcpServerSelect.addEventListener('change', (event) => {
            section._saveCurrentServerEdits();
            section.mcpActiveServerId = event.target.value;
            section._loadActiveServerIntoForm();
            section._renderMcpServerOptions();
            section.setMcpTestStatus('');
        });
    }

    if (mcpAddServer) {
        mcpAddServer.addEventListener('click', () => {
            section._saveCurrentServerEdits();
            const server = section._getDefaultServer();
            section.mcpServers.push(server);
            section.mcpActiveServerId = server.id;
            section._renderMcpServerOptions();
            section._loadActiveServerIntoForm();
            section.setMcpTestStatus('');
        });
    }

    if (mcpRemoveServer) {
        mcpRemoveServer.addEventListener('click', () => {
            section._saveCurrentServerEdits();
            const id = section.mcpActiveServerId;
            if (!id) return;

            // Tear down the live transport + clear the cached tool list for the
            // server being removed. Without this the SSE/WebSocket/streamable-
            // HTTP connection stays open in the background's connection map and
            // the UI keeps a stale tool entry for a server that no longer exists.
            section.disconnectMcpServer(id);

            section.mcpServers = section.mcpServers.filter((server) => server.id !== id);

            if (section.mcpServers.length === 0) {
                const server = section._getDefaultServer();
                server.enabled = false;
                section.mcpServers = [server];
            }

            section.mcpActiveServerId = section.mcpServers[0].id;
            section._renderMcpServerOptions();
            section._loadActiveServerIntoForm();
            section.setMcpTestStatus('');
        });
    }

    const onEdit = () => {
        section._saveCurrentServerEdits();
        section._renderMcpServerOptions();
    };

    if (mcpServerName) mcpServerName.addEventListener('input', onEdit);
    if (mcpServerUrl) mcpServerUrl.addEventListener('input', onEdit);
    if (mcpHeaders) mcpHeaders.addEventListener('input', onEdit);
    if (mcpTransport) {
        mcpTransport.addEventListener('change', () => {
            const server = section._getActiveServer();
            const prevTransport = server ? server.transport || 'sse' : 'sse';
            const nextTransport = mcpTransport.value || 'sse';

            if (mcpServerUrl) {
                mcpServerUrl.placeholder = section._getDefaultUrlForTransport(nextTransport);
            }

            if (server && mcpServerUrl) {
                const currentUrl = (mcpServerUrl.value || '').trim();
                const prevDefault = section._getDefaultUrlForTransport(prevTransport);
                if (!currentUrl || currentUrl === prevDefault) {
                    mcpServerUrl.value = section._getDefaultUrlForTransport(nextTransport);
                }
            }

            onEdit();
        });
    }
    if (mcpServerEnabled) mcpServerEnabled.addEventListener('change', onEdit);

    if (mcpToolMode) {
        mcpToolMode.addEventListener('change', () => {
            section._saveCurrentServerEdits();
            section._renderToolsUI();
        });
    }

    if (mcpToolSearch) {
        mcpToolSearch.addEventListener('input', () => {
            section._renderToolsUI();
        });
    }

    if (mcpRefreshTools) {
        mcpRefreshTools.addEventListener('click', () => {
            if (!section._saveCurrentServerEdits()) return;
            const server = section._getActiveServer();
            if (!server) return;

            section.setMcpTestStatus(t('mcpFetchingTools'));
            sendToBackground({
                action: 'MCP_LIST_TOOLS',
                serverId: server.id,
                requestKey: section._serverKey(server),
                transport: inferMcpTransport(server.transport, server.url),
                url: server.url || '',
                headers: normalizeMcpHeaders(server.headers),
            });
        });
    }

    if (mcpEnableAllTools) {
        mcpEnableAllTools.addEventListener('click', () => {
            const server = section._getActiveServer();
            if (!server) return;
            const cached = section._getCachedTools(server);
            if (!cached || cached.length === 0) return;
            server.toolMode = 'selected';
            server.enabledTools = cached.map((tool) => tool.name).filter(Boolean);
            section._loadActiveServerIntoForm();
            section._renderToolsUI();
        });
    }

    if (mcpDisableAllTools) {
        mcpDisableAllTools.addEventListener('click', () => {
            const server = section._getActiveServer();
            if (!server) return;
            server.toolMode = 'selected';
            server.enabledTools = [];
            section._loadActiveServerIntoForm();
            section._renderToolsUI();
        });
    }

    if (mcpTestConnection) {
        mcpTestConnection.addEventListener('click', () => {
            if (!section._saveCurrentServerEdits()) return;
            const server = section._getActiveServer();
            if (!server) return;

            section.setMcpTestStatus(t('mcpTestingConnection'));
            sendToBackground({
                action: 'MCP_TEST_CONNECTION',
                serverId: server.id,
                transport: inferMcpTransport(server.transport, server.url),
                url: server.url || '',
                headers: normalizeMcpHeaders(server.headers),
            });
        });
    }
}
