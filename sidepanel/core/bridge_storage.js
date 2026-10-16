import {
    CONNECTION_STORAGE_KEYS,
    createConnectionSettingsPayload,
} from '../../shared/settings/connection.js';
import { getRuntimeLastError } from '../../shared/logging/runtime_error.js';

function logSessionBindingWriteError(error) {
    console.warn('Unable to save side panel session binding after storage write failed:', error);
}

export function restoreConnectionSettings(frame) {
    chrome.storage.local.get(CONNECTION_STORAGE_KEYS, (result) => {
        const readError = getRuntimeLastError();
        if (readError) {
            console.warn(
                'Unable to restore connection settings after storage read failed:',
                readError
            );
            return;
        }

        frame.postMessage({
            action: 'RESTORE_CONNECTION_SETTINGS',
            payload: createConnectionSettingsPayload(result, { includeLegacyFallbacks: true }),
        });
    });
}

export function restoreSidebarExpanded(frame) {
    chrome.storage.local.get(['geminiSidebarExpanded'], (result) => {
        const readError = getRuntimeLastError();
        if (readError) {
            console.warn(
                'Unable to restore sidebar expanded state after storage read failed:',
                readError
            );
            return;
        }

        frame.postMessage({
            action: 'RESTORE_SIDEBAR_EXPANDED',
            payload: result.geminiSidebarExpanded !== false,
        });
    });
}

export function saveSidePanelSessionBinding(payload) {
    const tabId = payload?.tabId;
    const sessionId = payload?.sessionId || null;
    if (!Number.isInteger(tabId) || tabId <= 0) return;

    chrome.storage.session.get(['geminiSidePanelSessionBindings'], (result) => {
        const readError = getRuntimeLastError();
        if (readError) {
            console.warn(
                'Unable to save side panel session binding after storage read failed:',
                readError
            );
            return;
        }

        const bindings =
            result?.geminiSidePanelSessionBindings &&
            typeof result.geminiSidePanelSessionBindings === 'object' &&
            !Array.isArray(result.geminiSidePanelSessionBindings)
                ? { ...result.geminiSidePanelSessionBindings }
                : {};
        if (sessionId) {
            bindings[tabId] = sessionId;
        } else {
            delete bindings[tabId];
        }
        try {
            const writeResult = chrome.storage.session.set({
                geminiSidePanelSessionBindings: bindings,
            });
            writeResult?.catch?.(logSessionBindingWriteError);
        } catch (error) {
            logSessionBindingWriteError(error);
        }
    });
}
