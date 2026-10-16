// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSettingsBridge } from './bridge.js';
import { downloadText } from '../sidepanel/core/downloads.js';

vi.mock('../sidepanel/core/downloads.js', () => ({
    downloadText: vi.fn(),
}));

function createController() {
    return {
        defaultShortcuts: {
            quickAsk: 'Alt+Q',
            openPanel: 'Alt+G',
            browserControl: 'Alt+Shift+B',
            ocrCapture: 'Alt+O',
            snipCapture: 'Alt+S',
        },
        updateShortcuts: vi.fn(),
        updateTheme: vi.fn(),
        updateLanguage: vi.fn(),
        updateTextSelection: vi.fn(),
        updateTextSelectionBlacklist: vi.fn(),
        updateCustomSelectionTools: vi.fn(),
        updateImageTools: vi.fn(),
        updateImageToolsBlacklist: vi.fn(),
        updateGeneratedImageWatermarkRemoval: vi.fn(),
        updateSidebarBehavior: vi.fn(),
        updateSidePanelScope: vi.fn(),
        updateAccountIndices: vi.fn(),
        updateContextSettings: vi.fn(),
        updateConnectionSettings: vi.fn(),
        updateAppVersion: vi.fn(),
        refreshGithubMetadata: vi.fn(),
        updateMcpTestResult: vi.fn(),
        updateMcpToolsResult: vi.fn(),
        updateProviderModelsResult: vi.fn(),
        saveLogFile: vi.fn(),
        setSessionStorageHooks: vi.fn(),
    };
}

describe('StandaloneSettingsBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        globalThis.chrome = {
            runtime: {
                lastError: null,
                getManifest: vi.fn(() => ({ version: '5.0.4' })),
                sendMessage: vi.fn(() =>
                    Promise.resolve({
                        action: 'MCP_TEST_RESULT',
                        ok: true,
                        toolsCount: 2,
                    })
                ),
            },
            storage: {
                local: {
                    get: vi.fn((keys, callback) =>
                        callback({
                            geminiShortcuts: { quickAsk: 'Alt+Q' },
                            geminiTextSelectionEnabled: false,
                            geminiTextSelectionBlacklist: 'github.com',
                            geminiCustomSelectionTools: [
                                {
                                    id: 'formal',
                                    name: 'Formal',
                                    prompt: 'Rewrite: {text}',
                                    enabled: true,
                                },
                            ],
                            geminiImageToolsEnabled: false,
                            geminiGeneratedImageWatermarkRemovalEnabled: false,
                            geminiSidebarBehavior: 'restore',
                            geminiSidePanelScope: 'global',
                            geminiAccountIndices: '0,1',
                            geminiContextMode: 'recent',
                            geminiContextRecentTurns: 5,
                            geminiProvider: 'openai',
                            geminiWebTemporaryChat: true,
                            geminiOpenaiModel: 'gpt-5',
                            geminiOpenaiSelectedModel: 'gpt-5',
                        })
                    ),
                    set: vi.fn(),
                },
            },
        };
    });

    it('hands the saved chats to the settings panel and deletes the selected ones', async () => {
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);
        chrome.storage.local.get = vi.fn((keys, callback) =>
            callback({
                geminiSessions: [
                    {
                        id: 'keep',
                        title: 'Keep',
                        timestamp: 10,
                        messages: [{ role: 'user', text: 'a' }],
                    },
                    {
                        id: 'gone',
                        title: 'Gone',
                        timestamp: 20,
                        messages: [{ role: 'user', text: 'b' }],
                    },
                ],
                geminiDeletedSessionIds: {},
            })
        );
        chrome.storage.local.set = vi.fn();

        bridge.init();

        expect(controller.setSessionStorageHooks).toHaveBeenCalledTimes(1);
        const hooks = controller.setSessionStorageHooks.mock.calls[0][0];

        const report = await hooks.getSessionStorageReport();
        expect(report.totals.sessionCount).toBe(2);

        const result = await hooks.deleteSessions(['gone']);

        expect(result).toEqual({ deletedCount: 1, skippedGenerating: false });
        expect(chrome.storage.local.set).toHaveBeenCalledWith(
            expect.objectContaining({
                geminiSessions: [expect.objectContaining({ id: 'keep' })],
                geminiDeletedSessionIds: expect.objectContaining({ gone: expect.any(Number) }),
            }),
            expect.any(Function)
        );
    });

    it('downloads the log file requested from the settings panel', () => {
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);
        bridge.init();

        window.dispatchEvent(
            new MessageEvent('message', {
                source: window,
                data: {
                    action: 'DOWNLOAD_LOGS',
                    payload: { text: 'log line', filename: 'gemini-nexus-logs-1.txt' },
                },
            })
        );

        expect(downloadText).toHaveBeenCalledWith('log line', 'gemini-nexus-logs-1.txt');
    });

    it('restores settings directly from extension storage', async () => {
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        await bridge.restoreInitialState();

        expect(controller.updateShortcuts).toHaveBeenCalledWith(
            expect.objectContaining({ quickAsk: 'Alt+Q', openPanel: 'Alt+G' })
        );
        expect(controller.updateTextSelection).toHaveBeenCalledWith(false);
        expect(controller.updateTextSelectionBlacklist).toHaveBeenCalledWith('github.com');
        expect(controller.updateCustomSelectionTools).toHaveBeenCalledWith([
            {
                id: 'formal',
                name: 'Formal',
                prompt: 'Rewrite: {text}',
                enabled: true,
            },
        ]);
        expect(controller.updateImageTools).toHaveBeenCalledWith(false);
        expect(controller.updateGeneratedImageWatermarkRemoval).toHaveBeenCalledWith(false);
        expect(controller.updateSidebarBehavior).toHaveBeenCalledWith('restore');
        expect(controller.updateSidePanelScope).toHaveBeenCalledWith('global');
        expect(controller.updateContextSettings).toHaveBeenCalledWith({
            mode: 'recent',
            recentTurns: 5,
        });
        expect(controller.updateConnectionSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'openai',
                selectedModel: 'gpt-5',
                webTemporaryChat: true,
            })
        );
        expect(controller.refreshGithubMetadata).toHaveBeenCalled();
    });

    it('restores default settings when extension storage cannot be read on startup', async () => {
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            chrome.runtime.lastError = { message: 'Settings storage unavailable' };
            callback(undefined);
            chrome.runtime.lastError = null;
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        try {
            await bridge.restoreInitialState();

            expect(controller.updateShortcuts).toHaveBeenCalledWith(
                expect.objectContaining({ quickAsk: 'Alt+Q', openPanel: 'Alt+G' })
            );
            expect(controller.updateConnectionSettings).toHaveBeenCalledWith(
                expect.objectContaining({ provider: 'web' })
            );
            expect(warnSpy).toHaveBeenCalledWith(
                'Unable to restore settings from extension storage:',
                expect.any(Error)
            );
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('saves settings messages without the sidepanel iframe bridge', () => {
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: {
                action: 'SAVE_TEXT_SELECTION_BLACKLIST',
                payload: 'github.com',
            },
        });

        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            geminiTextSelectionBlacklist: 'github.com',
        });
    });

    it('logs standalone settings save failures', async () => {
        chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage quota exceeded'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        try {
            bridge.handleWindowMessage({
                source: window,
                data: {
                    action: 'SAVE_TEXT_SELECTION_BLACKLIST',
                    payload: 'github.com',
                },
            });
            await Promise.resolve();

            expect(warnSpy).toHaveBeenCalledWith(
                'Unable to save standalone settings:',
                expect.any(Error)
            );
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('saves custom selection tools without the sidepanel iframe bridge', () => {
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: {
                action: 'SAVE_CUSTOM_SELECTION_TOOLS',
                payload: [{ id: 'formal', name: 'Formal', prompt: 'Rewrite: {text}' }],
            },
        });

        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            geminiCustomSelectionTools: [
                { id: 'formal', name: 'Formal', prompt: 'Rewrite: {text}', enabled: true },
            ],
        });
    });

    it('saves generated image watermark removal without the sidepanel iframe bridge', () => {
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: {
                action: 'SAVE_GENERATED_IMAGE_WATERMARK_REMOVAL',
                payload: false,
            },
        });

        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            geminiGeneratedImageWatermarkRemovalEnabled: false,
        });
    });

    it('forwards MCP test requests and applies the response to the settings controller', async () => {
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: {
                action: 'FORWARD_TO_BACKGROUND',
                payload: { action: 'MCP_TEST_CONNECTION' },
            },
        });

        await vi.waitFor(() =>
            expect(controller.updateMcpTestResult).toHaveBeenCalledWith({
                action: 'MCP_TEST_RESULT',
                ok: true,
                toolsCount: 2,
            })
        );
    });

    it('forwards provider model-list responses to the settings controller', async () => {
        chrome.runtime.sendMessage.mockResolvedValueOnce({
            action: 'PROVIDER_MODELS_RESULT',
            ok: true,
            provider: 'openrouter',
            models: ['openai/gpt-5.2'],
        });
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: {
                action: 'FORWARD_TO_BACKGROUND',
                payload: { action: 'GET_PROVIDER_MODELS', provider: 'openrouter' },
            },
        });

        await vi.waitFor(() =>
            expect(controller.updateProviderModelsResult).toHaveBeenCalledWith({
                action: 'PROVIDER_MODELS_RESULT',
                ok: true,
                provider: 'openrouter',
                models: ['openai/gpt-5.2'],
            })
        );
    });

    it('exports settings data without API keys from the standalone settings page', async () => {
        chrome.storage.local.get.mockImplementation((keys, callback) =>
            callback({
                geminiTheme: 'dark',
                geminiApiKey: 'official-secret',
                geminiOpenaiApiKey: 'openai-secret',
                geminiMcpServers: [
                    {
                        id: 'srv',
                        headers: {
                            Authorization: 'Bearer local',
                            'X-Workspace': 'docs',
                        },
                        auth: { type: 'bearer', token: 'secret' },
                    },
                ],
            })
        );
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: { action: 'EXPORT_SETTINGS_DATA' },
        });

        await vi.waitFor(() => expect(downloadText).toHaveBeenCalled());
        const exported = JSON.parse(downloadText.mock.calls.at(-1)[0]);

        expect(exported.settings.geminiTheme).toBe('dark');
        expect(exported.settings).not.toHaveProperty('geminiApiKey');
        expect(exported.settings).not.toHaveProperty('geminiOpenaiApiKey');
        expect(exported.settings.geminiMcpServers[0].headers).toEqual({
            'X-Workspace': 'docs',
        });
        expect(exported.settings.geminiMcpServers[0].auth).toEqual({ type: 'bearer' });
    });

    it('logs export read failures without downloading partial settings data', async () => {
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            chrome.runtime.lastError = { message: 'Storage read failed' };
            callback({});
            chrome.runtime.lastError = null;
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        try {
            await expect(bridge.exportSettingsData()).resolves.toBeUndefined();

            expect(downloadText).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                'Unable to export settings data:',
                expect.any(Error)
            );
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('imports history data from the standalone settings page', async () => {
        chrome.storage.local.get.mockImplementation((keys, callback) =>
            callback({
                geminiSessions: [{ id: 'existing', messages: [{ role: 'user' }] }],
                geminiGroups: [],
                geminiDeletedSessionIds: { imported: 1 },
            })
        );
        chrome.storage.local.set.mockImplementation((update, callback) => callback?.());
        const postSpy = vi.spyOn(window, 'postMessage');
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: {
                action: 'IMPORT_HISTORY_DATA',
                payload: {
                    type: 'GeminiNexus-History',
                    history: [{ id: 'imported', messages: [{ role: 'ai' }] }],
                },
            },
        });

        await vi.waitFor(() =>
            expect(chrome.storage.local.set).toHaveBeenCalledWith(
                {
                    geminiSessions: [
                        { id: 'existing', messages: [{ role: 'user' }] },
                        { id: 'imported', messages: [{ role: 'ai' }] },
                    ],
                    geminiGroups: [],
                    geminiDeletedSessionIds: {},
                },
                expect.any(Function)
            )
        );
        expect(postSpy).toHaveBeenCalledWith(
            {
                action: 'DATA_IMPORT_RESULT',
                payload: { kind: 'history', ok: true },
            },
            '*'
        );
    });

    it('reports history import read failures instead of writing partial data', async () => {
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            chrome.runtime.lastError = { message: 'Storage read failed' };
            callback({});
            chrome.runtime.lastError = null;
        });
        const postSpy = vi.spyOn(window, 'postMessage');
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: {
                action: 'IMPORT_HISTORY_DATA',
                payload: {
                    type: 'GeminiNexus-History',
                    history: [{ id: 'imported', messages: [{ role: 'ai' }] }],
                },
            },
        });

        await vi.waitFor(() =>
            expect(postSpy).toHaveBeenCalledWith(
                {
                    action: 'DATA_IMPORT_RESULT',
                    payload: {
                        kind: 'history',
                        ok: false,
                        error: 'Storage read failed',
                    },
                },
                '*'
            )
        );
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('reports history import write failures from extension storage', async () => {
        chrome.storage.local.get.mockImplementation((keys, callback) =>
            callback({
                geminiSessions: [],
                geminiGroups: [],
                geminiDeletedSessionIds: {},
            })
        );
        chrome.storage.local.set.mockImplementation((update, callback) => {
            chrome.runtime.lastError = { message: 'Storage quota exceeded' };
            callback?.();
            chrome.runtime.lastError = null;
        });
        const postSpy = vi.spyOn(window, 'postMessage');
        const controller = createController();
        const bridge = new StandaloneSettingsBridge(controller);

        bridge.handleWindowMessage({
            source: window,
            data: {
                action: 'IMPORT_HISTORY_DATA',
                payload: {
                    type: 'GeminiNexus-History',
                    history: [{ id: 'imported', messages: [{ role: 'ai' }] }],
                },
            },
        });

        await vi.waitFor(() =>
            expect(postSpy).toHaveBeenCalledWith(
                {
                    action: 'DATA_IMPORT_RESULT',
                    payload: {
                        kind: 'history',
                        ok: false,
                        error: 'Storage quota exceeded',
                    },
                },
                '*'
            )
        );
        expect(postSpy).not.toHaveBeenCalledWith(
            {
                action: 'DATA_IMPORT_RESULT',
                payload: { kind: 'history', ok: true },
            },
            '*'
        );
    });
});
