import {
    DEFAULT_MCP_TRANSPORT,
    DEFAULT_SIDE_PANEL_SCOPE,
    DEFAULT_THINKING_LEVEL,
} from '../../../shared/config/constants.js';
import { normalizeContextWindowTokens } from '../../../shared/models/context_window.js';
import { normalizeWebThinkingLevel } from '../../../shared/models/web_thinking.js';
import { normalizeDedicatedApiSettingsPayload } from '../../../shared/settings/dedicated_providers.js';
import { normalizeOpenAIWebSearchSettings } from '../../../shared/settings/openai.js';
import { normalizeCustomSelectionTools } from '../../../shared/settings/selection_tools.js';

export function normalizeAccountIndices(value) {
    const cleaned = String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => /^\d+$/.test(part))
        .join(',');
    return cleaned || '0';
}

export function buildGeneralSettingsForSave(formData) {
    return {
        shortcuts: formData.shortcuts,
        textSelectionEnabled: formData.textSelection,
        textSelectionBlacklist: formData.textSelectionBlacklist || '',
        customSelectionTools: normalizeCustomSelectionTools(formData.customSelectionTools),
        imageToolsEnabled: formData.imageTools,
        imageToolsBlacklist: formData.imageToolsBlacklist || '',
        generatedImageWatermarkRemovalEnabled: formData.generatedImageWatermarkRemoval !== false,
        accountIndices: normalizeAccountIndices(formData.accountIndices),
        sidebarBehavior: formData.sidebarBehavior || 'auto',
        sidePanelScope: formData.sidePanelScope || DEFAULT_SIDE_PANEL_SCOPE,
    };
}

export function buildContextSettingsForSave(formData) {
    const windowTokens = normalizeContextWindowTokens(formData.contextWindowTokens, 0);
    return {
        windowAuto: windowTokens <= 0,
        windowTokens,
    };
}

export function buildConnectionSettingsForSave(connection, previousConnectionData = {}) {
    const openaiSettings = normalizeOpenAIWebSearchSettings(connection);
    // Thinking levels are edited from the chat header, not this form. Keep the
    // live values so saving unrelated connection fields cannot reset them.
    const dedicatedApiProviders = normalizeDedicatedApiSettingsPayload(
        connection.dedicatedApiProviders || previousConnectionData.dedicatedApiProviders
    );
    for (const [provider, liveSettings] of Object.entries(
        previousConnectionData.dedicatedApiProviders || {}
    )) {
        if (dedicatedApiProviders[provider] && liveSettings?.thinkingLevel) {
            dedicatedApiProviders[provider].thinkingLevel = liveSettings.thinkingLevel;
        }
    }

    return {
        provider: connection.provider,
        webThinkingLevel: normalizeWebThinkingLevel(previousConnectionData.webThinkingLevel),
        webTemporaryChat: connection.webTemporaryChat === true,
        officialBaseUrl: connection.officialBaseUrl,
        apiKey: connection.apiKey,
        officialModel: connection.officialModel,
        thinkingLevel: previousConnectionData.thinkingLevel || connection.thinkingLevel,
        officialWebSearch: connection.officialWebSearch === true,
        openaiBaseUrl: connection.openaiBaseUrl,
        openaiApiKey: connection.openaiApiKey,
        openaiModel: connection.openaiModel,
        openaiSelectedModel: previousConnectionData.openaiSelectedModel || '',
        openaiThinkingLevel:
            previousConnectionData.openaiThinkingLevel ||
            connection.openaiThinkingLevel ||
            DEFAULT_THINKING_LEVEL,
        openaiUseResponsesApi: openaiSettings.useResponsesApi,
        openaiWebSearch: openaiSettings.webSearch,
        dedicatedApiProviders,
        mcpEnabled: connection.mcpEnabled === true,
        mcpTransport: connection.mcpTransport || DEFAULT_MCP_TRANSPORT,
        mcpServerUrl: connection.mcpServerUrl || '',
        mcpServers: Array.isArray(connection.mcpServers) ? connection.mcpServers : [],
        mcpActiveServerId: connection.mcpActiveServerId || null,
    };
}
