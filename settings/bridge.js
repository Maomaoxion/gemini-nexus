import {
    DEFAULT_CONTEXT_MODE,
    DEFAULT_CONTEXT_RECENT_TURNS,
    DEFAULT_SIDE_PANEL_SCOPE,
    normalizeShortcutDefaults,
    normalizeContextRecentTurns,
} from '../shared/config/constants.js';
import { getRuntimeLastError } from '../shared/logging/runtime_error.js';
import {
    createConnectionSettingsPayload,
    createConnectionStorageUpdate,
} from '../shared/settings/connection.js';
import {
    CUSTOM_SELECTION_TOOLS_STORAGE_KEY,
    normalizeCustomSelectionTools,
} from '../shared/settings/selection_tools.js';
import {
    normalizeAccountIndicesSetting,
    normalizeBlacklistSetting,
    normalizeLanguageSetting,
    normalizeSidebarBehaviorSetting,
    normalizeSidePanelScopeSetting,
    normalizeThemeSetting,
    normalizeToggleEnabled,
} from '../shared/settings/save_normalize.js';
import {
    HISTORY_STORAGE_KEYS,
    SETTINGS_STORAGE_KEYS,
    buildDataExportFilename,
    buildHistoryExportPayload,
    buildHistoryImportStorageUpdate,
    buildSettingsExportPayload,
    buildSettingsImportStorageUpdate,
} from '../shared/data_management/index.js';
import { downloadText } from '../sidepanel/core/downloads.js';
import { buildSessionStorageReport } from '../sandbox/core/session_storage_report.js';

const SESSION_STORAGE_KEYS = ['geminiSessions', 'geminiDeletedSessionIds'];

function getLocalStorageData(keys) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get(keys, (result) => {
                const readError = getRuntimeLastError();
                if (readError) {
                    reject(readError);
                    return;
                }
                resolve(result || {});
            });
        } catch (error) {
            reject(error);
        }
    });
}

function setLocalStorageData(storageUpdate) {
    try {
        const writeResult = chrome.storage.local.set(storageUpdate);
        writeResult?.catch?.((error) => {
            console.warn('Unable to save standalone settings:', error);
        });
    } catch (error) {
        console.warn('Unable to save standalone settings:', error);
    }
}

function setLocalStorageDataAsync(storageUpdate) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const complete = () => {
            if (settled) return;
            settled = true;
            const writeError = getRuntimeLastError();
            if (writeError) {
                reject(writeError);
                return;
            }
            resolve();
        };

        try {
            const writeResult = chrome.storage.local.set(storageUpdate, complete);
            if (writeResult && typeof writeResult.then === 'function') {
                writeResult.then(complete).catch(reject);
            } else if (chrome.storage.local.set.length < 2) {
                queueMicrotask(complete);
            }
        } catch (error) {
            reject(error);
        }
    });
}

function normalizeContextSettings(payload) {
    return {
        mode: payload?.mode === 'recent' ? 'recent' : DEFAULT_CONTEXT_MODE,
        recentTurns: normalizeContextRecentTurns(payload?.recentTurns),
    };
}

export class StandaloneSettingsBridge {
    constructor(controller) {
        this.controller = controller;
        this.handleWindowMessage = this.handleWindowMessage.bind(this);
    }

    init() {
        window.addEventListener('message', this.handleWindowMessage);
        this.controller.setSessionStorageHooks({
            getSessionStorageReport: () => this.readSessionStorageReport(),
            deleteSessions: (sessionIds) => this.deleteSessions(sessionIds),
        });
    }

    /**
     * The standalone page reads the saved chats straight from extension storage.
     */
    async readSessionStorageReport() {
        try {
            const { geminiSessions } = await getLocalStorageData(['geminiSessions']);
            return buildSessionStorageReport(geminiSessions);
        } catch (error) {
            console.warn('Unable to read saved chats:', error);
            return null;
        }
    }

    async deleteSessions(sessionIds) {
        const ids = (Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean);
        if (ids.length === 0) return { deletedCount: 0, skippedGenerating: false };

        const storedHistory = await getLocalStorageData(SESSION_STORAGE_KEYS);
        const sessions = Array.isArray(storedHistory.geminiSessions)
            ? storedHistory.geminiSessions
            : [];
        const deletedIds = new Set(ids);
        const remaining = sessions.filter((session) => !session?.id || !deletedIds.has(session.id));

        const storedDeletedSessionIds = storedHistory.geminiDeletedSessionIds;
        const deletedSessionIds =
            storedDeletedSessionIds &&
            typeof storedDeletedSessionIds === 'object' &&
            !Array.isArray(storedDeletedSessionIds)
                ? { ...storedDeletedSessionIds }
                : {};
        for (const sessionId of deletedIds) {
            deletedSessionIds[sessionId] = Date.now();
        }

        await setLocalStorageDataAsync({
            geminiSessions: remaining,
            geminiDeletedSessionIds: deletedSessionIds,
        });

        return { deletedCount: sessions.length - remaining.length, skippedGenerating: false };
    }

    async restoreInitialState() {
        let localStorageData;
        try {
            localStorageData = await getLocalStorageData(SETTINGS_STORAGE_KEYS);
        } catch (error) {
            console.warn('Unable to restore settings from extension storage:', error);
            localStorageData = {};
        }
        const shortcuts = normalizeShortcutDefaults(localStorageData.geminiShortcuts);

        this.controller.updateShortcuts(shortcuts);
        this.controller.updateTheme(
            localStorageData.geminiTheme || localStorage.getItem('geminiTheme') || 'system'
        );
        this.controller.updateLanguage(
            localStorageData.geminiLanguage || localStorage.getItem('geminiLanguage') || 'system'
        );
        this.controller.updateTextSelection(localStorageData.geminiTextSelectionEnabled !== false);
        this.controller.updateTextSelectionBlacklist(
            localStorageData.geminiTextSelectionBlacklist || ''
        );
        this.controller.updateCustomSelectionTools(
            localStorageData[CUSTOM_SELECTION_TOOLS_STORAGE_KEY] || []
        );
        this.controller.updateImageTools(localStorageData.geminiImageToolsEnabled !== false);
        this.controller.updateImageToolsBlacklist(localStorageData.geminiImageToolsBlacklist || '');
        this.controller.updateGeneratedImageWatermarkRemoval(
            localStorageData.geminiGeneratedImageWatermarkRemovalEnabled !== false
        );
        this.controller.updateSidebarBehavior(localStorageData.geminiSidebarBehavior || 'auto');
        this.controller.updateSidePanelScope(
            localStorageData.geminiSidePanelScope || DEFAULT_SIDE_PANEL_SCOPE
        );
        this.controller.updateAccountIndices(localStorageData.geminiAccountIndices || '0');
        this.controller.updateContextSettings({
            mode: localStorageData.geminiContextMode || DEFAULT_CONTEXT_MODE,
            recentTurns: localStorageData.geminiContextRecentTurns || DEFAULT_CONTEXT_RECENT_TURNS,
        });
        this.controller.updateConnectionSettings(
            createConnectionSettingsPayload(localStorageData, { includeLegacyFallbacks: true })
        );

        if (chrome.runtime?.getManifest) {
            this.controller.updateAppVersion(`v${chrome.runtime.getManifest().version}`);
        }
        this.controller.refreshGithubMetadata();
    }

    handleWindowMessage(event) {
        // Only accept messages from our own window (e.g., from the import script).
        // For same-window postMessage, origin may be the window origin or "null",
        // so we rely on event.source identity.
        if (event.source !== window) return;
        if (event.origin && event.origin !== window.location.origin && event.origin !== 'null') {
            // If origin is present and doesn't match, reject. This is belt-and-suspenders:
            // same-window messages should have matching origin or opaque origin.
            return;
        }

        const { action, payload } = event.data || {};
        switch (action) {
            case 'FORWARD_TO_BACKGROUND':
                this.forwardToBackground(payload);
                return;
            case 'SAVE_SHORTCUTS':
                setLocalStorageData({ geminiShortcuts: normalizeShortcutDefaults(payload) });
                return;
            case 'SAVE_THEME': {
                const theme = normalizeThemeSetting(payload);
                localStorage.setItem('geminiTheme', theme);
                setLocalStorageData({ geminiTheme: theme });
                return;
            }
            case 'SAVE_LANGUAGE': {
                const language = normalizeLanguageSetting(payload);
                localStorage.setItem('geminiLanguage', language);
                setLocalStorageData({ geminiLanguage: language });
                return;
            }
            case 'SAVE_TEXT_SELECTION':
                setLocalStorageData({
                    geminiTextSelectionEnabled: normalizeToggleEnabled(payload),
                });
                return;
            case 'SAVE_TEXT_SELECTION_BLACKLIST':
                setLocalStorageData({
                    geminiTextSelectionBlacklist: normalizeBlacklistSetting(payload),
                });
                return;
            case 'SAVE_CUSTOM_SELECTION_TOOLS':
                setLocalStorageData({
                    [CUSTOM_SELECTION_TOOLS_STORAGE_KEY]: normalizeCustomSelectionTools(payload),
                });
                return;
            case 'SAVE_IMAGE_TOOLS':
                setLocalStorageData({ geminiImageToolsEnabled: normalizeToggleEnabled(payload) });
                return;
            case 'SAVE_IMAGE_TOOLS_BLACKLIST':
                setLocalStorageData({
                    geminiImageToolsBlacklist: normalizeBlacklistSetting(payload),
                });
                return;
            case 'SAVE_GENERATED_IMAGE_WATERMARK_REMOVAL':
                setLocalStorageData({
                    geminiGeneratedImageWatermarkRemovalEnabled: normalizeToggleEnabled(payload),
                });
                return;
            case 'SAVE_SIDEBAR_BEHAVIOR':
                setLocalStorageData({
                    geminiSidebarBehavior: normalizeSidebarBehaviorSetting(payload),
                });
                return;
            case 'SAVE_SIDE_PANEL_SCOPE':
                setLocalStorageData({
                    geminiSidePanelScope: normalizeSidePanelScopeSetting(payload),
                });
                return;
            case 'SAVE_ACCOUNT_INDICES':
                setLocalStorageData({
                    geminiAccountIndices: normalizeAccountIndicesSetting(payload),
                });
                return;
            case 'SAVE_CONTEXT_SETTINGS':
                {
                    const context = normalizeContextSettings(payload);
                    setLocalStorageData({
                        geminiContextMode: context.mode,
                        geminiContextRecentTurns: context.recentTurns,
                    });
                }
                return;
            case 'SAVE_CONNECTION_SETTINGS':
                setLocalStorageData(createConnectionStorageUpdate(payload));
                return;
            case 'EXPORT_HISTORY_DATA':
                this.exportHistoryData();
                return;
            case 'IMPORT_HISTORY_DATA':
                this.importHistoryData(payload);
                return;
            case 'EXPORT_SETTINGS_DATA':
                this.exportSettingsData();
                return;
            case 'IMPORT_SETTINGS_DATA':
                this.importSettingsData(payload);
                return;
            default:
                return;
        }
    }

    async exportHistoryData() {
        try {
            const storageData = await getLocalStorageData(HISTORY_STORAGE_KEYS);
            const payload = buildHistoryExportPayload(storageData);
            downloadText(
                JSON.stringify(payload, null, 2),
                buildDataExportFilename('history'),
                'application/json'
            );
        } catch (error) {
            console.warn('Unable to export history data:', error);
        }
    }

    async exportSettingsData() {
        try {
            const storageData = await getLocalStorageData(SETTINGS_STORAGE_KEYS);
            const payload = buildSettingsExportPayload(storageData);
            downloadText(
                JSON.stringify(payload, null, 2),
                buildDataExportFilename('settings'),
                'application/json'
            );
        } catch (error) {
            console.warn('Unable to export settings data:', error);
        }
    }

    async importHistoryData(payload) {
        try {
            const currentStorageData = await getLocalStorageData([
                'geminiSessions',
                'geminiGroups',
                'geminiDeletedSessionIds',
            ]);
            const storageUpdate = buildHistoryImportStorageUpdate(payload, currentStorageData);
            await setLocalStorageDataAsync(storageUpdate);
            window.postMessage(
                {
                    action: 'DATA_IMPORT_RESULT',
                    payload: { kind: 'history', ok: true },
                },
                '*'
            );
        } catch (error) {
            this.postImportError('history', error);
        }
    }

    async importSettingsData(payload) {
        try {
            const storageUpdate = buildSettingsImportStorageUpdate(payload);
            await setLocalStorageDataAsync(storageUpdate);
            await this.restoreInitialState();
            window.postMessage(
                {
                    action: 'DATA_IMPORT_RESULT',
                    payload: { kind: 'settings', ok: true },
                },
                '*'
            );
        } catch (error) {
            this.postImportError('settings', error);
        }
    }

    postImportError(kind, error) {
        window.postMessage(
            {
                action: 'DATA_IMPORT_RESULT',
                payload: {
                    kind,
                    ok: false,
                    error: error?.message || null,
                },
            },
            '*'
        );
    }

    async forwardToBackground(payload) {
        if (!payload || !chrome.runtime?.sendMessage) return;

        try {
            const response = await chrome.runtime.sendMessage(payload);
            this.handleBackgroundResponse(response);
        } catch (error) {
            console.warn('Error forwarding settings request:', error);
        }
    }

    handleBackgroundResponse(response) {
        if (!response || typeof response !== 'object') return;

        if (response.action === 'MCP_TEST_RESULT') {
            this.controller.updateMcpTestResult(response);
        } else if (response.action === 'MCP_TOOLS_RESULT') {
            this.controller.updateMcpToolsResult(response);
        } else if (response.action === 'PROVIDER_MODELS_RESULT') {
            this.controller.updateProviderModelsResult(response);
        } else if (response.logs) {
            this.controller.saveLogFile(response.logs);
        }
    }
}
