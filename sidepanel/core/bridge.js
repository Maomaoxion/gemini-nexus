import {
    DEFAULT_CONTEXT_MODE,
    normalizeContextRecentTurns,
} from '../../shared/config/constants.js';
import { createConnectionStorageUpdate } from '../../shared/settings/connection.js';
import { getDedicatedApiStorageKeys } from '../../shared/settings/dedicated_providers.js';
import {
    mergeSessionSaveWithCurrent,
    normalizeDeletedSessionIds,
    normalizeSessionSavePayload,
} from './session_merge.js';
import { captureDisplayStill } from './screen_capture.js';
import { handleWindowMessageAction } from './window_actions.js';
import {
    forwardToBackground as forwardPayloadToBackground,
    isMessageForCurrentTab,
} from './background_forwarding.js';
import {
    importHistoryData as importHistoryDataPayload,
    importSettingsData as importSettingsDataPayload,
} from './data_import.js';
import {
    restoreConnectionSettings,
    restoreSidebarExpanded,
    saveSidePanelSessionBinding,
} from './bridge_storage.js';
import { getRuntimeLastError } from '../../shared/logging/runtime_error.js';

function getModelSaveKey(payload) {
    if (payload && typeof payload === 'object') {
        const dedicatedKeys = getDedicatedApiStorageKeys(payload.provider);
        if (dedicatedKeys) return dedicatedKeys.selectedModel;
        return payload.provider === 'openai' ? 'geminiOpenaiSelectedModel' : 'geminiModel';
    }

    return 'geminiModel';
}

function getModelSaveValue(payload) {
    if (payload && typeof payload === 'object') {
        return payload.model;
    }

    return payload;
}

// With the `unlimitedStorage` permission granted, the 10MB local-storage quota
// no longer applies to sessions, so the >95% guard below must not silently
// skip writes it would otherwise allow. `null` means "not resolved yet" and
// keeps the conservative (pre-permission) behavior.
let unlimitedStorageGranted = null;

export function setUnlimitedStorageGrantForTest(granted) {
    unlimitedStorageGranted = granted === true ? true : granted === false ? false : null;
}

function refreshUnlimitedStorageGrant() {
    try {
        if (typeof chrome?.permissions?.contains !== 'function') return;
        chrome.permissions.contains({ permissions: ['unlimitedStorage'] }, (granted) => {
            if (chrome.runtime?.lastError) return;
            unlimitedStorageGranted = granted === true;
        });
    } catch {
        // Permission API unavailable; keep the conservative default.
    }
}

export class MessageBridge {
    constructor(frameManager, stateManager) {
        this.frame = frameManager;
        this.state = stateManager;
    }

    init() {
        window.addEventListener('message', this.handleWindowMessage.bind(this));
        chrome.runtime.onMessage.addListener(this.handleRuntimeMessage.bind(this));
        refreshUnlimitedStorageGrant();
    }

    handleWindowMessage(event) {
        // Security check: Only accept messages from our direct sandbox iframe.
        if (!this.frame.isWindow(event.source)) return;
        // Additional origin hardening: sandbox iframes have opaque origin ("null"),
        // but a non-null, non-matching origin indicates a spoofed source.
        if (event.origin && event.origin !== 'null') {
            try {
                const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
                if (event.origin !== extensionOrigin) return;
            } catch {
                // Chrome API unavailable; rely on event.source check alone.
            }
        }

        const { action, payload } = event.data || {};
        if (!action) return;

        handleWindowMessageAction(action, payload, this);
    }

    openFullPage() {
        const url = chrome.runtime.getURL('sidepanel/index.html?standalone=1');
        chrome.tabs.create({ url });
    }

    openSettingsPage() {
        this.isRunningInTab()
            .then((isTab) => {
                if (isTab) {
                    this.frame.postMessage({ action: 'OPEN_SETTINGS_MODAL' });
                    return;
                }

                const url = chrome.runtime.getURL('settings/index.html');
                chrome.tabs.create({ url });
            })
            .catch(() => {
                const url = chrome.runtime.getURL('settings/index.html');
                chrome.tabs.create({ url });
            });
    }

    isRunningInTab() {
        return new Promise((resolve) => {
            if (!chrome.tabs || typeof chrome.tabs.getCurrent !== 'function') {
                this.state.setHostTabId?.(null);
                resolve(false);
                return;
            }

            chrome.tabs.getCurrent((tab) => {
                const tabId = Number.isInteger(tab?.id) && tab.id > 0 ? tab.id : null;
                this.state.setHostTabId?.(tabId);
                resolve(Boolean(tabId));
            });
        });
    }

    openExternalUrl(payload) {
        const url = payload?.url;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
            chrome.tabs.create({ url });
        }
    }

    requestScreenCapture() {
        captureDisplayStill()
            .then((payload) => {
                this.postBackgroundMessage(payload);
            })
            .catch((error) => {
                this.postBackgroundMessage({
                    action: 'SCREEN_CAPTURE_ERROR',
                    error: error?.message || 'Screen capture failed',
                });
            });
    }

    forwardToBackground(payload) {
        forwardPayloadToBackground(this, payload);
    }

    restoreConnectionSettings() {
        restoreConnectionSettings(this.frame);
    }

    restoreSidebarExpanded() {
        restoreSidebarExpanded(this.frame);
    }

    saveSidebarExpanded(payload) {
        this.state.save('geminiSidebarExpanded', payload !== false);
    }

    saveSelectedModel(payload) {
        const model = getModelSaveValue(payload);
        if (typeof model === 'string' && model.trim()) {
            this.state.save(getModelSaveKey(payload), model);
        }
    }

    saveSidePanelSessionBinding(payload) {
        saveSidePanelSessionBinding(payload);
    }

    saveContextSettings(payload) {
        const storageUpdate = {
            geminiContextMode: payload?.mode === 'recent' ? 'recent' : DEFAULT_CONTEXT_MODE,
            geminiContextRecentTurns: normalizeContextRecentTurns(payload?.recentTurns),
        };
        if (typeof this.state.saveMany === 'function') {
            this.state.saveMany(storageUpdate);
            return;
        }

        for (const [key, value] of Object.entries(storageUpdate)) {
            this.state.save(key, value);
        }
    }

    saveConnectionSettings(payload) {
        const storageUpdate = createConnectionStorageUpdate(payload);
        if (typeof this.state.saveMany === 'function') {
            this.state.saveMany(storageUpdate);
            return;
        }

        for (const [key, value] of Object.entries(storageUpdate)) {
            this.state.save(key, value);
        }
    }

    importHistoryData(payload) {
        importHistoryDataPayload(this.frame, payload);
    }

    importSettingsData(payload) {
        importSettingsDataPayload(this.frame, payload);
    }

    postBackgroundMessage(payload) {
        this.frame.postMessage({
            action: 'BACKGROUND_MESSAGE',
            payload,
        });
    }

    saveSessionsSafely(payload) {
        const { sessions, mutation } = normalizeSessionSavePayload(payload);
        if (!Array.isArray(sessions)) {
            this.state.save('geminiSessions', sessions);
            return;
        }

        const performWrite = () => this._performSessionWrite(sessions, mutation);

        if (typeof chrome?.storage?.local?.getBytesInUse !== 'function') {
            performWrite();
            return;
        }
        if (unlimitedStorageGranted === true) {
            performWrite();
            return;
        }

        chrome.storage.local.getBytesInUse((bytesUsed) => {
            const quota = chrome.storage.local.QUOTA_BYTES;
            if (!quota) {
                performWrite();
                return;
            }
            const ratio = bytesUsed / quota;
            if (ratio > 0.95) {
                console.warn(
                    `[Gemini Nexus] Storage nearly full (${bytesUsed}/${quota} bytes); skipping session save to avoid a quota error. Delete old sessions to free space.`
                );
                // The UI keeps its own copy, so a skipped save leaves storage
                // (and the AI-reply sync that depends on it) behind. Tell the
                // sandbox instead of failing silently.
                this.postBackgroundMessage({
                    action: 'HISTORY_SAVE_BLOCKED',
                    reason: 'quota',
                });
                return;
            }
            if (ratio > 0.8) {
                console.warn(
                    `[Gemini Nexus] Storage usage is high (${Math.round(ratio * 100)}%). Consider deleting old sessions.`
                );
            }
            performWrite();
        });
    }

    _performSessionWrite(sessions, mutation) {
        chrome.storage.local.get(['geminiSessions', 'geminiDeletedSessionIds'], (result) => {
            const readError = getRuntimeLastError();
            if (readError) {
                console.warn('Unable to save sessions after storage read failed:', readError);
                return;
            }

            const deletedSessionIds = normalizeDeletedSessionIds(result?.geminiDeletedSessionIds);
            if (mutation?.type === 'deleteSession' && mutation.sessionId) {
                deletedSessionIds[mutation.sessionId] = Date.now();
            }

            const merged = mergeSessionSaveWithCurrent(
                sessions,
                result?.geminiSessions,
                mutation,
                deletedSessionIds
            );
            if (
                mutation?.type === 'deleteSession' &&
                mutation.sessionId &&
                typeof this.state.saveMany === 'function'
            ) {
                this.state.saveMany({
                    geminiSessions: merged,
                    geminiDeletedSessionIds: deletedSessionIds,
                });
                return;
            }

            this.state.save('geminiSessions', merged);
        });
    }

    handleRuntimeMessage(message) {
        if (!isMessageForCurrentTab(this.state, message)) return;

        if (message.action === 'SESSIONS_UPDATED') {
            this.state.updateSessions(message.sessions);
            this.frame.postMessage({
                action: 'RESTORE_SESSIONS',
                payload: message.sessions,
            });
            return;
        }

        this.frame.postMessage({
            action: 'BACKGROUND_MESSAGE',
            payload: message,
        });
    }
}
