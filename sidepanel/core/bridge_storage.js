import {
    CONNECTION_STORAGE_KEYS,
    createConnectionSettingsPayload,
} from '../../shared/settings/connection.js';
import { getRuntimeLastError } from '../../shared/logging/runtime_error.js';
import { getThinkingLevelStorageKey } from '../../shared/models/thinking_levels.js';
import {
    getComposerDraftKey,
    isEmptyComposerDraft,
    normalizeComposerDraft,
    normalizeComposerDraftMap,
} from '../../shared/text/composer_draft.js';

const INPUT_DRAFTS_KEY = 'geminiSidePanelInputDrafts';

function logSessionBindingWriteError(error) {
    console.warn('Unable to save side panel session binding after storage write failed:', error);
}

function logInputDraftWriteError(error) {
    console.warn('Unable to save side panel input draft after storage write failed:', error);
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

export function saveThinkingLevel(state, payload) {
    const provider = payload?.provider;
    const level = typeof payload?.level === 'string' ? payload.level.trim() : '';
    const storageKey = getThinkingLevelStorageKey(provider);
    if (!storageKey || !level) return;

    if (typeof state?.save === 'function') {
        state.save(storageKey, level);
        return;
    }
    chrome.storage.local.set({ [storageKey]: level });
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

export function restoreSidePanelInputDrafts(frame) {
    chrome.storage.session.get([INPUT_DRAFTS_KEY], (result) => {
        const readError = getRuntimeLastError();
        if (readError) {
            console.warn(
                'Unable to restore side panel input drafts after storage read failed:',
                readError
            );
            return;
        }

        frame.postMessage({
            action: 'RESTORE_INPUT_DRAFTS',
            payload: normalizeComposerDraftMap(result?.[INPUT_DRAFTS_KEY]),
        });
    });
}

export function saveSidePanelInputDraft(payload) {
    const tabId = payload?.tabId;
    const key = getComposerDraftKey(tabId);

    chrome.storage.session.get([INPUT_DRAFTS_KEY], (result) => {
        const readError = getRuntimeLastError();
        if (readError) {
            console.warn(
                'Unable to save side panel input draft after storage read failed:',
                readError
            );
            return;
        }

        const drafts = normalizeComposerDraftMap(result?.[INPUT_DRAFTS_KEY]);
        const draft = normalizeComposerDraft(payload?.value);
        if (isEmptyComposerDraft(draft)) {
            delete drafts[key];
        } else {
            drafts[key] = draft;
        }

        try {
            const writeResult = chrome.storage.session.set({ [INPUT_DRAFTS_KEY]: drafts });
            writeResult?.catch?.(logInputDraftWriteError);
        } catch (error) {
            logInputDraftWriteError(error);
        }
    });
}
