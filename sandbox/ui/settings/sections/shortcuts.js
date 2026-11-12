import { getSettingsElement } from '../dom.js';

function getShortcutKey(event) {
    const code = typeof event.code === 'string' ? event.code : '';
    const letterMatch = code.match(/^Key([A-Z])$/i);
    if (letterMatch) return letterMatch[1].toUpperCase();

    const digitMatch = code.match(/^Digit([0-9])$/);
    if (digitMatch) return digitMatch[1];

    let normalizedKey = event.key.toUpperCase();
    if (normalizedKey === ' ') normalizedKey = 'Space';
    return normalizedKey;
}

export class ShortcutsSection {
    constructor() {
        this.elements = {};
        this.queryElements();
        this.bindEvents();
    }

    queryElements() {
        this.elements = {
            inputQuickAsk: getSettingsElement('shortcut-quick-ask'),
            inputOpenPanel: getSettingsElement('shortcut-open-panel'),
            inputBrowserControl: getSettingsElement('shortcut-browser-control'),
            inputOcrCapture: getSettingsElement('shortcut-ocr-capture'),
            inputSnipCapture: getSettingsElement('shortcut-snip-capture'),
        };
    }

    bindEvents() {
        this.setupShortcutInput(this.elements.inputQuickAsk);
        this.setupShortcutInput(this.elements.inputOpenPanel);
        this.setupShortcutInput(this.elements.inputBrowserControl);
        this.setupShortcutInput(this.elements.inputOcrCapture);
        this.setupShortcutInput(this.elements.inputSnipCapture);
    }

    setupShortcutInput(inputEl) {
        if (!inputEl) return;
        inputEl.addEventListener('keydown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Backspace' || event.key === 'Delete') {
                inputEl.value = '';
                return;
            }
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

            const keys = [];
            if (event.ctrlKey) keys.push('Ctrl');
            if (event.altKey) keys.push('Alt');
            if (event.shiftKey) keys.push('Shift');
            if (event.metaKey) keys.push('Meta');

            keys.push(getShortcutKey(event));

            inputEl.value = keys.join('+');
        });
    }

    setData(shortcuts) {
        if (this.elements.inputQuickAsk) this.elements.inputQuickAsk.value = shortcuts.quickAsk;
        if (this.elements.inputOpenPanel) this.elements.inputOpenPanel.value = shortcuts.openPanel;
        if (this.elements.inputBrowserControl) {
            this.elements.inputBrowserControl.value = shortcuts.browserControl;
        }
        if (this.elements.inputOcrCapture) {
            this.elements.inputOcrCapture.value = shortcuts.ocrCapture;
        }
        if (this.elements.inputSnipCapture) {
            this.elements.inputSnipCapture.value = shortcuts.snipCapture;
        }
    }

    getData() {
        const {
            inputQuickAsk,
            inputOpenPanel,
            inputBrowserControl,
            inputOcrCapture,
            inputSnipCapture,
        } = this.elements;
        return {
            quickAsk: inputQuickAsk ? inputQuickAsk.value : '',
            openPanel: inputOpenPanel ? inputOpenPanel.value : '',
            browserControl: inputBrowserControl ? inputBrowserControl.value : '',
            ocrCapture: inputOcrCapture ? inputOcrCapture.value : '',
            snipCapture: inputSnipCapture ? inputSnipCapture.value : '',
        };
    }
}
