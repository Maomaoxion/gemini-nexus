// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../core/session_manager.js';
import { PromptController } from './prompt.js';
import { appendMessage } from '../render/message.js';
import { saveSessionsToStorage, sendToBackground } from '../../shared/messaging/index.js';

vi.mock('../render/message.js', () => ({
    appendMessage: vi.fn(),
}));

vi.mock('../../shared/messaging/index.js', () => ({
    saveSessionsToStorage: vi.fn(),
    sendToBackground: vi.fn(),
}));

vi.mock('../core/i18n.js', () => ({
    t: (key) => key,
}));

function createPromptHarness({ text = 'Hello', files = [], liveArtifactsEnabled = false } = {}) {
    const sessionManager = new SessionManager();
    sessionManager.enterDraft();

    const ui = {
        historyDiv: document.createElement('div'),
        inputFn: { value: text },
        settings: { connectionData: { provider: 'official' } },
        resetInput: vi.fn(),
        setLoading: vi.fn(),
        updateStatus: vi.fn(),
    };

    const imageManager = {
        getFiles: vi.fn(() => files),
        clearFile: vi.fn(),
    };

    const app = {
        browserControlActive: false,
        debugToolsActive: false,
        hostIsTab: false,
        isGenerating: false,
        generatingSessionId: null,
        boundSessionId: null,
        liveArtifactsEnabled,
        // Mirrors AppController.getConnectionProvider(), which PromptController now defers to.
        getConnectionProvider: () => ui.settings?.connectionData?.provider || 'web',
        getSelectedModel: vi.fn(() => 'gemini-test'),
        getReferencedTabs: vi.fn(() => []),
        saveCurrentTabSessionBinding: vi.fn(),
        sessionFlow: {
            refreshHistoryUI: vi.fn(),
            switchToSession: vi.fn(),
        },
        rerender: vi.fn(),
    };

    const controller = new PromptController(sessionManager, ui, imageManager, app);
    return { app, controller, imageManager, sessionManager, ui };
}

describe('PromptController generation recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forceClearGenerating resets isGenerating and loading UI', () => {
        const { app, controller, ui } = createPromptHarness();
        app.isGenerating = true;
        app.generatingSessionId = 's1';
        controller.generationStartedAt = Date.now() - 60_000;
        controller.forceClearGenerating({ status: 'cleared' });
        expect(app.isGenerating).toBe(false);
        expect(app.generatingSessionId).toBeNull();
        expect(ui.setLoading).toHaveBeenCalledWith(false);
        expect(ui.updateStatus).toHaveBeenCalledWith('cleared');
    });

    it('deletes a whole turn including tool output rows', async () => {
        const { controller, sessionManager } = createPromptHarness();
        const session = sessionManager.createSession();
        sessionManager.addMessage(session.id, 'user', 'Check errors');
        sessionManager.addMessage(session.id, 'ai', 'Calling tool');
        session.messages.push({
            role: 'user',
            text: '[Tool Output: get_page_errors]',
            kind: 'tool-output',
            toolName: 'get_page_errors',
        });
        sessionManager.addMessage(session.id, 'ai', 'Result');
        sessionManager.addMessage(session.id, 'user', 'Next question');

        const result = await controller.deleteTurnFrom(0);

        expect(result).toBe(true);
        const messages = sessionManager.getCurrentSession().messages;
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ role: 'user', text: 'Next question' });
    });

    it('sends referenced tabs with the prompt payload', async () => {
        const { app, controller } = createPromptHarness({ text: 'Summarize' });
        const tabs = [{ id: 3, title: 'GitHub', url: 'https://github.com/', favIconUrl: '' }];
        app.getReferencedTabs.mockReturnValue(tabs);

        await controller.send();

        expect(sendToBackground).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'SEND_PROMPT',
                text: 'Summarize',
                referencedTabs: tabs,
            })
        );
        expect(app.getReferencedTabs).toHaveBeenCalled();
    });

    it('sends the debug tools flag when the debug toggle is on', async () => {
        const { app, controller } = createPromptHarness({ text: 'Why did it fail?' });
        app.debugToolsActive = true;

        await controller.send();

        expect(sendToBackground).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'SEND_PROMPT',
                enableDebugTools: true,
            })
        );
    });

    it('regenerates a reply by resending the user turn above it', async () => {
        const { controller, sessionManager } = createPromptHarness();
        const session = sessionManager.createSession();
        sessionManager.addMessage(session.id, 'user', 'Hello');
        sessionManager.addMessage(session.id, 'ai', 'Answer');

        const retryOptions = controller.getMessageRetryOptions(1);
        expect(retryOptions.onRetry).toBeTypeOf('function');

        await retryOptions.onRetry();

        expect(sendToBackground).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'SEND_PROMPT', text: 'Hello', sessionId: session.id })
        );
        // The reply is dropped and only the user turn is kept for the resend.
        expect(sessionManager.getCurrentSession().messages).toHaveLength(1);
        expect(sessionManager.getCurrentSession().messages[0]).toMatchObject({
            role: 'user',
            text: 'Hello',
        });
    });

    it('does not regenerate when there is no user turn above the reply', async () => {
        const { controller, sessionManager } = createPromptHarness();
        const session = sessionManager.createSession();
        sessionManager.addMessage(session.id, 'ai', 'Answer');

        const result = await controller.getMessageRetryOptions(0).onRetry();

        expect(result).toBe(false);
        expect(sendToBackground).not.toHaveBeenCalledWith(
            expect.objectContaining({ action: 'SEND_PROMPT' })
        );
    });

    it('deletes a single message row and persists the truncated session', async () => {
        const { controller, sessionManager } = createPromptHarness();
        const session = sessionManager.createSession();
        sessionManager.addMessage(session.id, 'user', 'Hello');
        sessionManager.addMessage(session.id, 'ai', 'Answer');

        await expect(controller.getMessageDeleteOptions(1).onDelete()).resolves.toBe(true);

        expect(sessionManager.getCurrentSession().messages.map((entry) => entry.text)).toEqual([
            'Hello',
        ]);
        expect(saveSessionsToStorage).toHaveBeenCalledWith(
            [expect.objectContaining({ id: session.id })],
            { type: 'replaceSession', sessionId: session.id }
        );
    });

    it('keeps tool output rows undeletable', async () => {
        const { controller, sessionManager } = createPromptHarness();
        const session = sessionManager.createSession();
        sessionManager.addMessage(session.id, 'user', 'Hello');
        sessionManager.addMessage(session.id, 'user', '[Tool Output: click]');

        await expect(controller.getMessageDeleteOptions(1).onDelete()).resolves.toBe(false);

        expect(saveSessionsToStorage).not.toHaveBeenCalled();
        expect(sessionManager.getCurrentSession().messages).toHaveLength(2);
    });

    it('markGenerationActivity re-arms the idle watchdog', () => {
        vi.useFakeTimers();
        try {
            const { app, controller } = createPromptHarness();
            app.isGenerating = true;
            app.generatingSessionId = 's1';
            app.browserControlActive = false;
            controller.generationStartedAt = Date.now();
            controller.lastGenerationActivityAt = Date.now();
            controller._armGenerationWatchdog(true);

            // Advance just under the default idle budget, then mark activity.
            vi.advanceTimersByTime(80_000);
            controller.markGenerationActivity();
            vi.advanceTimersByTime(80_000);
            // Still active within the new budget — should not time out.
            expect(app.isGenerating).toBe(true);
            expect(sendToBackground).not.toHaveBeenCalledWith({ action: 'CANCEL_PROMPT' });

            // Full idle budget after last activity → cancel SW + clear UI.
            vi.advanceTimersByTime(20_000);
            expect(app.isGenerating).toBe(false);
            expect(sendToBackground).toHaveBeenCalledWith({ action: 'CANCEL_PROMPT' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancel clears stuck generating even without an active flag edge case', () => {
        const { app, controller, ui } = createPromptHarness();
        app.isGenerating = true;
        app.generatingSessionId = 's1';
        controller.cancel();
        expect(app.isGenerating).toBe(false);
        expect(sendToBackground).toHaveBeenCalledWith({ action: 'CANCEL_PROMPT' });
        expect(ui.setLoading).toHaveBeenCalledWith(false);
    });
});

describe('PromptController.send', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates and enters a persisted session when sending from draft state', async () => {
        const { app, controller, sessionManager, ui } = createPromptHarness();

        await controller.send();

        const session = sessionManager.getCurrentSession();
        expect(session).toBeTruthy();
        expect(session.title).toBe('Hello');
        expect(session.messages).toEqual([{ role: 'user', text: 'Hello' }]);

        expect(appendMessage).toHaveBeenCalledWith(
            ui.historyDiv,
            'Hello',
            'user',
            null,
            null,
            null,
            expect.objectContaining({ onEdit: expect.any(Function) })
        );
        expect(saveSessionsToStorage).toHaveBeenCalledWith([session], {
            type: 'upsertSession',
            sessionId: session.id,
        });
        // Sending must not remount via switchToSession (that path RESET_CONTEXT).
        expect(app.sessionFlow.switchToSession).not.toHaveBeenCalled();
        expect(app.sessionFlow.refreshHistoryUI).toHaveBeenCalled();
        expect(app.boundSessionId).toBe(session.id);
        expect(app.saveCurrentTabSessionBinding).toHaveBeenCalledWith(session.id);
        expect(app.isGenerating).toBe(true);
        expect(app.generatingSessionId).toBe(session.id);
        expect(sendToBackground).toHaveBeenLastCalledWith(
            expect.objectContaining({
                action: 'SEND_PROMPT',
                text: 'Hello',
                sessionId: session.id,
            })
        );
        // No RESET_CONTEXT on ordinary send when session.context is null.
        expect(sendToBackground).not.toHaveBeenCalledWith({ action: 'RESET_CONTEXT' });
    });

    it('sets background context when the session already has one, without resetting', async () => {
        const { controller, sessionManager } = createPromptHarness();
        sessionManager.createSession();
        const session = sessionManager.getCurrentSession();
        session.context = ['conversation', 'response', 'choice'];

        await controller.send();

        expect(sendToBackground).toHaveBeenCalledWith({
            action: 'SET_CONTEXT',
            context: ['conversation', 'response', 'choice'],
            model: 'gemini-test',
        });
        expect(sendToBackground).not.toHaveBeenCalledWith({ action: 'RESET_CONTEXT' });
    });

    it('does not create a session for an empty draft send', async () => {
        const { controller, sessionManager, ui } = createPromptHarness({ text: '   ' });

        await controller.send();

        expect(sessionManager.sessions).toEqual([]);
        expect(saveSessionsToStorage).not.toHaveBeenCalled();
        expect(sendToBackground).not.toHaveBeenCalled();
        expect(ui.updateStatus).toHaveBeenCalledWith('enterMessageToSend');
    });

    it('renders and persists full metadata for mixed user attachments', async () => {
        const files = [
            {
                base64: 'data:image/png;base64,AAAA',
                type: 'image/png',
                name: 'diagram.png',
            },
            {
                base64: 'data:application/pdf;base64,BBBB',
                type: 'application/pdf',
                name: 'spec.pdf',
            },
        ];
        const { controller, sessionManager, ui } = createPromptHarness({
            text: 'Review these',
            files,
        });

        await controller.send();

        const session = sessionManager.getCurrentSession();
        expect(appendMessage).toHaveBeenCalledWith(
            ui.historyDiv,
            'Review these',
            'user',
            files,
            null,
            null,
            expect.objectContaining({ onEdit: expect.any(Function) })
        );
        expect(session.messages[0]).toEqual({
            role: 'user',
            text: 'Review these',
            image: ['data:image/png;base64,AAAA'],
            attachments: files,
        });
        expect(sendToBackground).toHaveBeenLastCalledWith(
            expect.objectContaining({
                action: 'SEND_PROMPT',
                files,
            })
        );
    });

    it('includes the current Gemini Web thinking level in prompt requests', () => {
        const { controller, ui } = createPromptHarness();
        ui.settings.connectionData = {
            provider: 'web',
            webThinkingLevel: 'minimal',
        };

        expect(controller.buildRequestPayload('Hello', [], 'session-1')).toEqual(
            expect.objectContaining({
                webThinkingLevel: 'minimal',
            })
        );
    });

    it('includes the current provider thinking level in prompt requests', () => {
        const { controller, ui } = createPromptHarness();
        ui.settings.connectionData = {
            provider: 'openai',
            openaiModel: 'gpt-6-astra, gpt-6-mini',
            openaiThinkingLevel: 'max',
        };

        expect(controller.buildRequestPayload('Hello', [], 'session-1')).toEqual(
            expect.objectContaining({
                thinkingLevel: 'max',
                configuredModels: 'gpt-6-astra, gpt-6-mini',
            })
        );
    });

    it('does not send a generic thinking level for Gemini Web requests', () => {
        const { controller, ui } = createPromptHarness();
        ui.settings.connectionData = {
            provider: 'web',
            webThinkingLevel: 'minimal',
        };

        const payload = controller.buildRequestPayload('Hello', [], 'session-1');

        expect(payload.thinkingLevel).toBeUndefined();
        expect(payload.webThinkingLevel).toBe('minimal');
    });

    it('includes standalone host context in browser-control prompt requests', () => {
        const { app, controller } = createPromptHarness();
        app.browserControlActive = true;
        app.hostIsTab = true;

        expect(controller.buildRequestPayload('Open Google', [], 'session-1')).toEqual(
            expect.objectContaining({
                action: 'SEND_PROMPT',
                enableBrowserControl: true,
                hostIsTab: true,
            })
        );
    });

    it('includes the Live Artifacts system instruction when artifact mode is active', () => {
        const { controller } = createPromptHarness({ liveArtifactsEnabled: true });

        expect(controller.buildRequestPayload('Make a comparison matrix', [], 'session-1')).toEqual(
            expect.objectContaining({
                action: 'SEND_PROMPT',
                systemInstruction: expect.stringContaining('[Live Artifacts Inline Protocol - zh]'),
            })
        );
    });

    it('sends explicit follow-up text without reading the composer value', async () => {
        const { controller, sessionManager, ui } = createPromptHarness({
            text: 'stale composer',
        });

        await controller.sendText('请继续完善 Artifact');

        const session = sessionManager.getCurrentSession();
        expect(session.messages[0]).toEqual({
            role: 'user',
            text: '请继续完善 Artifact',
        });
        expect(appendMessage).toHaveBeenCalledWith(
            ui.historyDiv,
            '请继续完善 Artifact',
            'user',
            null,
            null,
            null,
            expect.objectContaining({ onEdit: expect.any(Function) })
        );
        expect(sendToBackground).toHaveBeenLastCalledWith(
            expect.objectContaining({
                action: 'SEND_PROMPT',
                text: '请继续完善 Artifact',
            })
        );
    });
});

describe('PromptController cancellation window', () => {
    it('scopes recent cancellation to the cancelled session', () => {
        const { app, controller } = createPromptHarness();
        app.isGenerating = true;
        app.generatingSessionId = 's1';

        controller.cancel();

        expect(controller.isCancellationRecent('s1')).toBe(true);
        expect(controller.isCancellationRecent('s2')).toBe(false);
    });

    it('expires the cancellation window', () => {
        vi.useFakeTimers();
        try {
            const { app, controller } = createPromptHarness();
            app.isGenerating = true;
            app.generatingSessionId = 's1';

            controller.cancel();
            expect(controller.isCancellationRecent('s1')).toBe(true);

            vi.setSystemTime(Date.now() + 2001);
            expect(controller.isCancellationRecent('s1')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the legacy session-less check time-based', () => {
        vi.useFakeTimers();
        try {
            const { app, controller } = createPromptHarness();
            app.isGenerating = true;
            app.generatingSessionId = 's1';

            controller.cancel();
            expect(controller.isCancellationRecent()).toBe(true);

            vi.setSystemTime(Date.now() + 2001);
            expect(controller.isCancellationRecent()).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});
