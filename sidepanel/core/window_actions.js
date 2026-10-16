import { downloadFile, downloadText } from './downloads.js';
import { getRuntimeLastError } from '../../shared/logging/runtime_error.js';
import {
    HISTORY_STORAGE_KEYS,
    SETTINGS_STORAGE_KEYS,
    buildDataExportFilename,
    buildHistoryExportPayload,
    buildSettingsExportPayload,
} from '../../shared/data_management/index.js';
import {
    CUSTOM_SELECTION_TOOLS_STORAGE_KEY,
    normalizeCustomSelectionTools,
} from '../../shared/settings/selection_tools.js';
import { normalizeShortcutDefaults } from '../../shared/config/constants.js';
import {
    normalizeAccountIndicesSetting,
    normalizeBlacklistSetting,
    normalizeLanguageSetting,
    normalizeSidebarBehaviorSetting,
    normalizeSidePanelScopeSetting,
    normalizeThemeSetting,
    normalizeToggleEnabled,
} from '../../shared/settings/save_normalize.js';
import { normalizeWebThinkingLevel } from '../../shared/models/web_thinking.js';
import { publishHostContext } from './host_context.js';
import {
    restoreAccountIndices,
    restoreContextSettings,
    restoreCustomSelectionTools,
    restoreGeneratedImageWatermarkRemoval,
    restoreImageTools,
    restoreImageToolsBlacklist,
    restoreTextSelection,
    restoreTextSelectionBlacklist,
} from './preferences.js';

const WINDOW_MESSAGE_HANDLERS = {
    UI_READY(payload, bridge) {
        bridge.state.markUiReady();
        publishHostContext(bridge.frame, () => bridge.isRunningInTab());
    },
    OPEN_FULL_PAGE(payload, bridge) {
        bridge.openFullPage();
    },
    OPEN_SETTINGS_PAGE(payload, bridge) {
        bridge.openSettingsPage();
    },
    OPEN_EXTERNAL_URL(payload, bridge) {
        bridge.openExternalUrl(payload);
    },
    REQUEST_SCREEN_CAPTURE(payload, bridge) {
        bridge.requestScreenCapture();
    },
    FORWARD_TO_BACKGROUND(payload, bridge) {
        bridge.forwardToBackground(payload);
    },
    DOWNLOAD_IMAGE(payload) {
        downloadFile(payload.url, payload.filename);
    },
    DOWNLOAD_LOGS(payload) {
        downloadText(payload.text, payload.filename || 'gemini-nexus-logs.txt');
    },
    DOWNLOAD_TEXT(payload) {
        downloadText(
            payload?.text || '',
            payload?.filename || 'download.txt',
            payload?.contentType
        );
    },
    EXPORT_HISTORY_DATA(payload, bridge) {
        exportStorageData(bridge, HISTORY_STORAGE_KEYS, 'history', buildHistoryExportPayload);
    },
    IMPORT_HISTORY_DATA(payload, bridge) {
        bridge.importHistoryData(payload);
    },
    EXPORT_SETTINGS_DATA(payload, bridge) {
        exportStorageData(bridge, SETTINGS_STORAGE_KEYS, 'settings', buildSettingsExportPayload);
    },
    IMPORT_SETTINGS_DATA(payload, bridge) {
        bridge.importSettingsData(payload);
    },
    GET_TEXT_SELECTION(payload, bridge) {
        restoreTextSelection(bridge.frame);
    },
    GET_TEXT_SELECTION_BLACKLIST(payload, bridge) {
        restoreTextSelectionBlacklist(bridge.frame);
    },
    GET_CUSTOM_SELECTION_TOOLS(payload, bridge) {
        restoreCustomSelectionTools(bridge.frame);
    },
    GET_IMAGE_TOOLS(payload, bridge) {
        restoreImageTools(bridge.frame);
    },
    GET_IMAGE_TOOLS_BLACKLIST(payload, bridge) {
        restoreImageToolsBlacklist(bridge.frame);
    },
    GET_GENERATED_IMAGE_WATERMARK_REMOVAL(payload, bridge) {
        restoreGeneratedImageWatermarkRemoval(bridge.frame);
    },
    GET_ACCOUNT_INDICES(payload, bridge) {
        restoreAccountIndices(bridge.frame);
    },
    GET_CONTEXT_SETTINGS(payload, bridge) {
        restoreContextSettings(bridge.frame);
    },
    GET_CONNECTION_SETTINGS(payload, bridge) {
        bridge.restoreConnectionSettings();
    },
    GET_SIDEBAR_EXPANDED(payload, bridge) {
        bridge.restoreSidebarExpanded();
    },
    SAVE_SESSIONS(payload, bridge) {
        bridge.saveSessionsSafely(payload);
    },
    SAVE_GROUPS(payload, bridge) {
        bridge.state.save('geminiGroups', Array.isArray(payload) ? payload : []);
    },
    SAVE_SHORTCUTS(payload, bridge) {
        bridge.state.save('geminiShortcuts', normalizeShortcutDefaults(payload));
    },
    SAVE_MODEL(payload, bridge) {
        bridge.saveSelectedModel(payload);
    },
    SAVE_WEB_THINKING_LEVEL(payload, bridge) {
        bridge.state.save('geminiWebThinkingLevel', normalizeWebThinkingLevel(payload));
    },
    SAVE_THEME(payload, bridge) {
        bridge.state.save('geminiTheme', normalizeThemeSetting(payload));
    },
    SAVE_LANGUAGE(payload, bridge) {
        bridge.state.save('geminiLanguage', normalizeLanguageSetting(payload));
    },
    SAVE_TEXT_SELECTION(payload, bridge) {
        bridge.state.save('geminiTextSelectionEnabled', normalizeToggleEnabled(payload));
    },
    SAVE_TEXT_SELECTION_BLACKLIST(payload, bridge) {
        bridge.state.save('geminiTextSelectionBlacklist', normalizeBlacklistSetting(payload));
    },
    SAVE_CUSTOM_SELECTION_TOOLS(payload, bridge) {
        bridge.state.save(
            CUSTOM_SELECTION_TOOLS_STORAGE_KEY,
            normalizeCustomSelectionTools(payload)
        );
    },
    SAVE_IMAGE_TOOLS(payload, bridge) {
        bridge.state.save('geminiImageToolsEnabled', normalizeToggleEnabled(payload));
    },
    SAVE_IMAGE_TOOLS_BLACKLIST(payload, bridge) {
        bridge.state.save('geminiImageToolsBlacklist', normalizeBlacklistSetting(payload));
    },
    SAVE_GENERATED_IMAGE_WATERMARK_REMOVAL(payload, bridge) {
        bridge.state.save(
            'geminiGeneratedImageWatermarkRemovalEnabled',
            normalizeToggleEnabled(payload)
        );
    },
    SAVE_SIDEBAR_BEHAVIOR(payload, bridge) {
        bridge.state.save('geminiSidebarBehavior', normalizeSidebarBehaviorSetting(payload));
    },
    SAVE_SIDEBAR_EXPANDED(payload, bridge) {
        bridge.saveSidebarExpanded(payload);
    },
    SAVE_SIDE_PANEL_SCOPE(payload, bridge) {
        bridge.state.save('geminiSidePanelScope', normalizeSidePanelScopeSetting(payload));
    },
    SAVE_SIDE_PANEL_SESSION_BINDING(payload, bridge) {
        bridge.saveSidePanelSessionBinding(payload);
    },
    SAVE_ACCOUNT_INDICES(payload, bridge) {
        bridge.state.save('geminiAccountIndices', normalizeAccountIndicesSetting(payload));
    },
    SAVE_CONTEXT_SETTINGS(payload, bridge) {
        bridge.saveContextSettings(payload);
    },
    SAVE_CONNECTION_SETTINGS(payload, bridge) {
        bridge.saveConnectionSettings(payload);
    },
};

function getExportRequestAction(kind) {
    return kind === 'history' ? 'EXPORT_HISTORY_DATA' : 'EXPORT_SETTINGS_DATA';
}

function exportStorageData(bridge, storageKeys, kind, buildPayload) {
    chrome.storage.local.get(storageKeys, (result) => {
        const readError = getRuntimeLastError();
        if (readError) {
            console.warn(`[Gemini Nexus] Failed to export ${kind} data:`, readError);
            // The read happens here, but the user clicked in the sandbox panel:
            // report the failure where the export button is.
            bridge?.postBackgroundMessage?.({
                action: 'BACKGROUND_REQUEST_ERROR',
                requestAction: getExportRequestAction(kind),
                error: readError.message || String(readError),
            });
            return;
        }

        const exportPayload = buildPayload(result || {});
        downloadText(
            JSON.stringify(exportPayload, null, 2),
            buildDataExportFilename(kind),
            'application/json'
        );
    });
}

export function handleWindowMessageAction(action, payload, bridge) {
    const handler = WINDOW_MESSAGE_HANDLERS[action];
    if (handler) handler(payload, bridge);
}
