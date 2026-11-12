// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { ShortcutsSettingsTemplate } from '../../templates/settings/shortcuts.js';
import { ShortcutsSection } from './shortcuts.js';

describe('ShortcutsSection', () => {
    beforeEach(() => {
        document.body.innerHTML = ShortcutsSettingsTemplate;
    });

    it('restores and saves the OCR and snip capture shortcuts', () => {
        const section = new ShortcutsSection();

        section.setData({
            quickAsk: 'Alt+Q',
            openPanel: 'Alt+G',
            browserControl: 'Ctrl+B',
            ocrCapture: 'Ctrl+Shift+O',
            snipCapture: 'Ctrl+Shift+S',
        });

        expect(document.getElementById('shortcut-ocr-capture').value).toBe('Ctrl+Shift+O');
        expect(document.getElementById('shortcut-snip-capture').value).toBe('Ctrl+Shift+S');
        expect(section.getData()).toEqual({
            quickAsk: 'Alt+Q',
            openPanel: 'Alt+G',
            browserControl: 'Ctrl+B',
            ocrCapture: 'Ctrl+Shift+O',
            snipCapture: 'Ctrl+Shift+S',
        });
    });

    it('records option-modified letter shortcuts by physical key', () => {
        new ShortcutsSection();

        const input = document.getElementById('shortcut-quick-ask');
        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'œ',
                code: 'KeyQ',
                altKey: true,
                bubbles: true,
                cancelable: true,
            })
        );

        expect(input.value).toBe('Alt+Q');
    });

    it('clears a shortcut with Backspace or Delete', () => {
        const section = new ShortcutsSection();
        section.setData({
            quickAsk: 'Alt+Q',
            openPanel: 'Alt+G',
            browserControl: 'Alt+Shift+B',
            ocrCapture: 'Alt+O',
            snipCapture: 'Alt+S',
        });

        const quickAsk = document.getElementById('shortcut-quick-ask');
        quickAsk.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Backspace',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(quickAsk.value).toBe('');
        expect(section.getData().quickAsk).toBe('');

        const openPanel = document.getElementById('shortcut-open-panel');
        openPanel.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Delete',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(openPanel.value).toBe('');
    });

    it('keeps cleared shortcuts empty instead of restoring defaults', () => {
        const section = new ShortcutsSection();

        section.setData({
            quickAsk: '',
            openPanel: '',
            browserControl: '',
            ocrCapture: '',
            snipCapture: '',
        });

        expect(document.getElementById('shortcut-browser-control').value).toBe('');
        expect(document.getElementById('shortcut-ocr-capture').value).toBe('');
        expect(document.getElementById('shortcut-snip-capture').value).toBe('');
        expect(section.getData()).toEqual({
            quickAsk: '',
            openPanel: '',
            browserControl: '',
            ocrCapture: '',
            snipCapture: '',
        });
    });

    it('renders informative static rows for built-in application hotkeys', () => {
        const staticRows = document.querySelectorAll('.setting-shortcut-static-row');
        const shortcuts = Array.from(staticRows).map((row) => ({
            i18nKey: row.querySelector('.setting-shortcut-title')?.getAttribute('data-i18n'),
            value: row.querySelector('.shortcut-input')?.value,
        }));

        expect(shortcuts).toEqual([
            { i18nKey: 'shortcutFocusInput', value: 'Ctrl+P' },
            { i18nKey: 'shortcutSwitchModel', value: 'Ctrl+M' },
            { i18nKey: 'shortcutNewChat', value: 'Alt+N' },
            { i18nKey: 'shortcutToggleThinking', value: 'Alt+T' },
            { i18nKey: 'shortcutToggleHistory', value: 'Alt+H' },
        ]);
    });
});
