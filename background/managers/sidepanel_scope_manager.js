import { DEFAULT_SIDE_PANEL_SCOPE } from '../../shared/config/constants.js';

const DEFAULT_PANEL_PATH = 'sidepanel/index.html';

// Delays between side-panel open attempts. The first attempt runs immediately
// (inside the caller's user gesture); the rest wait for the tab's panel
// options to settle.
const OPEN_ATTEMPT_DELAYS_MS = [0, 120, 350];

export function getPanelPathForTab(tabId) {
    const normalizedTabId = Number(tabId);
    if (!Number.isInteger(normalizedTabId) || normalizedTabId <= 0) {
        return DEFAULT_PANEL_PATH;
    }

    return `${DEFAULT_PANEL_PATH}?tabId=${normalizedTabId}`;
}

export class SidePanelScopeManager {
    constructor() {
        this.scope = DEFAULT_SIDE_PANEL_SCOPE;
        this.enabledTabs = {};
        this.openTabs = {};
    }

    init() {
        (async () => {
            const [localState, sessionState] = await Promise.all([
                chrome.storage.local.get(['geminiSidePanelScope', 'geminiSidePanelEnabledTabs']),
                chrome.storage.session.get(['geminiSidePanelEnabledTabs']),
            ]);

            const normalizedScope = this.normalizeScope(localState.geminiSidePanelScope);
            this.scope = normalizedScope;
            this.enabledTabs = this.normalizeEnabledTabs(sessionState.geminiSidePanelEnabledTabs);

            if (localState.geminiSidePanelScope !== normalizedScope) {
                await chrome.storage.local.set({ geminiSidePanelScope: normalizedScope });
            }

            if (localState.geminiSidePanelEnabledTabs) {
                await chrome.storage.local.remove('geminiSidePanelEnabledTabs');
            }

            await this.refreshDefaultOptions();
            await this.refreshAllTabs();
        })().catch((error) => {
            console.warn('[SidePanelScopeManager] Failed to initialize scope state:', error);
        });

        chrome.storage.onChanged.addListener((changes, areaName) => {
            let needsRefresh = false;

            if (areaName === 'local' && changes.geminiSidePanelScope) {
                const normalizedScope = this.normalizeScope(changes.geminiSidePanelScope.newValue);
                if (changes.geminiSidePanelScope.newValue !== normalizedScope) {
                    chrome.storage.local
                        .set({ geminiSidePanelScope: normalizedScope })
                        .catch((error) => {
                            console.warn(
                                '[SidePanelScopeManager] Failed to migrate legacy scope:',
                                error
                            );
                        });
                }
                this.scope = normalizedScope;
                needsRefresh = true;
            }

            if (areaName === 'session' && changes.geminiSidePanelEnabledTabs) {
                this.enabledTabs = this.normalizeEnabledTabs(
                    changes.geminiSidePanelEnabledTabs.newValue
                );
                needsRefresh = true;
            }

            if (needsRefresh) {
                this.refreshDefaultOptions()
                    .then(() => this.refreshAllTabs())
                    .catch((error) =>
                        console.warn(
                            '[SidePanelScopeManager] Failed to refresh scope state:',
                            error
                        )
                    );
            }
        });

        chrome.tabs.onRemoved.addListener((tabId) => {
            this.markClosedForTab(tabId);

            if (this.enabledTabs[tabId]) {
                delete this.enabledTabs[tabId];
                this.persistEnabledTabs().catch((error) => {
                    console.warn(
                        '[SidePanelScopeManager] Failed to persist removed tab state:',
                        error
                    );
                });
            }
        });
    }

    normalizeScope(scope) {
        if (scope === 'global' || scope === DEFAULT_SIDE_PANEL_SCOPE) {
            return scope;
        }
        return DEFAULT_SIDE_PANEL_SCOPE;
    }

    normalizeEnabledTabs(value) {
        if (!value || typeof value !== 'object') return {};

        const normalized = {};
        for (const [key, enabled] of Object.entries(value)) {
            if (enabled !== true) continue;
            const tabId = Number(key);
            if (Number.isInteger(tabId) && tabId > 0) {
                normalized[tabId] = true;
            }
        }
        return normalized;
    }

    async persistEnabledTabs() {
        await chrome.storage.session.set({ geminiSidePanelEnabledTabs: this.enabledTabs });
    }

    async refreshAllTabs() {
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map((tab) => this.applyToTab(tab.id)));
    }

    async refreshDefaultOptions() {
        await chrome.sidePanel.setOptions({
            path: DEFAULT_PANEL_PATH,
            enabled: this.scope === 'global',
        });
    }

    isEnabledForTab(tabId) {
        if (!tabId) return false;
        if (this.scope === 'global') return true;
        return this.enabledTabs[tabId] === true;
    }

    isOpenForTab(tabId) {
        return this.openTabs[tabId] === true;
    }

    markOpenForTab(tabId) {
        if (!tabId) return;
        this.openTabs[tabId] = true;
    }

    markClosedForTab(tabId) {
        if (!tabId) return;
        delete this.openTabs[tabId];
    }

    async applyToTab(tabId) {
        if (!tabId) return;

        const enabled = this.isEnabledForTab(tabId);
        await chrome.sidePanel.setOptions({
            tabId,
            path: getPanelPathForTab(tabId),
            enabled,
        });
    }

    async openAfterSetup(openOptions, setupPromises) {
        // The first attempt races the panel options being applied: Chrome can
        // reject the open while the tab is not yet marked as enabled. Keep the
        // first attempt in the click's own task (so the user gesture is still
        // valid), then retry a couple of times after the options settle instead
        // of leaving the click silently dead.
        const setupSettled = Promise.all(
            setupPromises.map((promise) => Promise.resolve(promise).catch(() => {}))
        );
        let lastError = null;

        for (let attempt = 0; attempt < OPEN_ATTEMPT_DELAYS_MS.length; attempt++) {
            const delayMs = OPEN_ATTEMPT_DELAYS_MS[attempt];
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }

            try {
                await chrome.sidePanel.open(openOptions);
                return;
            } catch (error) {
                lastError = error;
                if (attempt === 0) {
                    console.warn(
                        '[SidePanelScopeManager] Retrying side panel open after options settled:',
                        error
                    );
                }
                await setupSettled;
            }
        }

        console.warn('[SidePanelScopeManager] Could not open side panel:', lastError);
        throw lastError;
    }

    async openForTab(tabId, windowId) {
        if (!tabId || !windowId) return;

        if (this.scope === DEFAULT_SIDE_PANEL_SCOPE) {
            const disableDefaultPromise = chrome.sidePanel
                .setOptions({
                    path: DEFAULT_PANEL_PATH,
                    enabled: false,
                })
                .catch(() => {});

            const enableTabPromise = chrome.sidePanel
                .setOptions({
                    tabId,
                    path: getPanelPathForTab(tabId),
                    enabled: true,
                })
                .catch((error) => {
                    console.warn(
                        '[SidePanelScopeManager] Failed to enable remembered side panel:',
                        error
                    );
                    throw error;
                });

            let persistPromise = Promise.resolve();
            if (!this.enabledTabs[tabId]) {
                this.enabledTabs[tabId] = true;
                persistPromise = this.persistEnabledTabs().catch((error) => {
                    console.warn(
                        '[SidePanelScopeManager] Failed to persist remembered tab state:',
                        error
                    );
                });
            }

            await this.openAfterSetup({ tabId, windowId }, [
                disableDefaultPromise,
                enableTabPromise,
                persistPromise,
            ]);
        } else {
            const defaultOptionsPromise = Promise.all([
                this.refreshDefaultOptions(),
                chrome.sidePanel.setOptions({
                    tabId,
                    path: getPanelPathForTab(tabId),
                    enabled: true,
                }),
            ]);
            await this.openAfterSetup({ tabId, windowId }, [defaultOptionsPromise]);
        }

        this.markOpenForTab(tabId);
    }

    async closeForTab(tabId) {
        if (!tabId) return;

        this.markClosedForTab(tabId);

        try {
            await chrome.sidePanel.setOptions({ tabId, enabled: false });
            setTimeout(() => {
                chrome.sidePanel
                    .setOptions({
                        tabId,
                        path: getPanelPathForTab(tabId),
                        enabled: this.isEnabledForTab(tabId),
                    })
                    .catch((error) => {
                        console.warn(
                            '[SidePanelScopeManager] Failed to restore side panel options:',
                            error
                        );
                    });
            }, 250);
        } catch (error) {
            console.error('Failed to close side panel:', error);
            throw error;
        }
    }

    async toggleForTab(tabId, windowId) {
        if (this.isOpenForTab(tabId)) {
            await this.closeForTab(tabId);
            return { status: 'closed' };
        }

        await this.openForTab(tabId, windowId);
        return { status: 'opened' };
    }
}
