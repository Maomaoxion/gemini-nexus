// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../core/session_manager.js';
import { AppController } from './app_controller.js';
import { saveSessionsToStorage, sendToBackground } from '../../shared/messaging/index.js';

vi.mock('../render/message.js', () => ({
    appendMessage: vi.fn(),
}));

vi.mock('../render/context_compression.js', () => ({
    appendContextCompressionNotice: vi.fn(),
}));

vi.mock('../../shared/dom/crop_image.js', () => ({
    cropImage: vi.fn(),
}));

vi.mock('../../shared/messaging/index.js', () => ({
    downloadTextFile: vi.fn(),
    saveGroupsToStorage: vi.fn(),
    saveSessionsToStorage: vi.fn(),
    sendToBackground: vi.fn(),
}));

vi.mock('../core/i18n.js', () => ({
    t: (key) => key,
}));

function createUi() {
    const inputFn = document.createElement('textarea');
    inputFn.focus = vi.fn();

    return {
        chat: { togglePageContext: vi.fn(), toggleLiveArtifacts: vi.fn() },
        clearChatHistory: vi.fn(),
        historyDiv: document.createElement('div'),
        inputFn,
        modelSelect: { value: 'gemini-test' },
        renderHistoryList: vi.fn(),
        resetInput: vi.fn(),
        getChatScrollState: vi.fn(() => ({ scrollTop: 120, isNearBottom: false })),
        restoreChatScrollState: vi.fn(),
        scrollToBottom: vi.fn(),
        settings: {
            connectionData: { provider: 'web' },
            updateContextSettings: vi.fn(),
            updateConnectionSettings: vi.fn(),
            updateSidebarBehavior: vi.fn(),
            updateSidePanelScope: vi.fn(),
        },
        setBrowserControlVisible: vi.fn(),
        setPageContextAvailable: vi.fn(),
        setLoading: vi.fn(),
        updateBrowserControlState: vi.fn(),
        updateWebThinkingToggle: vi.fn(),
        setBrowserControlCallbacks: vi.fn(),
        updateModelList: vi.fn(),
        openTabSelector: vi.fn(),
        updateStatus: vi.fn(),
        setSessionStorageHooks: vi.fn(),
    };
}

function createAppHarness() {
    const sessionManager = new SessionManager();
    const ui = createUi();
    const imageManager = {
        getFiles: vi.fn(() => []),
        clearFile: vi.fn(),
    };
    const app = new AppController(sessionManager, ui, imageManager);
    return { app, sessionManager, ui };
}

function restoreEvent(payload) {
    return {
        data: {
            action: 'RESTORE_SESSIONS',
            payload,
        },
    };
}

function realSession(overrides = {}) {
    return {
        id: 'real',
        title: 'Real chat',
        timestamp: 100,
        messages: [{ role: 'user', text: 'Hello' }],
        context: null,
        ...overrides,
    };
}

describe('AppController session restore behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    });

    it('restores a valid remembered-tab bound session', async () => {
        const { app, sessionManager, ui } = createAppHarness();
        app.currentTabId = 123;
        app.boundSessionId = 'real';
        app.sidePanelScope = 'remembered_tabs';

        await app.handleIncomingMessage(restoreEvent([realSession()]));

        expect(sessionManager.currentSessionId).toBe('real');
        expect(app.boundSessionId).toBe('real');
        expect(window.parent.postMessage).toHaveBeenCalledWith(
            {
                action: 'SAVE_SIDE_PANEL_SESSION_BINDING',
                payload: {
                    tabId: 123,
                    sessionId: 'real',
                },
            },
            '*'
        );
        expect(ui.clearChatHistory).toHaveBeenCalled();
    });

    it('falls back to draft when a remembered-tab binding points to a removed blank session', async () => {
        const { app, sessionManager, ui } = createAppHarness();
        app.currentTabId = 123;
        app.boundSessionId = 'blank';
        app.sidePanelScope = 'remembered_tabs';

        await app.handleIncomingMessage(
            restoreEvent([
                {
                    id: 'blank',
                    title: 'New Chat',
                    timestamp: 200,
                    messages: [],
                },
                realSession(),
            ])
        );

        expect(sessionManager.currentSessionId).toBeNull();
        expect(sessionManager.sessions).toEqual([expect.objectContaining({ id: 'real' })]);
        expect(saveSessionsToStorage).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'real' })],
            { type: 'pruneSessions' }
        );
        expect(window.parent.postMessage).toHaveBeenCalledWith(
            {
                action: 'SAVE_SIDE_PANEL_SESSION_BINDING',
                payload: {
                    tabId: 123,
                    sessionId: null,
                },
            },
            '*'
        );
        expect(ui.clearChatHistory).toHaveBeenCalled();
    });

    it('restores the active tab binding after sessions are already loaded', async () => {
        const { app, sessionManager } = createAppHarness();
        app.sidePanelScope = 'remembered_tabs';

        await app.handleIncomingMessage(restoreEvent([realSession()]));
        expect(sessionManager.currentSessionId).toBeNull();

        await app.handleIncomingMessage({
            data: {
                action: 'RESTORE_SIDE_PANEL_TAB_CONTEXT',
                payload: {
                    tabId: 123,
                    sessionId: 'real',
                },
            },
        });

        expect(app.currentTabId).toBe(123);
        expect(sessionManager.currentSessionId).toBe('real');
    });

    it('updates page-context availability from restored tab context', async () => {
        const { app, ui } = createAppHarness();

        await app.handleIncomingMessage({
            data: {
                action: 'RESTORE_SIDE_PANEL_TAB_CONTEXT',
                payload: { tabId: 123 },
            },
        });
        expect(ui.setPageContextAvailable).toHaveBeenCalledWith(true);

        app.pageContextActive = true;
        await app.handleIncomingMessage({
            data: {
                action: 'RESTORE_SIDE_PANEL_TAB_CONTEXT',
                payload: { tabId: null },
            },
        });
        expect(ui.setPageContextAvailable).toHaveBeenCalledWith(false);
        expect(app.pageContextActive).toBe(false);
        expect(ui.chat.togglePageContext).toHaveBeenCalledWith(false);
    });

    it('restores saved groups and rerenders history after sessions are loaded', async () => {
        const { app, sessionManager, ui } = createAppHarness();

        await app.handleIncomingMessage(restoreEvent([realSession()]));
        ui.renderHistoryList.mockClear();

        await app.handleIncomingMessage({
            data: {
                action: 'RESTORE_GROUPS',
                payload: [{ id: 'group-1', title: 'Work', timestamp: 1, isExpanded: false }],
            },
        });

        expect(sessionManager.groups).toEqual([
            { id: 'group-1', title: 'Work', timestamp: 1, isExpanded: false },
        ]);
        expect(ui.renderHistoryList).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'real' })],
            [expect.objectContaining({ id: 'group-1' })],
            sessionManager.currentSessionId,
            expect.objectContaining({ onAddGroup: expect.any(Function) }),
            { isGenerating: false, generatingSessionId: null }
        );
    });

    it('rerenders the current chat when storage updates add an AI reply', async () => {
        const { app, sessionManager, ui } = createAppHarness();
        const markRendered = vi.spyOn(app.messageHandler, 'markSessionRenderedFromStorage');
        app.sidePanelScope = 'remembered_tabs';
        sessionManager.setSessions([realSession()]);
        sessionManager.setCurrentId('real');

        await app.handleIncomingMessage(
            restoreEvent([
                realSession({
                    messages: [
                        { role: 'user', text: 'Hello' },
                        { role: 'ai', text: 'Hi there' },
                    ],
                }),
            ])
        );

        expect(sessionManager.currentSessionId).toBe('real');
        expect(ui.clearChatHistory).toHaveBeenCalled();
        expect(ui.getChatScrollState).toHaveBeenCalled();
        expect(ui.restoreChatScrollState).toHaveBeenCalledWith({
            scrollTop: 120,
            isNearBottom: false,
        });
        expect(ui.scrollToBottom).not.toHaveBeenCalled();
        expect(markRendered).toHaveBeenCalledWith('real', 2);
    });

    it('saves model changes with the active provider so OpenAI selection can persist separately', () => {
        const { app, ui } = createAppHarness();
        ui.settings.connectionData.provider = 'openai';

        app.handleModelChange('gpt-5');

        expect(window.parent.postMessage).toHaveBeenCalledWith(
            {
                action: 'SAVE_MODEL',
                payload: {
                    provider: 'openai',
                    model: 'gpt-5',
                },
            },
            '*'
        );
    });

    it('toggles Gemini Web thinking between high and the model fast level', () => {
        const { app, ui } = createAppHarness();
        ui.modelSelect.value = 'cf41b0e0dd7d53e5';
        ui.settings.connectionData = { provider: 'web', webThinkingLevel: 'high' };

        app.handleWebThinkingToggle();

        expect(ui.settings.connectionData.webThinkingLevel).toBe('minimal');
        expect(ui.updateWebThinkingToggle).toHaveBeenCalledWith(ui.settings.connectionData);
        expect(window.parent.postMessage).toHaveBeenCalledWith(
            {
                action: 'SAVE_WEB_THINKING_LEVEL',
                payload: 'minimal',
            },
            '*'
        );

        app.handleWebThinkingToggle();

        expect(ui.settings.connectionData.webThinkingLevel).toBe('high');
        expect(window.parent.postMessage).toHaveBeenCalledWith(
            {
                action: 'SAVE_WEB_THINKING_LEVEL',
                payload: 'high',
            },
            '*'
        );
    });

    it('does not toggle Web thinking for non-Web providers', () => {
        const { app, ui } = createAppHarness();
        ui.settings.connectionData = { provider: 'official', webThinkingLevel: 'high' };

        app.handleWebThinkingToggle();

        expect(window.parent.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ action: 'SAVE_WEB_THINKING_LEVEL' }),
            '*'
        );
        expect(ui.updateWebThinkingToggle).toHaveBeenCalledWith(ui.settings.connectionData);
    });

    it('toggles Live Artifacts mode and updates the chat tool state', () => {
        const { app, ui } = createAppHarness();

        app.toggleLiveArtifacts();

        expect(app.liveArtifactsEnabled).toBe(true);
        expect(ui.chat.toggleLiveArtifacts).toHaveBeenCalledWith(true);

        app.toggleLiveArtifacts(false);

        expect(app.liveArtifactsEnabled).toBe(false);
        expect(ui.chat.toggleLiveArtifacts).toHaveBeenLastCalledWith(false);
    });

    it('formats Live Artifact follow-up payloads and sends them back into the current chat', async () => {
        const { app } = createAppHarness();
        const sendText = vi.spyOn(app.prompt, 'sendText').mockResolvedValue();

        await app.handleLiveArtifactFollowUp({
            instruction: '继续细化第二个方案',
            title: '方案矩阵',
            state: { selected: 'B' },
        });

        expect(sendText).toHaveBeenCalledWith(
            expect.stringContaining('请根据 Live Artifact 中的交互选择继续处理。')
        );
        expect(sendText).toHaveBeenCalledWith(expect.stringContaining('继续细化第二个方案'));
        expect(sendText).toHaveBeenCalledWith(expect.stringContaining('"selected": "B"'));
    });

    it('sends the standalone host flag when enabling browser control', () => {
        const { app, ui } = createAppHarness();

        app.setHostContext({ isTab: true });
        app.toggleBrowserControl(true);

        expect(app.browserControlActive).toBe(true);
        expect(ui.setBrowserControlVisible).toHaveBeenCalledWith(true);
        expect(sendToBackground).toHaveBeenCalledWith({
            action: 'TOGGLE_BROWSER_CONTROL',
            enabled: true,
            hostIsTab: true,
        });
    });

    it('rolls back optimistic browser control UI when background enable fails', async () => {
        const { app, ui } = createAppHarness();
        const button = document.createElement('button');
        button.id = 'browser-control-btn';
        document.body.appendChild(button);

        app.toggleBrowserControl(true);
        expect(app.browserControlActive).toBe(true);
        expect(button.classList.contains('active')).toBe(true);

        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: {
                    action: 'BROWSER_CONTROL_TOGGLE_RESULT',
                    enabled: true,
                    status: 'error',
                    error: 'No controllable browser tab is selected.',
                },
            },
        });

        expect(app.browserControlActive).toBe(false);
        expect(button.classList.contains('active')).toBe(false);
        expect(ui.setBrowserControlVisible).toHaveBeenLastCalledWith(false);
        expect(ui.updateStatus).toHaveBeenCalledWith('No controllable browser tab is selected.');
    });

    it('shows generic background request errors from the side panel bridge', async () => {
        const { app, ui } = createAppHarness();

        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: {
                    action: 'BACKGROUND_REQUEST_ERROR',
                    requestAction: 'GET_OPEN_TABS',
                    error: 'Side panel unavailable',
                },
            },
        });

        expect(ui.updateStatus).toHaveBeenCalledWith('Side panel unavailable');
    });

    it('probes the service worker instead of dropping a run it just woke', async () => {
        const { app, ui } = createAppHarness();
        app.isGenerating = true;
        app.generatingSessionId = 'session-live';

        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: { action: 'SERVICE_WORKER_STARTED', ts: 1 },
            },
        });

        expect(sendToBackground).toHaveBeenCalledWith({ action: 'GET_ACTIVE_RUN_STATE' });
        expect(app.isGenerating).toBe(true);
        expect(ui.setLoading).not.toHaveBeenCalledWith(false);

        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: {
                    action: 'ACTIVE_RUN_STATE',
                    active: true,
                    sessionId: 'session-live',
                },
            },
        });

        expect(app.isGenerating).toBe(true);
        expect(ui.setLoading).not.toHaveBeenCalledWith(false);
    });

    it('clears a zombie generating state when the worker has no active run', async () => {
        const { app, ui } = createAppHarness();
        app.isGenerating = true;
        app.generatingSessionId = 'session-zombie';

        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: { action: 'SERVICE_WORKER_STARTED', ts: 1 },
            },
        });
        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: { action: 'ACTIVE_RUN_STATE', active: false },
            },
        });

        expect(app.isGenerating).toBe(false);
        expect(ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('registers chat storage hooks for the settings panel', () => {
        const { sessionManager, ui } = createAppHarness();
        sessionManager.setSessions([realSession()]);

        expect(ui.setSessionStorageHooks).toHaveBeenCalledTimes(1);
        const hooks = ui.setSessionStorageHooks.mock.calls[0][0];
        const report = hooks.getSessionStorageReport();

        expect(report.totals.sessionCount).toBe(1);
        expect(report.sessions[0]).toMatchObject({ id: 'real', messageCount: 1 });
    });

    it('shows a blocked history save instead of failing silently', async () => {
        const { app, ui } = createAppHarness();

        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: {
                    action: 'HISTORY_SAVE_BLOCKED',
                    reason: 'quota',
                },
            },
        });

        expect(ui.updateStatus).toHaveBeenCalledWith('historySaveBlocked');
    });

    it('shows open-tabs result errors instead of opening an empty selector', async () => {
        const { app, ui } = createAppHarness();

        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: {
                    action: 'OPEN_TABS_RESULT',
                    tabs: [],
                    lockedTabId: 1,
                    error: 'Tabs unavailable',
                },
            },
        });

        expect(ui.updateStatus).toHaveBeenCalledWith('Tabs unavailable');
        expect(ui.openTabSelector).not.toHaveBeenCalled();
    });

    it('forwards locked tab updates to the browser control bar state', async () => {
        const { app, ui } = createAppHarness();

        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: {
                    action: 'TAB_LOCKED',
                    attached: true,
                    tab: {
                        id: 7,
                        title: 'OpenAI News',
                        url: 'https://openai.com/news/',
                        controllable: true,
                    },
                },
            },
        });

        expect(ui.updateBrowserControlState).toHaveBeenCalledWith({
            attached: true,
            tab: {
                id: 7,
                title: 'OpenAI News',
                url: 'https://openai.com/news/',
                controllable: true,
            },
        });
    });

    it('ignores malformed incoming window messages', async () => {
        const { app, ui } = createAppHarness();

        await app.handleIncomingMessage({ data: null });
        await app.handleIncomingMessage({
            data: {
                action: 'BACKGROUND_MESSAGE',
                payload: null,
            },
        });

        expect(ui.updateBrowserControlState).not.toHaveBeenCalled();
        expect(ui.updateStatus).not.toHaveBeenCalled();
    });
});

describe('AppController composer drafts', () => {
    function createComposerHarness() {
        const sessionManager = new SessionManager();
        const ui = createUi();
        let text = '';
        let files = [];

        const inputFn = document.createElement('textarea');
        inputFn.focus = vi.fn();

        ui.chat = {
            ...ui.chat,
            inputFn,
            getInputValue: () => text,
            setInputValue: vi.fn((value) => {
                text = value;
            }),
        };

        const imageManager = {
            getFiles: () => [...files],
            setFiles: vi.fn((next) => {
                files = Array.isArray(next) ? [...next] : [];
            }),
            clearFile: vi.fn(() => {
                files = [];
            }),
        };

        const app = new AppController(sessionManager, ui, imageManager);

        return {
            app,
            ui,
            imageManager,
            getText: () => text,
            setText: (value) => {
                text = value;
            },
            setFiles: (next) => {
                files = next;
            },
        };
    }

    function tabContext(tabId) {
        return {
            data: {
                action: 'RESTORE_SIDE_PANEL_TAB_CONTEXT',
                payload: { tabId, url: '', title: '', sessionId: null },
            },
        };
    }

    function restoreDrafts(drafts) {
        return {
            data: { action: 'RESTORE_INPUT_DRAFTS', payload: drafts },
        };
    }

    it('keeps unsent text per tab across a tab switch', async () => {
        const harness = createComposerHarness();

        await harness.app.handleIncomingMessage(tabContext(1));
        harness.setText('half-written question');
        await harness.app.handleIncomingMessage(tabContext(2));

        expect(harness.app.inputDrafts.get('draft:1')).toEqual({
            text: 'half-written question',
            files: [],
        });
        expect(harness.getText()).toBe('');
    });

    it('restores the draft when the panel returns to the tab', async () => {
        const harness = createComposerHarness();

        await harness.app.handleIncomingMessage(tabContext(1));
        harness.setText('keep me');
        await harness.app.handleIncomingMessage(tabContext(2));
        await harness.app.handleIncomingMessage(tabContext(1));

        expect(harness.getText()).toBe('keep me');
    });

    it('restores attachments together with the draft text', async () => {
        const harness = createComposerHarness();
        const attachment = {
            base64: 'data:image/png;base64,AAAA',
            type: 'image/png',
            name: 'a.png',
        };

        await harness.app.handleIncomingMessage(tabContext(1));
        harness.setText('with image');
        harness.setFiles([attachment]);
        await harness.app.handleIncomingMessage(tabContext(2));
        await harness.app.handleIncomingMessage(tabContext(1));

        expect(harness.imageManager.setFiles).toHaveBeenLastCalledWith([attachment]);
    });

    it('hydrates persisted drafts and restores them for the active tab', async () => {
        const harness = createComposerHarness();

        await harness.app.handleIncomingMessage(
            restoreDrafts({ 'draft:7': { text: 'from storage', files: [] } })
        );
        await harness.app.handleIncomingMessage(tabContext(7));

        expect(harness.getText()).toBe('from storage');
    });

    it('does not overwrite text typed before a late hydration', async () => {
        const harness = createComposerHarness();

        await harness.app.handleIncomingMessage(tabContext(1));
        harness.setText('typing right now');
        await harness.app.handleIncomingMessage(
            restoreDrafts({ 'draft:1': { text: 'older draft', files: [] } })
        );

        expect(harness.getText()).toBe('typing right now');
    });

    it('drops the stored draft once the prompt is sent', async () => {
        const harness = createComposerHarness();

        await harness.app.handleIncomingMessage(tabContext(1));
        harness.setText('send me');
        await harness.app.handleIncomingMessage(tabContext(2));
        await harness.app.handleIncomingMessage(tabContext(1));
        expect(harness.app.inputDrafts.has('draft:1')).toBe(true);

        harness.app.clearComposerDraftAfterSend();

        expect(harness.app.inputDrafts.has('draft:1')).toBe(false);
    });
});
