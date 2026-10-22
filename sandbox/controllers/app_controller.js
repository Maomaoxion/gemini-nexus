import { MessageHandler } from './message_handler.js';
import { SessionFlowController } from './session_flow.js';
import { PromptController } from './prompt.js';
import { t } from '../core/i18n.js';
import { saveSessionsToStorage, sendToBackground } from '../../shared/messaging/index.js';
import {
    DEFAULT_PROVIDER,
    DEFAULT_SIDE_PANEL_SCOPE,
    DEFAULT_STORED_GEMINI_MODEL,
} from '../../shared/config/constants.js';
import { isDedicatedApiProvider } from '../../shared/settings/dedicated_providers.js';
import { formatLiveArtifactFollowupPrompt } from '../core/live_artifacts.js';
import { buildSessionStorageReport } from '../core/session_storage_report.js';
import {
    getComposerDraftKey,
    isEmptyComposerDraft,
    normalizeComposerDraft,
    normalizeComposerDraftMap,
} from '../../shared/text/composer_draft.js';

export class AppController {
    constructor(sessionManager, uiController, imageManager) {
        this.sessionManager = sessionManager;
        this.ui = uiController;
        this.imageManager = imageManager;

        this.captureMode = 'snip';
        this.isGenerating = false;
        this.generatingSessionId = null;
        // Session id carried by an outstanding service-worker run probe.
        this._workerProbeSessionId = undefined;
        this.browserControlActive = false;
        this.debugToolsActive = false;
        this.liveArtifactsEnabled = false;
        this.sidePanelScope = DEFAULT_SIDE_PANEL_SCOPE;
        this.currentTabId = null;
        this.currentTabUrl = '';
        this.currentTabTitle = '';
        this.boundSessionId = null;
        this.hostIsTab = false;
        this.sessionsRestored = false;
        // Unsent composer text/attachments, keyed by tab. The composer belongs to
        // the tab, so switching tabs must not lose it.
        this.inputDrafts = new Map();
        this.inputDraftSaveTimer = null;

        // Sidebar Restore Behavior: 'auto', 'restore', 'new'
        this.sidebarRestoreBehavior = 'auto';

        this.messageHandler = new MessageHandler(sessionManager, uiController, imageManager, this);

        this.sessionFlow = new SessionFlowController(sessionManager, uiController, this);
        this.prompt = new PromptController(sessionManager, uiController, imageManager, this);

        document.addEventListener('gemini-provider-changed', () => {
            if (!this.isGenerating) this.rerender();
        });

        if (this.ui.setBrowserControlCallbacks) {
            this.ui.setBrowserControlCallbacks({
                onChoose: () => this.handleTabSwitcher(),
                onStop: () => this.toggleBrowserControl(false),
            });
        }

        if (this.ui.setTabMentionCallbacks) {
            this.ui.setTabMentionCallbacks({
                onRequestTabs: () => this.handleRequestMentionTabs(),
                onChange: () => this.scheduleInputDraftSave(),
            });
        }

        if (this.ui.setSessionStorageHooks) {
            this.ui.setSessionStorageHooks({
                getSessionStorageReport: () =>
                    buildSessionStorageReport(sessionManager.getPersistableSessions()),
                deleteSessions: (sessionIds) => this.sessionFlow.handleDeleteSessions(sessionIds),
            });
        }

        if (this.ui.setContextWindowHooks) {
            this.ui.setContextWindowHooks({
                getContextWindow: (payload) =>
                    sendToBackground({ action: 'GET_CONTEXT_WINDOW', ...payload }),
            });
        }

        if (this.ui?.chat?.inputFn?.addEventListener) {
            this.ui.chat.inputFn.addEventListener('input', () => this.scheduleInputDraftSave());
        }
    }

    // ── Composer drafts ────────────────────────────────────────────────────────
    // One draft per tab: typing in tab A, switching to tab B, then coming back
    // must restore A's text and attachments. The host persists the same map in
    // chrome.storage.session so a panel reload survives too.

    getInputDraftKey(tabId = this.currentTabId) {
        return getComposerDraftKey(tabId);
    }

    readComposerSnapshot() {
        return {
            text: this.ui?.chat?.getInputValue?.() || '',
            files: this.imageManager?.getFiles?.() || [],
            tabs: this.getReferencedTabs(),
        };
    }

    hasComposerContent() {
        return !isEmptyComposerDraft(this.readComposerSnapshot());
    }

    applyComposerSnapshot(value, options = {}) {
        const draft = normalizeComposerDraft(value);
        // A late hydration must not overwrite what the user already typed;
        // an explicit tab switch always replaces the composer.
        if (!options.force && this.hasComposerContent()) return;

        this.ui?.chat?.setInputValue?.(draft.text);
        this.imageManager?.setFiles?.(draft.files);
        this.ui?.setReferencedTabs?.(draft.tabs, { silent: true });
    }

    postInputDraftToHost(tabId, value) {
        window.parent.postMessage(
            {
                action: 'SAVE_SIDE_PANEL_INPUT_DRAFT',
                payload: { tabId, value },
            },
            '*'
        );
    }

    saveInputDraftForTab(tabId = this.currentTabId) {
        const key = this.getInputDraftKey(tabId);
        const draft = normalizeComposerDraft(this.readComposerSnapshot());
        if (isEmptyComposerDraft(draft)) {
            this.inputDrafts.delete(key);
        } else {
            this.inputDrafts.set(key, draft);
        }
        this.postInputDraftToHost(tabId, draft);
    }

    restoreInputDraftForTab(tabId = this.currentTabId, options = {}) {
        const key = this.getInputDraftKey(tabId);
        this.applyComposerSnapshot(this.inputDrafts.get(key) || null, options);
    }

    hydrateInputDrafts(rawDrafts) {
        const drafts = normalizeComposerDraftMap(rawDrafts);
        this.inputDrafts.clear();
        Object.entries(drafts).forEach(([key, draft]) => this.inputDrafts.set(key, draft));
    }

    scheduleInputDraftSave() {
        if (this.inputDraftSaveTimer) clearTimeout(this.inputDraftSaveTimer);
        this.inputDraftSaveTimer = setTimeout(() => {
            this.inputDraftSaveTimer = null;
            this.saveInputDraftForTab();
        }, 300);
    }

    onComposerChanged() {
        this.scheduleInputDraftSave();
    }

    clearComposerDraftAfterSend() {
        if (this.inputDraftSaveTimer) {
            clearTimeout(this.inputDraftSaveTimer);
            this.inputDraftSaveTimer = null;
        }
        const key = this.getInputDraftKey();
        const tabs = this.getReferencedTabs();
        if (tabs.length === 0) {
            this.inputDrafts.delete(key);
            this.postInputDraftToHost(this.currentTabId, null);
            return;
        }

        // Referenced tabs survive a send: keep them in the draft so a tab
        // switch or panel reload still has the same context selected.
        const draft = { text: '', files: [], tabs };
        this.inputDrafts.set(key, draft);
        this.postInputDraftToHost(this.currentTabId, draft);
    }

    getReferencedTabs() {
        return this.ui?.tabMention?.getReferences?.() || [];
    }

    setCaptureMode(mode) {
        this.captureMode = mode;
    }

    handleRequestMentionTabs() {
        sendToBackground({ action: 'GET_MENTION_TABS' });
    }

    toggleLiveArtifacts(forceState = null) {
        const nextState = forceState === null ? !this.liveArtifactsEnabled : forceState === true;
        this.liveArtifactsEnabled = nextState;
        this.ui.chat.toggleLiveArtifacts?.(this.liveArtifactsEnabled);
    }

    getUiLanguage() {
        const lang = document.documentElement.lang || '';
        return lang.toLowerCase().startsWith('en') ? 'en' : 'zh';
    }

    async handleLiveArtifactFollowUp(payload) {
        const prompt = formatLiveArtifactFollowupPrompt(payload, this.getUiLanguage());
        if (!prompt) return false;

        await this.prompt.sendText(prompt);
        return true;
    }

    setBrowserControlActiveState(active) {
        this.browserControlActive = active === true;

        if (this.browserControlActive && this.debugToolsActive) {
            this.toggleDebugTools(false);
        }

        const browserControlButton = document.getElementById('browser-control-btn');
        if (browserControlButton) {
            browserControlButton.classList.toggle('active', this.browserControlActive);
            browserControlButton.setAttribute(
                'aria-pressed',
                this.browserControlActive ? 'true' : 'false'
            );
        }

        this.ui.setBrowserControlVisible(this.browserControlActive);
    }

    toggleBrowserControl(forceState = null) {
        if (forceState !== null) {
            if (this.browserControlActive === forceState) return;
            this.setBrowserControlActiveState(forceState);
        } else {
            this.setBrowserControlActiveState(!this.browserControlActive);
        }

        // Signal background to start/stop debugger session immediately
        sendToBackground({
            action: 'TOGGLE_BROWSER_CONTROL',
            enabled: this.browserControlActive,
            hostIsTab: this.hostIsTab,
        });
    }

    handleTabSwitcher() {
        sendToBackground({ action: 'GET_OPEN_TABS' });
    }

    setDebugToolsActiveState(active) {
        this.debugToolsActive = active === true;
        this.ui.setDebugToolsActive?.(this.debugToolsActive);
    }

    toggleDebugTools(forceState = null) {
        const nextState = forceState === null ? !this.debugToolsActive : forceState === true;
        if (nextState === this.debugToolsActive) return;

        // Browser control and debug tools share the tab's single debugger
        // session; enabling one must release the other.
        if (nextState && this.browserControlActive) {
            this.toggleBrowserControl(false);
        }

        this.setDebugToolsActiveState(nextState);
        sendToBackground({ action: 'TOGGLE_DEBUG_TOOLS', enabled: nextState });
    }

    handleTabSelected(tabId, shouldSwitch = true) {
        sendToBackground({ action: 'SWITCH_TAB', tabId: tabId, switchVisual: shouldSwitch });
    }

    handleNewChat() {
        this.sessionFlow.handleNewChat();
    }

    switchToSession(sessionId) {
        this.sessionFlow.switchToSession(sessionId);
    }

    rerender() {
        const currentId = this.sessionManager.currentSessionId;
        if (currentId) {
            this.switchToSession(currentId);
        }
    }

    getSelectedModel() {
        return this.ui.modelSelect ? this.ui.modelSelect.value : DEFAULT_STORED_GEMINI_MODEL;
    }

    getConnectionProvider() {
        const connectionData = this.ui.settings?.connectionData;
        if (connectionData?.provider) return connectionData.provider;
        return connectionData?.useOfficialApi === true ? 'official' : DEFAULT_PROVIDER;
    }

    setHostContext(context = {}) {
        this.hostIsTab = context.isTab === true;
    }

    handleModelChange(model) {
        const connectionData = this.ui.settings?.connectionData;
        const provider =
            connectionData?.provider ||
            (connectionData?.useOfficialApi === true ? 'official' : DEFAULT_PROVIDER);
        if (provider === 'openai' && connectionData) {
            connectionData.openaiSelectedModel = model;
        }
        if (isDedicatedApiProvider(provider) && connectionData) {
            const providers = connectionData.dedicatedApiProviders || {};
            const current = providers[provider] || { provider };
            connectionData.dedicatedApiProviders = {
                ...providers,
                [provider]: {
                    ...current,
                    selectedModel: model,
                },
            };
        }
        if (provider === 'web') {
            this.ui.syncThinkingForModel?.(model, { saveIfChanged: true });
        } else {
            this.ui.syncThinkingForModel?.(model);
        }
        window.parent.postMessage(
            {
                action: 'SAVE_MODEL',
                payload: { provider, model },
            },
            '*'
        );
    }

    handleDeleteSession(sessionId) {
        this.sessionFlow.handleDeleteSession(sessionId);
    }

    handleCancel() {
        this.prompt.cancel();
    }

    handleSendMessage() {
        this.prompt.send();
    }

    saveCurrentTabSessionBinding(sessionId) {
        if (!Number.isInteger(this.currentTabId) || this.currentTabId <= 0) return;
        window.parent.postMessage(
            {
                action: 'SAVE_SIDE_PANEL_SESSION_BINDING',
                payload: {
                    tabId: this.currentTabId,
                    sessionId,
                },
            },
            '*'
        );
    }

    getBoundSession() {
        return this.boundSessionId ? this.sessionManager.getSessionById(this.boundSessionId) : null;
    }

    restoreRememberedTabSession() {
        const boundSession = this.getBoundSession();
        if (boundSession) {
            if (this.sessionManager.currentSessionId !== boundSession.id) {
                this.switchToSession(boundSession.id);
            }
            return;
        }

        this.sessionFlow.enterDraft();
    }

    getMessageCount(session) {
        return Array.isArray(session?.messages) ? session.messages.length : 0;
    }

    hasNewAiMessage(session, previousMessageCount) {
        const messages = Array.isArray(session?.messages) ? session.messages : [];
        if (messages.length <= previousMessageCount) return false;
        return messages.slice(previousMessageCount).some((message) => message?.role === 'ai');
    }

    syncCurrentSessionFromStorage(sessionId, previousMessageCount) {
        const session = this.sessionManager.getSessionById(sessionId);
        if (!this.hasNewAiMessage(session, previousMessageCount)) return false;

        const scrollState = this.ui.getChatScrollState ? this.ui.getChatScrollState() : null;
        this.sessionFlow.switchToSession(sessionId, { restoreScrollState: scrollState });
        this.messageHandler.markSessionRenderedFromStorage(
            sessionId,
            this.getMessageCount(session)
        );
        return true;
    }

    async handleIncomingMessage(event) {
        const { action, payload } = event.data || {};
        if (!action) return;

        if (action === 'RESTORE_SIDEBAR_BEHAVIOR') {
            this.sidebarRestoreBehavior = payload;
            this.ui.settings.updateSidebarBehavior(payload);
            return;
        }
        if (action === 'RESTORE_SIDE_PANEL_SCOPE') {
            this.sidePanelScope = payload || DEFAULT_SIDE_PANEL_SCOPE;
            this.ui.settings.updateSidePanelScope(payload);
            return;
        }
        if (action === 'RESTORE_CONTEXT_SETTINGS') {
            this.ui.settings.updateContextSettings(payload);
            return;
        }
        if (action === 'RESTORE_INPUT_DRAFTS') {
            this.hydrateInputDrafts(payload);
            this.restoreInputDraftForTab(this.currentTabId);
            return;
        }
        if (action === 'RESTORE_SIDE_PANEL_TAB_CONTEXT') {
            const nextTabId = payload?.tabId || null;
            const tabChanged = nextTabId !== this.currentTabId;
            if (tabChanged && this.hasComposerContent()) {
                this.saveInputDraftForTab(this.currentTabId);
            }

            this.currentTabId = nextTabId;
            this.currentTabUrl = payload?.url || '';
            this.currentTabTitle = payload?.title || '';
            this.boundSessionId = payload?.sessionId || null;
            const pageContextAvailable =
                Number.isInteger(this.currentTabId) && this.currentTabId > 0;
            this.ui.setPageContextAvailable?.(pageContextAvailable);
            this.ui.setDebugToolsAvailable?.(pageContextAvailable);
            this.ui.tabMention?.setCurrentTabId?.(this.currentTabId);
            // Only migrate on an actual tab change: title/url updates also post
            // this message, and re-sending the toggle would restart capture.
            if (this.debugToolsActive && (tabChanged || !pageContextAvailable)) {
                if (pageContextAvailable) {
                    sendToBackground({ action: 'TOGGLE_DEBUG_TOOLS', enabled: true });
                } else {
                    this.toggleDebugTools(false);
                }
            }
            if (this.sessionsRestored && this.sidePanelScope === DEFAULT_SIDE_PANEL_SCOPE) {
                this.restoreRememberedTabSession();
            }
            if (tabChanged) {
                this.restoreInputDraftForTab(this.currentTabId, { force: true });
            }
            return;
        }
        if (action === 'RESTORE_GROUPS') {
            this.sessionManager.setGroups(payload);
            if (this.sessionsRestored) {
                this.sessionFlow.refreshHistoryUI();
            }
            return;
        }

        if (action === 'RESTORE_SESSIONS') {
            const restoredSessions = Array.isArray(payload) ? payload : [];
            const previousCurrentId = this.sessionManager.currentSessionId;
            const previousCurrentSession = this.sessionManager.getCurrentSession();
            const previousMessageCount = this.getMessageCount(previousCurrentSession);

            this.sessionManager.setSessions(restoredSessions);
            this.sessionsRestored = true;
            this.sessionFlow.refreshHistoryUI();
            if (this.sessionManager.sessions.length !== restoredSessions.length) {
                saveSessionsToStorage(this.sessionManager.getPersistableSessions(), {
                    type: 'pruneSessions',
                });
            }

            if (previousCurrentId && previousCurrentSession) {
                this.syncCurrentSessionFromStorage(previousCurrentId, previousMessageCount);
            }

            const currentId = this.sessionManager.currentSessionId;
            const currentSessionExists = this.sessionManager.getCurrentSession();

            // If we are initializing (no current session yet), apply the behavior logic
            if (!currentId || !currentSessionExists) {
                const sorted = this.sessionManager.getSortedSessions();

                let shouldRestore = false;

                if (this.sidebarRestoreBehavior === 'new') {
                    shouldRestore = false;
                } else if (this.sidebarRestoreBehavior === 'restore') {
                    shouldRestore = true;
                } else {
                    // 'auto' mode: Restore if last active within 10 minutes
                    if (sorted.length > 0) {
                        const lastActive = sorted[0].timestamp;
                        const now = Date.now();
                        const tenMinutes = 10 * 60 * 1000;
                        if (now - lastActive < tenMinutes) {
                            shouldRestore = true;
                        }
                    }
                }

                if (this.sidePanelScope === DEFAULT_SIDE_PANEL_SCOPE) {
                    this.restoreRememberedTabSession();
                } else if (shouldRestore && sorted.length > 0) {
                    this.switchToSession(sorted[0].id);
                } else {
                    this.handleNewChat();
                }
            }
            return;
        }

        if (action === 'RESTORE_CONNECTION_SETTINGS') {
            this.ui.settings.updateConnectionSettings(payload);
            // The model list depends on the full connection settings payload.
            this.ui.updateModelList(payload);
            return;
        }

        if (action === 'BACKGROUND_MESSAGE' && payload && typeof payload === 'object') {
            if (payload.action === 'SWITCH_SESSION') {
                this.switchToSession(payload.sessionId);
                return;
            }
            if (payload.action === 'ACTIVATE_BROWSER_CONTROL') {
                this.toggleBrowserControl(true);
                if (this.ui.inputFn) this.ui.inputFn.focus();
                return;
            }
            if (payload.action === 'BROWSER_CONTROL_TOGGLE_RESULT') {
                if (payload.status === 'error' && this.browserControlActive === payload.enabled) {
                    this.setBrowserControlActiveState(!payload.enabled);
                    this.ui.updateStatus(payload.error || 'Browser control could not be updated.');
                    setTimeout(() => {
                        if (!this.isGenerating) this.ui.updateStatus('');
                    }, 3000);
                }
                return;
            }
            if (payload.action === 'BACKGROUND_REQUEST_ERROR') {
                // Panel-owned requests (MCP test, model list) render their own
                // progress UI. Clearing the chat's generating state for them
                // would also drop a reply that is still streaming in.
                const handledBySettings = this.ui.handleBackgroundRequestFailure?.(
                    payload.requestAction || null,
                    payload.error || ''
                );
                if (handledBySettings) return;

                // SEND_PROMPT sets isGenerating before the parent forwards the
                // message. Clear loading if sendMessage failed mid-flight.
                this.prompt.forceClearGenerating({
                    status: payload.error || 'Background request failed.',
                    keepStatusMs: 3000,
                });
                return;
            }
            if (payload.action === 'SERVICE_WORKER_STARTED') {
                // The worker also announces itself when a send wakes it from
                // idle. Clearing on the bare announcement would drop that live
                // run and its stream, so confirm it has no run for this session.
                if (this.isGenerating) {
                    this._workerProbeSessionId = this.generatingSessionId;
                    sendToBackground({ action: 'GET_ACTIVE_RUN_STATE' });
                }
                return;
            }
            if (payload.action === 'ACTIVE_RUN_STATE') {
                const probeSessionId = this._workerProbeSessionId;
                this._workerProbeSessionId = undefined;
                if (probeSessionId === undefined) return;
                if (!this.isGenerating || this.generatingSessionId !== probeSessionId) return;

                const ownsRun =
                    payload.active === true &&
                    (payload.sessionId == null || payload.sessionId === probeSessionId);
                if (ownsRun) return;

                // Side panel outlived a SW restart with a zombie generating flag.
                console.warn(
                    '[Gemini Nexus] Clearing stuck generating state: service worker has no active run'
                );
                this.prompt.forceClearGenerating();
                return;
            }
            if (payload.action === 'OPEN_TABS_RESULT') {
                if (payload.error) {
                    this.ui.updateStatus(payload.error);
                    setTimeout(() => {
                        if (!this.isGenerating) this.ui.updateStatus('');
                    }, 3000);
                    return;
                }
                this.ui.openTabSelector(
                    payload.tabs,
                    (tabId, shouldSwitch) => this.handleTabSelected(tabId, shouldSwitch),
                    payload.lockedTabId
                );
                return;
            }
            if (payload.action === 'TAB_LOCKED') {
                if (this.ui && this.ui.updateBrowserControlState) {
                    this.ui.updateBrowserControlState({
                        tab: payload.tab || null,
                        attached: payload.attached === true,
                    });
                } else if (this.ui && this.ui.tabSelector) {
                    this.ui.tabSelector.updateTrigger(payload.tab);
                }
                return;
            }
            if (payload.action === 'HISTORY_SAVE_BLOCKED') {
                // Storage refused the session save; the chat on screen is ahead
                // of what a reload would restore, so say so instead of staying quiet.
                this.ui.updateStatus(t('historySaveBlocked'));
                setTimeout(() => {
                    if (!this.isGenerating) this.ui.updateStatus('');
                }, 4000);
                return;
            }
            if (payload.action === 'MENTION_TABS_RESULT') {
                this.ui.tabMention?.setCandidates?.(payload.tabs, payload.currentTabId);
                return;
            }
            if (payload.action === 'DEBUG_TOOLS_RESULT') {
                const enabled = payload.enabled === true && payload.status !== 'error';
                this.setDebugToolsActiveState(enabled);

                const statusText = payload.error
                    ? payload.error
                    : enabled
                      ? t('debugToolsEnabled')
                      : '';
                if (statusText) {
                    this.ui.updateStatus(statusText);
                    setTimeout(() => {
                        if (!this.isGenerating) this.ui.updateStatus('');
                    }, 3000);
                }
                return;
            }
            if (payload.action === 'DEBUG_TOOLS_STOPPED') {
                this.setDebugToolsActiveState(false);
                return;
            }

            await this.messageHandler.handle(payload);
        }
    }
}
