// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsController } from './index.js';
import { SettingsModalTemplate } from '../templates/settings/index.js';

vi.mock('../../../shared/messaging/index.js', () => ({
    requestAccountIndicesFromStorage: vi.fn(),
    requestConnectionSettingsFromStorage: vi.fn(),
    requestCustomSelectionToolsFromStorage: vi.fn(),
    requestContextSettingsFromStorage: vi.fn(),
    requestGeneratedImageWatermarkRemovalFromStorage: vi.fn(),
    requestImageToolsFromStorage: vi.fn(),
    requestImageToolsBlacklistFromStorage: vi.fn(),
    requestTextSelectionBlacklistFromStorage: vi.fn(),
    requestTextSelectionFromStorage: vi.fn(),
    exportHistoryData: vi.fn(),
    importHistoryData: vi.fn(),
    exportSettingsData: vi.fn(),
    importSettingsData: vi.fn(),
    saveAccountIndicesToStorage: vi.fn(),
    saveConnectionSettingsToStorage: vi.fn(),
    saveCustomSelectionToolsToStorage: vi.fn(),
    saveContextSettingsToStorage: vi.fn(),
    saveGeneratedImageWatermarkRemovalToStorage: vi.fn(),
    saveImageToolsToStorage: vi.fn(),
    saveImageToolsBlacklistToStorage: vi.fn(),
    saveLanguageToStorage: vi.fn(),
    saveShortcutsToStorage: vi.fn(),
    saveSidebarBehaviorToStorage: vi.fn(),
    saveSidePanelScopeToStorage: vi.fn(),
    saveTextSelectionBlacklistToStorage: vi.fn(),
    saveTextSelectionToStorage: vi.fn(),
    saveThemeToStorage: vi.fn(),
    sendToBackground: vi.fn(),
}));

describe('SettingsController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.matchMedia = vi.fn(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
        document.body.innerHTML = `
            <button id="settings-btn"></button>
            ${SettingsModalTemplate}
        `;
    });

    it('does not open the sidepanel settings modal when the sidebar settings button is clicked', () => {
        new SettingsController();

        document.getElementById('settings-btn').click();

        expect(document.getElementById('settings-modal').classList.contains('visible')).toBe(false);
    });

    it('shows the chat storage totals when the settings modal opens', async () => {
        const controller = new SettingsController();
        controller.setSessionStorageHooks({
            getSessionStorageReport: () => ({
                sessions: [
                    {
                        id: 'session-1',
                        title: 'Chat',
                        messageCount: 3,
                        bytes: 2048,
                        imageBytes: 0,
                        updatedAt: 1,
                    },
                ],
                totals: { sessionCount: 1, messageCount: 3, totalBytes: 2048, imageBytes: 0 },
                now: 1,
            }),
        });

        controller.open();

        await vi.waitFor(() => {
            const summary = document.getElementById('session-storage-summary').textContent;
            expect(summary).toContain('1');
            expect(summary).toContain('KB');
        });
    });

    it('cleans account indices before saving and reflects the saved value in the form', async () => {
        const { saveAccountIndicesToStorage } = await import('../../../shared/messaging/index.js');
        const controller = new SettingsController();
        const formData = controller.view.getFormData();
        formData.accountIndices = '0, abc, 2';

        controller.saveSettings(formData);

        expect(saveAccountIndicesToStorage).toHaveBeenCalledWith('0,2');
        expect(document.getElementById('account-indices-input').value).toBe('0,2');
    });

    it('saves the image tools blacklist and the watermark preference from the form', async () => {
        const { saveImageToolsBlacklistToStorage, saveGeneratedImageWatermarkRemovalToStorage } =
            await import('../../../shared/messaging/index.js');
        const controller = new SettingsController();

        document.getElementById('image-tools-blacklist').value = 'github.com\n*.google.com';
        document.getElementById('generated-image-watermark-toggle').checked = false;

        controller.saveSettings(controller.view.getFormData());

        expect(saveImageToolsBlacklistToStorage).toHaveBeenCalledWith('github.com\n*.google.com');
        expect(saveGeneratedImageWatermarkRemovalToStorage).toHaveBeenCalledWith(false);
    });

    it('keeps settings open and shows saved feedback after saving', async () => {
        vi.useFakeTimers();
        try {
            const { saveConnectionSettingsToStorage } =
                await import('../../../shared/messaging/index.js');
            const controller = new SettingsController();
            controller.open();

            document.getElementById('save-shortcuts').click();

            expect(saveConnectionSettingsToStorage).toHaveBeenCalled();
            expect(document.getElementById('settings-modal').classList.contains('visible')).toBe(
                true
            );
            expect(document.getElementById('settings-save-status').hidden).toBe(false);
            expect(document.getElementById('settings-save-status').textContent).toBe('Saved');
            expect(document.getElementById('save-shortcuts').disabled).toBe(true);

            vi.advanceTimersByTime(1800);

            expect(document.getElementById('settings-save-status').hidden).toBe(true);
            expect(document.getElementById('save-shortcuts').disabled).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cleans custom selection tools before saving and reflects the saved list', async () => {
        const { saveCustomSelectionToolsToStorage } =
            await import('../../../shared/messaging/index.js');
        const controller = new SettingsController();
        const formData = controller.view.getFormData();
        formData.customSelectionTools = [
            {
                id: 'formal',
                name: ' Formal ',
                prompt: 'Rewrite: {text}',
                enabled: true,
            },
            {
                id: 'empty',
                name: 'Empty',
                prompt: '',
                enabled: true,
            },
        ];

        controller.saveSettings(formData);

        expect(saveCustomSelectionToolsToStorage).toHaveBeenCalledWith([
            {
                id: 'formal',
                name: 'Formal',
                prompt: 'Rewrite: {text}',
                enabled: true,
            },
        ]);
        expect(document.querySelectorAll('.custom-selection-tool-row')).toHaveLength(1);
        expect(document.querySelector('.custom-selection-tool-name').value).toBe('Formal');
    });

    it('restores default shortcuts when stored shortcut settings are cleared', () => {
        const controller = new SettingsController();

        controller.updateShortcuts({ openPanel: 'Ctrl+O' });
        expect(document.getElementById('shortcut-open-panel').value).toBe('Ctrl+O');

        controller.updateShortcuts(null);

        expect(document.getElementById('shortcut-quick-ask').value).toBe('Alt+Q');
        expect(document.getElementById('shortcut-open-panel').value).toBe('Alt+G');
        expect(document.getElementById('shortcut-browser-control').value).toBe('Alt+Shift+B');
        expect(document.getElementById('shortcut-ocr-capture').value).toBe('Alt+O');
        expect(document.getElementById('shortcut-snip-capture').value).toBe('Alt+S');
    });
});
