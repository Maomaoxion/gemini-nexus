// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadText } from './downloads.js';
import { handleWindowMessageAction } from './window_actions.js';

vi.mock('./downloads.js', () => ({
    downloadFile: vi.fn(),
    downloadText: vi.fn(),
}));

describe('sidepanel window actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.chrome = {
            runtime: {
                lastError: null,
            },
            storage: {
                local: {
                    get: vi.fn(),
                },
            },
        };
    });

    it('forwards sandbox text downloads with their content type', () => {
        handleWindowMessageAction(
            'DOWNLOAD_TEXT',
            {
                text: '{"ok":true}',
                filename: 'chat.json',
                contentType: 'application/json',
            },
            {}
        );

        expect(downloadText).toHaveBeenCalledWith('{"ok":true}', 'chat.json', 'application/json');
    });

    it('exports settings data with API keys and sensitive MCP fields redacted', () => {
        chrome.storage.local.get.mockImplementation((keys, callback) =>
            callback({
                geminiApiKey: 'official-secret',
                geminiOpenaiApiKey: 'openai-secret',
                geminiTheme: 'dark',
                geminiMcpServers: [
                    {
                        id: 'srv',
                        headers: {
                            Authorization: 'Bearer local',
                            'X-Workspace': 'docs',
                            token: 'structured-token',
                        },
                        env: { API_TOKEN: 'stdio-secret' },
                        auth: { type: 'bearer', token: 'auth-secret' },
                    },
                ],
            })
        );

        handleWindowMessageAction('EXPORT_SETTINGS_DATA', null, {});

        expect(downloadText).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringMatching(/^gemini-nexus-settings-\d{4}-\d{2}-\d{2}\.json$/),
            'application/json'
        );
        const exported = JSON.parse(downloadText.mock.calls.at(-1)[0]);
        const exportedJson = JSON.stringify(exported);
        expect(exported.settings).not.toHaveProperty('geminiApiKey');
        expect(exported.settings).not.toHaveProperty('geminiOpenaiApiKey');
        expect(exported.settings.geminiMcpServers[0]).toEqual(
            expect.objectContaining({
                headers: { 'X-Workspace': 'docs' },
                env: {},
                auth: { type: 'bearer' },
            })
        );
        expect(exportedJson).not.toContain('official-secret');
        expect(exportedJson).not.toContain('openai-secret');
        expect(exportedJson).not.toContain('structured-token');
        expect(exportedJson).not.toContain('stdio-secret');
        expect(exportedJson).not.toContain('auth-secret');
    });

    it('exports history data without live context', () => {
        chrome.storage.local.get.mockImplementation((keys, callback) =>
            callback({
                geminiSessions: [{ id: 'session-1', context: { ids: ['live'] }, messages: [] }],
                geminiGroups: [{ id: 'group-1', title: 'Work' }],
            })
        );

        handleWindowMessageAction('EXPORT_HISTORY_DATA', null, {});

        const exported = JSON.parse(downloadText.mock.calls.at(-1)[0]);
        expect(exported).toEqual(
            expect.objectContaining({
                type: 'GeminiNexus-History',
                history: [{ id: 'session-1', context: null, messages: [] }],
                groups: [{ id: 'group-1', title: 'Work' }],
            })
        );
        expect(downloadText).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringMatching(/^gemini-nexus-history-\d{4}-\d{2}-\d{2}\.json$/),
            'application/json'
        );
    });

    it('does not export history data when storage read fails', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            chrome.runtime.lastError = { message: 'Storage read failed' };
            callback({});
            chrome.runtime.lastError = null;
        });

        const postBackgroundMessage = vi.fn();
        handleWindowMessageAction('EXPORT_HISTORY_DATA', null, { postBackgroundMessage });

        expect(downloadText).not.toHaveBeenCalled();
        expect(postBackgroundMessage).toHaveBeenCalledWith({
            action: 'BACKGROUND_REQUEST_ERROR',
            requestAction: 'EXPORT_HISTORY_DATA',
            error: 'Storage read failed',
        });
        expect(warnSpy).toHaveBeenCalledWith(
            '[Gemini Nexus] Failed to export history data:',
            expect.any(Error)
        );

        warnSpy.mockRestore();
    });

    it('does not export settings data when storage read fails', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            chrome.runtime.lastError = { message: 'Storage read failed' };
            callback({});
            chrome.runtime.lastError = null;
        });

        const postBackgroundMessage = vi.fn();
        handleWindowMessageAction('EXPORT_SETTINGS_DATA', null, { postBackgroundMessage });

        expect(downloadText).not.toHaveBeenCalled();
        expect(postBackgroundMessage).toHaveBeenCalledWith({
            action: 'BACKGROUND_REQUEST_ERROR',
            requestAction: 'EXPORT_SETTINGS_DATA',
            error: 'Storage read failed',
        });
        expect(warnSpy).toHaveBeenCalledWith(
            '[Gemini Nexus] Failed to export settings data:',
            expect.any(Error)
        );

        warnSpy.mockRestore();
    });

    it('forwards data import actions to the bridge', () => {
        const bridge = {
            importHistoryData: vi.fn(),
            importSettingsData: vi.fn(),
        };
        const historyPayload = { type: 'GeminiNexus-History', history: [] };
        const settingsPayload = { type: 'GeminiNexus-Settings', settings: {} };

        handleWindowMessageAction('IMPORT_HISTORY_DATA', historyPayload, bridge);
        handleWindowMessageAction('IMPORT_SETTINGS_DATA', settingsPayload, bridge);

        expect(bridge.importHistoryData).toHaveBeenCalledWith(historyPayload);
        expect(bridge.importSettingsData).toHaveBeenCalledWith(settingsPayload);
    });

    it('saves normalized Gemini Web thinking level', () => {
        const bridge = {
            state: {
                save: vi.fn(),
            },
        };

        handleWindowMessageAction('SAVE_WEB_THINKING_LEVEL', 'MINIMAL', bridge);

        expect(bridge.state.save).toHaveBeenCalledWith('geminiWebThinkingLevel', 'minimal');
    });

    it('validates theme, toggles, and enums on save', () => {
        const bridge = {
            state: {
                save: vi.fn(),
            },
        };

        handleWindowMessageAction('SAVE_THEME', 'neon', bridge);
        handleWindowMessageAction('SAVE_TEXT_SELECTION', 'false', bridge);
        handleWindowMessageAction('SAVE_IMAGE_TOOLS', true, bridge);
        handleWindowMessageAction('SAVE_SIDEBAR_BEHAVIOR', 'turbo', bridge);
        handleWindowMessageAction('SAVE_SIDE_PANEL_SCOPE', 'everything', bridge);
        handleWindowMessageAction('SAVE_TEXT_SELECTION_BLACKLIST', 'x'.repeat(25000), bridge);

        expect(bridge.state.save).toHaveBeenCalledWith('geminiTheme', 'system');
        expect(bridge.state.save).toHaveBeenCalledWith('geminiTextSelectionEnabled', false);
        expect(bridge.state.save).toHaveBeenCalledWith('geminiImageToolsEnabled', true);
        expect(bridge.state.save).toHaveBeenCalledWith('geminiSidebarBehavior', 'auto');
        expect(bridge.state.save).toHaveBeenCalledWith('geminiSidePanelScope', 'remembered_tabs');
        const blacklistCall = bridge.state.save.mock.calls.find(
            ([key]) => key === 'geminiTextSelectionBlacklist'
        );
        expect(blacklistCall[1]).toHaveLength(20000);
    });
});
