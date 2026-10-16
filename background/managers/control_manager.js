import { BrowserConnection } from '../control/connection.js';
import { SnapshotManager } from '../control/snapshot/index.js';
import { BrowserActions } from '../control/actions/index.js';
import { ToolDispatcher } from '../control/dispatcher.js';
import { getTabControlAvailability, getTabUrl, toControlTabSummary } from '../control/tabs.js';
import { cursorController } from '../control/cursor_controller.js';
import { debugLog } from '../../shared/logging/debug.js';
import {
    NEW_TAB_FOLLOW_TOOL_NAMES,
    captureNewTabWatchState,
    detectNewTabsFromWatch,
    formatNewTabFollowNote,
    formatPossibleNewTabHint,
    pickMostRecentTab,
    replaceInlinePageSnapshot,
} from '../control/new_tab_follow.js';
import { hasInlinePageSnapshot } from '../control/snapshot/marker.js';

export const DEFAULT_BROWSER_CONTROL_START_URL = 'https://www.google.com/search?q=';

/**
 * Main entry point for Chrome DevTools Protocol based browser control.
 * Orchestrates debugger connection, snapshots, and action execution.
 * The external MCP tool server lives in `mcp_remote_manager.js`.
 */
export class BrowserControlManager {
    constructor() {
        this.connection = new BrowserConnection();
        this.snapshotManager = new SnapshotManager(this.connection);
        this.actions = new BrowserActions(this.connection, this.snapshotManager, {
            getControlledGroupId: () => this.getControlledGroupId(),
            getControlledWindowId: () => this.getControlledWindowId(),
        });
        this.dispatcher = new ToolDispatcher(this.actions, this.snapshotManager, this.connection, {
            beforeAction: (name) => this._beforeToolAction(name),
            afterAction: (name, args, result, pre) =>
                this._afterToolAction(name, args, result, pre),
        });
        this.lockedTabId = null;
        this.ownerSidePanelTabId = null;
        this.controlGroupTabId = null;
        this.controlGroupId = null;
        this.controlWindowId = null;
        this.nativeGroupDisabledForTabId = null;
        this.controlTaskTitle = 'Browser control';
        this.lastControlError = '';
        this.executionQueue = Promise.resolve();

        // Restore persisted control state from storage.session (SW lifecycle persistence)
        this._restoreControlState();

        this.connection.onDetach(() => {
            // When the debugger detaches (user cancel, tab crash, navigation),
            // fully release the locked-tab state so the UI reflects reality.
            // Previously this only re-broadcast the stale lock, leaving
            // lockedTabId set while the debugger session was gone.
            if (this.lockedTabId !== null) {
                this.setTargetTab(null);
            } else {
                this._broadcastCurrentLockState();
            }
        });

        // A fresh attach == a new control session starting. Mirror BCB's
        // startSession -> publishTabState(cursor:null,visible:true): show the
        // thinking wobble until the first CURSOR_MOVE arrives with a target.
        this.connection.onAttach((tabId) => {
            cursorController.showThinking(tabId).catch(() => {});
        });

        // Listen for updates to the locked tab (URL/Favicon changes)
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (tabId === this.lockedTabId) {
                // If the update contains relevant info, broadcast it
                if (changeInfo.favIconUrl || changeInfo.title || changeInfo.url) {
                    this._broadcastLockState(tab);
                }
            }
        });

        // Listen for closure of the locked tab
        chrome.tabs.onRemoved.addListener((tabId) => {
            if (tabId === this.lockedTabId) {
                this.setTargetTab(null);
            }
        });
    }

    setTargetTab(tabId, options = {}) {
        const previousTabId = this.lockedTabId;
        this.lockedTabId = tabId;
        this.connection.targetTabId = Number.isInteger(tabId) && tabId > 0 ? tabId : null;
        if (previousTabId !== tabId) {
            this.snapshotManager.reset?.();
            this.connection.clearDialog?.();
        }
        debugLog(`[ControlManager] Target tab locked to: ${tabId}`);

        // Persist control state to storage.session so it survives SW termination
        this._persistControlState();

        if (tabId) {
            const requestedTabId = tabId;
            // Fetch tab info to broadcast state immediately
            chrome.tabs
                .get(tabId)
                .then((tab) => {
                    if (this.lockedTabId !== requestedTabId) return;
                    if (options.skipNativeGroup === true) {
                        this.nativeGroupDisabledForTabId = tab.id;
                    } else if (this.nativeGroupDisabledForTabId === tab.id) {
                        this.nativeGroupDisabledForTabId = null;
                    }
                    this._applyNativeTabGroup(tab, {
                        skipNativeGroup: options.skipNativeGroup === true,
                    });
                    this._broadcastLockState(tab);
                })
                .catch(() => {
                    if (this.lockedTabId !== requestedTabId) return;
                    // Tab might have closed or invalid ID
                    this.lockedTabId = null;
                    this.connection.targetTabId = null;
                    this._broadcastLockState(null);
                });
        } else {
            this._clearNativeTabGroup();
            this.controlWindowId = null;
            this.nativeGroupDisabledForTabId = null;
            this._broadcastLockState(null);
        }
    }

    setControlTaskTitle(title) {
        const normalized = String(title || '').trim();
        this.controlTaskTitle = normalized ? normalized.slice(0, 32) : 'Browser control';
        if (this.lockedTabId) {
            this._broadcastCurrentLockState();
        }
    }

    setOwnerSidePanelTabId(tabId) {
        this.ownerSidePanelTabId = Number.isInteger(tabId) && tabId > 0 ? tabId : null;
    }

    _broadcastLockState(tab) {
        const summary = toControlTabSummary(tab);
        const attached =
            summary && this.connection.attached && this.connection.currentTabId === summary.id;
        chrome.runtime
            .sendMessage({
                action: 'TAB_LOCKED',
                tabId: this.ownerSidePanelTabId,
                tab: summary,
                attached: attached === true,
            })
            .catch(() => {});
    }

    _broadcastCurrentLockState() {
        if (!this.lockedTabId) {
            this._broadcastLockState(null);
            return;
        }

        chrome.tabs
            .get(this.lockedTabId)
            .then((tab) => {
                if (this.lockedTabId !== tab.id) return;
                this._applyNativeTabGroup(tab, {
                    skipNativeGroup: this.nativeGroupDisabledForTabId === tab.id,
                });
                this._broadcastLockState(tab);
            })
            .catch(() => this._broadcastLockState(null));
    }

    _rememberControlledWindow(tab) {
        if (Number.isInteger(tab?.windowId) && tab.windowId > 0) {
            this.controlWindowId = tab.windowId;
        }
    }

    async _applyNativeTabGroup(tab, { skipNativeGroup = false } = {}) {
        const previousWindowId = this.getControlledWindowId();
        this._rememberControlledWindow(tab);

        if (skipNativeGroup) {
            await this._clearNativeTabGroup();
            return;
        }

        if (!tab?.id || !chrome.tabs?.group || !chrome.tabGroups?.update) {
            this.controlGroupId = null;
            this.controlGroupTabId = null;
            return;
        }

        this.controlGroupTabId = tab.id;
        try {
            let existingGroupId = this.getControlledGroupId();
            if (
                existingGroupId !== null &&
                Number.isInteger(previousWindowId) &&
                Number.isInteger(tab.windowId) &&
                previousWindowId !== tab.windowId
            ) {
                await this._clearNativeTabGroup();
                existingGroupId = null;
            }
            const groupRequest =
                existingGroupId === null
                    ? { tabIds: [tab.id] }
                    : { groupId: existingGroupId, tabIds: [tab.id] };
            const groupId = await chrome.tabs.group(groupRequest);
            await chrome.tabGroups.update(groupId, {
                title: this.controlTaskTitle,
                color: 'green',
                collapsed: false,
            });
            this.controlGroupId = groupId;
        } catch (error) {
            if (this.controlGroupTabId === tab.id) {
                this.controlGroupTabId = null;
                this.controlGroupId = null;
            }
            debugLog('[ControlManager] Could not apply tab group indicator:', error);
        }
    }

    async _clearNativeTabGroup(tabId = this.controlGroupTabId) {
        const groupId = this.getControlledGroupId();
        if ((!tabId && groupId === null) || !chrome.tabs?.ungroup) {
            this.controlGroupTabId = null;
            this.controlGroupId = null;
            return;
        }

        try {
            let tabIds = tabId ? [tabId] : [];
            if (groupId !== null && chrome.tabs?.query) {
                const query = { groupId };
                const windowId = this.getControlledWindowId();
                if (windowId !== null) query.windowId = windowId;
                const tabs = await chrome.tabs.query(query);
                tabIds = tabs.map((tab) => tab.id).filter((id) => Number.isInteger(id) && id > 0);
                if (tabIds.length === 0 && tabId) tabIds = [tabId];
            }
            if (tabIds.length > 0) {
                await chrome.tabs.ungroup(tabIds.length === 1 ? tabIds[0] : tabIds);
            }
        } catch (error) {
            debugLog('[ControlManager] Could not clear tab group indicator:', error);
        } finally {
            this.controlGroupTabId = null;
            this.controlGroupId = null;
        }
    }

    getControlledGroupId() {
        return Number.isInteger(this.controlGroupId) && this.controlGroupId >= 0
            ? this.controlGroupId
            : null;
    }

    getControlledWindowId() {
        return Number.isInteger(this.controlWindowId) && this.controlWindowId > 0
            ? this.controlWindowId
            : null;
    }

    async isTabInControlledGroup(tabId) {
        const groupId = this.getControlledGroupId();
        if (!Number.isInteger(tabId) || tabId <= 0) return false;

        try {
            if (groupId !== null) {
                const query = { groupId };
                const windowId = this.getControlledWindowId();
                if (windowId !== null) query.windowId = windowId;
                const tabs = await chrome.tabs.query(query);
                return tabs.some((tab) => tab.id === tabId);
            }

            const windowId = this.getControlledWindowId();
            if (windowId === null) return true;
            const tab = await chrome.tabs.get(tabId);
            return tab.windowId === windowId;
        } catch {
            return false;
        }
    }

    async isTabControllable(tabId) {
        if (!Number.isInteger(tabId) || tabId <= 0) return false;

        try {
            const tab = await chrome.tabs.get(tabId);
            return getTabControlAvailability(tab).controllable;
        } catch {
            return false;
        }
    }

    getTargetTabId() {
        return this.lockedTabId;
    }

    async _getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return tab || null;
    }

    async _createDefaultControlTab() {
        const activeTab = await this._getActiveTab().catch(() => null);
        const createOptions = {
            url: DEFAULT_BROWSER_CONTROL_START_URL,
            active: false,
        };
        if (Number.isInteger(activeTab?.windowId) && activeTab.windowId > 0) {
            createOptions.windowId = activeTab.windowId;
        }

        return await chrome.tabs.create(createOptions);
    }

    async _ensureControllableTarget({ createDefaultTab = false } = {}) {
        if (this.lockedTabId) {
            try {
                const lockedTab = await chrome.tabs.get(this.lockedTabId);
                if (getTabControlAvailability(lockedTab).controllable) {
                    this.connection.targetTabId = lockedTab.id;
                    this._rememberControlledWindow(lockedTab);
                    return lockedTab;
                }
            } catch (error) {
                console.warn('[ControlManager] Locked tab not found, clearing lock.', error);
            }

            this.lockedTabId = null;
            this.connection.targetTabId = null;
        }

        if (createDefaultTab && chrome.tabs?.create) {
            const defaultTab = await this._createDefaultControlTab();
            if (defaultTab?.id) {
                this.setTargetTab(defaultTab.id);
                this._rememberControlledWindow(defaultTab);
                return defaultTab;
            }
        }

        const activeTab = await this._getActiveTab().catch(() => null);
        if (activeTab?.id && getTabControlAvailability(activeTab).controllable) {
            this.setTargetTab(activeTab.id);
            this._rememberControlledWindow(activeTab);
            return activeTab;
        }

        return null;
    }

    async enableControl(options = {}) {
        // If already connected, do nothing (or verify tab)
        if (this.connection.attached && this.lockedTabId === this.connection.currentTabId) {
            return true;
        }

        await this._ensureControllableTarget({
            createDefaultTab: options.createDefaultTab === true,
        });

        // Force attachment which shows the "Started debugging" bar
        const enabled = await this.ensureConnection();
        this._broadcastCurrentLockState();
        return enabled;
    }

    async disableControl() {
        this.setTargetTab(null);
        this.ownerSidePanelTabId = null;
        // Detach debugger which hides the bar
        if (this.connection.attached) {
            await this.connection.detach();
        }
    }

    async ensureConnection() {
        const targetTab = await this._ensureControllableTarget();
        if (!targetTab?.id) {
            this.lastControlError = 'No controllable browser tab is selected.';
            return false;
        }
        const tabId = targetTab.id;

        // Perform quick check on URL before attaching
        let tabObj;
        try {
            tabObj = await chrome.tabs.get(tabId);
        } catch {
            this.lastControlError = `The selected tab (${tabId}) is no longer available.`;
            return false;
        }

        const availability = getTabControlAvailability(tabObj);
        if (!availability.controllable) {
            // Fail silently for restricted pages to avoid log noise
            const url = getTabUrl(tabObj) || 'unknown URL';
            this.lastControlError = `The selected page cannot be debugged by Chrome (${url}). Open or select a regular http(s) page first.`;
            return false;
        }

        const attached = await this.connection.attach(tabId);
        this.lastControlError =
            attached === true
                ? ''
                : this.connection.lastAttachErrorMessage ||
                  this.connection.lastDetachReason ||
                  'Chrome refused the debugger attachment.';
        this._broadcastCurrentLockState();
        return attached === true && this.connection.attached === true;
    }

    async ensureTargetReference() {
        const tab = await this._ensureControllableTarget();
        return Boolean(tab?.id);
    }

    async getSnapshot() {
        if (!this.connection.attached || this.connection.currentTabId !== this.lockedTabId) {
            const success = await this.ensureConnection();
            // Check connection.attached explicitly.
            if (!success || !this.connection.attached) return null;
        }
        return await this.snapshotManager.takeSnapshot();
    }

    async _beforeToolAction(name) {
        if (!NEW_TAB_FOLLOW_TOOL_NAMES.has(name)) return null;
        const openerTabId = this.lockedTabId || this.connection.currentTabId || null;
        return await captureNewTabWatchState({
            openerTabId,
            windowId: this.getControlledWindowId(),
        });
    }

    /**
     * Wait until a tab has a controllable URL (not about:blank / chrome://).
     * @param {number} tabId
     * @param {{ maxWaitMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void> }} [options]
     * @returns {Promise<chrome.tabs.Tab|null>}
     */
    async _waitForControllableTab(tabId, options = {}) {
        if (!Number.isInteger(tabId) || tabId <= 0) return null;
        const maxWaitMs = options.maxWaitMs ?? 3000;
        const pollMs = options.pollMs ?? 200;
        const sleep =
            typeof options.sleep === 'function'
                ? options.sleep
                : (ms) => new Promise((r) => setTimeout(r, ms));
        const deadline = Date.now() + maxWaitMs;

        while (Date.now() <= deadline) {
            try {
                const tab = await chrome.tabs.get(tabId);
                const url = getTabUrl(tab) || '';
                const availability = getTabControlAvailability(tab);
                // Prefer a real http(s) document; about:blank while loading is not ready.
                if (availability.controllable && url && !/^about:blank$/i.test(url)) {
                    return tab;
                }
            } catch {
                return null;
            }
            if (Date.now() + pollMs > deadline) break;
            await sleep(pollMs);
        }

        try {
            const tab = await chrome.tabs.get(tabId);
            if (getTabControlAvailability(tab).controllable) return tab;
        } catch {
            /* ignore */
        }
        return null;
    }

    /**
     * After auto-switch, run_steps (and any result that already embedded a
     * snapshot) still carries the *opener* page tree. Refresh it on the new tab.
     * @param {string} text
     * @param {string} toolName
     */
    async _refreshSnapshotAfterTabSwitch(text, toolName) {
        if (typeof text !== 'string') return text;
        // Atomic click/press with includeSnapshot: dispatcher appends snapshot
        // after afterAction — no embedded tree yet. Only rewrite when a tree
        // was already baked in (run_steps default) or the tool name is run_steps.
        const needsRefresh = toolName === 'run_steps' || hasInlinePageSnapshot(text);
        if (!needsRefresh) return text;
        try {
            const snapshot = await this.snapshotManager.takeSnapshot();
            if (typeof snapshot === 'string' && snapshot && !snapshot.startsWith('Error')) {
                return replaceInlinePageSnapshot(text, snapshot);
            }
        } catch (error) {
            debugLog('[ControlManager] Snapshot refresh after tab switch failed:', error);
        }
        return text;
    }

    /**
     * After click-like tools: if a new tab was opened from the controlled page,
     * claim it into the controlled group and switch control so the following
     * includeSnapshot (if any) reflects the real destination page.
     */
    async _afterToolAction(name, _args, result, pre) {
        if (!NEW_TAB_FOLLOW_TOOL_NAMES.has(name) || !pre) return result;

        // Already switching via tool meta (new_page / select_page inside run_steps).
        if (result && typeof result === 'object' && result._meta?.switchTabId) {
            return result;
        }

        const baseText =
            typeof result === 'string'
                ? result
                : result && typeof result === 'object' && typeof result.output === 'string'
                  ? result.output
                  : null;
        if (baseText == null || baseText.startsWith('Error')) return result;

        let follow;
        try {
            follow = await detectNewTabsFromWatch(pre);
        } catch (error) {
            debugLog('[ControlManager] new-tab detect failed:', error);
            return result;
        }

        const appendNote = (note, textOverride = null) => {
            if (typeof result === 'string') {
                return `${textOverride != null ? textOverride : result}${note}`;
            }
            if (result && typeof result === 'object' && 'output' in result) {
                const body = textOverride != null ? textOverride : result.output || '';
                return { ...result, output: `${body}${note}` };
            }
            return result;
        };

        // Trusted: opener-linked tab only — safe to auto-switch.
        if (follow.preferred?.id) {
            const tabId = follow.preferred.id;
            const previousTabId = this.lockedTabId;

            const readyTab = await this._waitForControllableTab(tabId);
            if (!readyTab) {
                debugLog(
                    `[ControlManager] New tab ${tabId} not controllable yet; skip auto-switch`
                );
                return appendNote(
                    formatNewTabFollowNote(follow.preferred, {
                        autoSwitched: false,
                        attachFailed: true,
                    })
                );
            }

            try {
                await this.actions.navigation.addTabToControlledGroup(tabId);
            } catch {
                // Grouping is best-effort.
            }

            // Allow tabs opened outside the group (common for target=_blank).
            this.setTargetTab(tabId);

            let attached = true;
            if (ToolDispatcher.requiresDebugger(name) || name === 'run_steps') {
                attached = await this.ensureConnection();
            }

            if (!attached) {
                debugLog(
                    `[ControlManager] Attach failed on new tab ${tabId}; rolling back to ${previousTabId}`
                );
                if (Number.isInteger(previousTabId) && previousTabId > 0) {
                    this.setTargetTab(previousTabId);
                    await this.ensureConnection().catch(() => false);
                } else {
                    this.setTargetTab(null);
                }
                return appendNote(
                    formatNewTabFollowNote(follow.preferred, {
                        autoSwitched: false,
                        attachFailed: true,
                    })
                );
            }

            const note = formatNewTabFollowNote(follow.preferred, { autoSwitched: true });
            debugLog(`[ControlManager] Auto-switched control to new tab ${tabId}`);

            // Refresh stale run_steps snapshot that was taken on the opener.
            let body = baseText;
            body = await this._refreshSnapshotAfterTabSwitch(body, name);
            return appendNote(note, body);
        }

        // Untrusted new tab(s): note only — do not steal control.
        if (Array.isArray(follow.newTabs) && follow.newTabs.length > 0) {
            const noted = pickMostRecentTab(follow.newTabs);
            if (noted) {
                return appendNote(formatNewTabFollowNote(noted, { autoSwitched: false }));
            }
        }

        // Click with no same-tab navigation and no detected new tab: SERP /
        // target=_blank links sometimes open too slowly for the poll window.
        // Remind the model once; skip for press_key / run_steps (too noisy).
        if (name === 'click' && !follow.openerNavigated && pre.openerUrl) {
            return appendNote(formatPossibleNewTabHint());
        }

        return result;
    }

    _runExclusive(task) {
        const previous = this.executionQueue.catch(() => {});
        let release;
        this.executionQueue = new Promise((resolve) => {
            release = resolve;
        });

        return previous.then(task).finally(() => {
            release();
        });
    }

    _notifyProgress(onProgress, text, phase = '') {
        if (typeof onProgress !== 'function') return;
        try {
            onProgress({
                text,
                phase,
            });
        } catch (error) {
            debugLog('[ControlManager] Tool progress callback failed:', error);
        }
    }

    _getConnectionErrorMessage() {
        return (
            this.lastControlError ||
            this.connection.lastAttachErrorMessage ||
            this.connection.lastDetachReason ||
            'No active tab found, restricted URL, or debugger disconnected.'
        );
    }

    async execute(toolCall, options = {}) {
        return await this._runExclusive(() => this._executeNow(toolCall, options));
    }

    async _executeNow(toolCall, options = {}) {
        try {
            const { name, args } = toolCall;
            const requiresDebugger = ToolDispatcher.requiresDebugger(name);
            const onProgress = options.onProgress;

            this._notifyProgress(
                onProgress,
                requiresDebugger
                    ? 'Preparing the controlled tab and debugger session...'
                    : 'Preparing the controlled tab scope...',
                'prepare'
            );

            const success = requiresDebugger
                ? await this.ensureConnection()
                : await this.ensureTargetReference();

            // Check attached status as well to be safe
            if (requiresDebugger && (!success || !this.connection.attached)) {
                return `Error: ${this._getConnectionErrorMessage()}`;
            }

            debugLog(`[BrowserControl] Running tool: ${name}`, args);

            this._notifyProgress(onProgress, `Running ${name}...`, 'execute');

            const result = await this.dispatcher.dispatch(name, args);

            let finalOutput = result;

            // Handle metadata objects returned by tools (e.g. NavigationActions)
            if (result && typeof result === 'object') {
                if (result._meta?.clearTarget) {
                    this._notifyProgress(
                        onProgress,
                        'Clearing the controlled tab target...',
                        'target'
                    );
                    this.setTargetTab(null);
                }

                if (result._meta && result._meta.switchTabId) {
                    const nextTabId = result._meta.switchTabId;
                    this._notifyProgress(
                        onProgress,
                        `Switching browser control to tab ${nextTabId}...`,
                        'target'
                    );
                    if (
                        !result._meta.allowOutsideControlledGroup &&
                        !(await this.isTabInControlledGroup(nextTabId))
                    ) {
                        return 'Error: Target tab is outside the controlled tab group.';
                    }
                    this.setTargetTab(nextTabId, {
                        skipNativeGroup: result._meta.allowOutsideControlledGroup === true,
                    });
                }

                // If it has an 'output' property (standardized wrapper), return that string.
                // Otherwise return the object as is (e.g. screenshot { text, image }).
                if ('output' in result) {
                    finalOutput = result.output;
                }
            }

            return finalOutput;
        } catch (error) {
            console.error(`[BrowserControl] Tool execution error:`, error);
            return `Error executing ${toolCall.name}: ${error.message}`;
        }
    }

    _persistControlState() {
        if (typeof chrome?.storage?.session?.set !== 'function') return;

        const state = {
            lockedTabId: this.lockedTabId,
            ownerSidePanelTabId: this.ownerSidePanelTabId,
            controlWindowId: this.controlWindowId,
            controlGroupId: this.controlGroupId,
            controlGroupTabId: this.controlGroupTabId,
        };

        chrome.storage.session.set({ geminiControlState: state }).catch((error) => {
            console.warn('[ControlManager] Failed to persist control state:', error.message);
        });
    }

    _restoreControlState() {
        if (typeof chrome?.storage?.session?.get !== 'function') return;

        chrome.storage.session.get(['geminiControlState'], (result) => {
            if (chrome.runtime.lastError) {
                console.warn(
                    '[ControlManager] Failed to restore control state:',
                    chrome.runtime.lastError.message
                );
                return;
            }

            const state = result?.geminiControlState;
            if (!state) return;

            // Restore in-memory state. NOTE: connection.attached and
            // connection.currentTabId are deliberately NOT restored — after an
            // SW restart the chrome.debugger session from the previous worker
            // may still exist at the Chrome level (the "Started debugging"
            // infobar persists), but the new worker has no handle to it. We
            // treat a restarted worker as "not attached"; the onDetach listener
            // (which also matches targetTabId) reconciles state when the user
            // cancels the leaked infobar or the tab closes.
            if (Number.isInteger(state.lockedTabId) && state.lockedTabId > 0) {
                this.lockedTabId = state.lockedTabId;
                this.connection.targetTabId = state.lockedTabId;
                // Previous SW may have been killed before detach completed,
                // leaving the tab on the "Started debugging" infobar with no
                // live handle. Best-effort detach so the next control action
                // starts clean (attach will re-attach if still needed).
                this._detachDebuggerBestEffort(state.lockedTabId);
            }
            if (Number.isInteger(state.ownerSidePanelTabId) && state.ownerSidePanelTabId > 0) {
                this.ownerSidePanelTabId = state.ownerSidePanelTabId;
            }
            if (Number.isInteger(state.controlWindowId) && state.controlWindowId > 0) {
                this.controlWindowId = state.controlWindowId;
            }
            if (Number.isInteger(state.controlGroupId) && state.controlGroupId >= 0) {
                this.controlGroupId = state.controlGroupId;
            }
            if (Number.isInteger(state.controlGroupTabId) && state.controlGroupTabId > 0) {
                this.controlGroupTabId = state.controlGroupTabId;
            }

            debugLog('[ControlManager] Restored control state from session storage:', state);
        });
    }

    _detachDebuggerBestEffort(tabId) {
        if (!Number.isInteger(tabId) || tabId <= 0) return;
        if (typeof chrome?.debugger?.detach !== 'function') return;
        try {
            // Fire the Chrome API immediately (callback form, not async await)
            // so the detach request is queued even if the SW is about to die.
            chrome.debugger.detach({ tabId }, () => {
                // Consume lastError — tab may already be closed or not attached.
                void chrome.runtime?.lastError;
            });
        } catch (error) {
            debugLog('[ControlManager] Best-effort detach failed:', error?.message || error);
        }
    }

    // Best-effort cleanup invoked from chrome.runtime.onSuspend before the SW
    // is terminated. Detaches the debugger so Chrome does not leave the tab in
    // a "Started debugging" state that the next SW instance cannot recover
    // from (its connection.attached is false after restart, so disableControl's
    // detach would no-op). Errors are swallowed — there is nothing to do if
    // the tab was already closed or the session already gone.
    suspendCleanup() {
        try {
            const tabId =
                this.connection?.currentTabId ||
                this.connection?.targetTabId ||
                this.lockedTabId ||
                null;
            if (!tabId) return;

            // Prefer the non-awaited Chrome callback path so detach starts
            // before MV3 kills the worker. The Promise-based connection.detach
            // is also fine for bookkeeping when we still believe we're attached.
            this._detachDebuggerBestEffort(tabId);

            if (this.connection) {
                this.connection.attached = false;
                this.connection.currentTabId = null;
            }
        } catch (error) {
            debugLog('[ControlManager] Suspend cleanup error:', error?.message || error);
        }
    }
}
