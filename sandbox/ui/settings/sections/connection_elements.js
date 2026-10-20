import { DOM_IDS } from '../constants.js';
import { getSettingsElement } from '../dom.js';

export function queryConnectionElements(getElement = getSettingsElement) {
    return {
        providerSelect: getElement(DOM_IDS.PROVIDER_SELECT),
        apiKeyContainer: getElement(DOM_IDS.API_KEY_CONTAINER),
        webFields: getElement(DOM_IDS.WEB_FIELDS),
        webTemporaryChat: getElement(DOM_IDS.WEB_TEMPORARY_CHAT),

        officialFields: getElement(DOM_IDS.OFFICIAL_FIELDS),
        officialBaseUrl: getElement(DOM_IDS.OFFICIAL_BASE_URL),
        apiKeyInput: getElement(DOM_IDS.OFFICIAL_API_KEY),
        officialModel: getElement(DOM_IDS.OFFICIAL_MODEL),
        officialRefreshModels: getElement(DOM_IDS.OFFICIAL_REFRESH_MODELS),
        officialModelListStatus: getElement(DOM_IDS.OFFICIAL_MODEL_LIST_STATUS),
        officialModelPicker: getElement(DOM_IDS.OFFICIAL_MODEL_PICKER),        officialWebSearchEnabled: getElement(DOM_IDS.OFFICIAL_WEB_SEARCH),

        openaiFields: getElement(DOM_IDS.OPENAI_FIELDS),
        openaiBaseUrl: getElement(DOM_IDS.OPENAI_BASE_URL),
        openaiApiKey: getElement(DOM_IDS.OPENAI_API_KEY),
        openaiModel: getElement(DOM_IDS.OPENAI_MODEL),
        openaiRefreshModels: getElement(DOM_IDS.OPENAI_REFRESH_MODELS),
        openaiModelListStatus: getElement(DOM_IDS.OPENAI_MODEL_LIST_STATUS),
        openaiModelPicker: getElement(DOM_IDS.OPENAI_MODEL_PICKER),
        openaiUseResponsesApi: getElement(DOM_IDS.OPENAI_USE_RESPONSES_API),
        openaiWebSearch: getElement(DOM_IDS.OPENAI_WEB_SEARCH),

        dedicatedApiFields: getElement(DOM_IDS.DEDICATED_API_FIELDS),
        dedicatedApiBaseUrl: getElement(DOM_IDS.DEDICATED_API_BASE_URL),
        dedicatedApiKey: getElement(DOM_IDS.DEDICATED_API_API_KEY),
        dedicatedApiModel: getElement(DOM_IDS.DEDICATED_API_MODEL),
        dedicatedApiRefreshModels: getElement(DOM_IDS.DEDICATED_API_REFRESH_MODELS),
        dedicatedApiModelListStatus: getElement(DOM_IDS.DEDICATED_API_MODEL_LIST_STATUS),
        dedicatedApiModelPicker: getElement(DOM_IDS.DEDICATED_API_MODEL_PICKER),
        dedicatedApiWebSearchRow: getElement(DOM_IDS.DEDICATED_API_WEB_SEARCH_ROW),
        dedicatedApiWebSearch: getElement(DOM_IDS.DEDICATED_API_WEB_SEARCH),
        dedicatedApiProviderRoutingRow: getElement(DOM_IDS.DEDICATED_API_PROVIDER_ROUTING_ROW),
        dedicatedApiProviderRouting: getElement(DOM_IDS.DEDICATED_API_PROVIDER_ROUTING),

        contextWindowTokens: getElement(DOM_IDS.CONTEXT_WINDOW_TOKENS),
        contextWindowStatus: getElement(DOM_IDS.CONTEXT_WINDOW_STATUS),

        mcpEnabled: getElement(DOM_IDS.MCP_ENABLED),
        mcpFields: getElement(DOM_IDS.MCP_FIELDS),
        mcpServerSelect: getElement(DOM_IDS.MCP_SERVER_SELECT),
        mcpAddServer: getElement(DOM_IDS.MCP_ADD_SERVER),
        mcpRemoveServer: getElement(DOM_IDS.MCP_REMOVE_SERVER),
        mcpServerName: getElement(DOM_IDS.MCP_SERVER_NAME),
        mcpTransport: getElement(DOM_IDS.MCP_TRANSPORT),
        mcpServerUrl: getElement(DOM_IDS.MCP_SERVER_URL),
        mcpHeaders: getElement(DOM_IDS.MCP_HEADERS),
        mcpServerEnabled: getElement(DOM_IDS.MCP_SERVER_ENABLED),
        mcpTestConnection: getElement(DOM_IDS.MCP_TEST_CONNECTION),
        mcpTestStatus: getElement(DOM_IDS.MCP_TEST_STATUS),
        mcpToolMode: getElement(DOM_IDS.MCP_TOOL_MODE),
        mcpRefreshTools: getElement(DOM_IDS.MCP_REFRESH_TOOLS),
        mcpEnableAllTools: getElement(DOM_IDS.MCP_ENABLE_ALL_TOOLS),
        mcpDisableAllTools: getElement(DOM_IDS.MCP_DISABLE_ALL_TOOLS),
        mcpToolSearch: getElement(DOM_IDS.MCP_TOOL_SEARCH),
        mcpToolsSummary: getElement(DOM_IDS.MCP_TOOLS_SUMMARY),
        mcpToolList: getElement(DOM_IDS.MCP_TOOL_LIST),
    };
}
