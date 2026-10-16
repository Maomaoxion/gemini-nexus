(function () {
    window.GeminiNexusShortcutFrameBridgeReady = true;
    window.GeminiNexusShortcutFrameBridge?.destroy?.();

    // This bridge runs as its own `all_frames: true` / `document_start`
    // content_scripts entry, while shared/config/constants_global.js is loaded
    // by the main bundle (`all_frames: false`, `document_end`). So
    // globalThis.GeminiNexusConfig is not reliably available here and these
    // defaults must stay self-contained. Keep them in sync with
    // shared/config/constants_global.js when changing a shortcut default.
    const DEFAULT_SHORTCUTS = Object.freeze({
        quickAsk: 'Alt+Q',
        openPanel: 'Alt+G',
        browserControl: 'Alt+Shift+B',
        ocrCapture: 'Alt+O',
        snipCapture: 'Alt+S',
    });
    const LEGACY_DEFAULT_SHORTCUTS = Object.freeze([
        Object.freeze({
            quickAsk: 'Alt+Q',
            openPanel: 'Alt+G',
            browserControl: 'Alt+Shift+B',
            ocrCapture: 'Alt+O',
        }),
        Object.freeze({
            quickAsk: 'Alt+Q',
            openPanel: 'Alt+G',
            browserControl: 'Ctrl+B',
            ocrCapture: 'Alt+O',
        }),
        Object.freeze({
            quickAsk: 'Ctrl+Q',
            openPanel: 'Alt+G',
            browserControl: 'Ctrl+B',
            ocrCapture: 'Alt+O',
        }),
        Object.freeze({
            quickAsk: 'Ctrl+G',
            openPanel: 'Alt+S',
            browserControl: 'Ctrl+B',
            ocrCapture: 'Alt+O',
        }),
    ]);
    const SHORTCUT_KEYS = Object.freeze(Object.keys(DEFAULT_SHORTCUTS));
    const MODIFIER_KEYS = ['ctrl', 'alt', 'shift', 'meta', 'command'];

    function isShortcutObject(shortcuts) {
        return shortcuts && typeof shortcuts === 'object' && !Array.isArray(shortcuts);
    }

    function isDefaultShortcutValue(key, value) {
        return (
            value === DEFAULT_SHORTCUTS[key] ||
            LEGACY_DEFAULT_SHORTCUTS.some((shortcuts) => value === shortcuts[key])
        );
    }

    function normalizeDefaultShortcutValue(key, value) {
        return isDefaultShortcutValue(key, value) ? DEFAULT_SHORTCUTS[key] : value;
    }

    function normalizeShortcutDefaults(shortcuts) {
        const stored = isShortcutObject(shortcuts) ? shortcuts : {};
        const usesOnlyDefaultValues = SHORTCUT_KEYS.every((key) => {
            if (!Object.prototype.hasOwnProperty.call(stored, key)) return true;
            return isDefaultShortcutValue(key, stored[key]);
        });
        const migrated = { ...stored };

        if (usesOnlyDefaultValues) {
            SHORTCUT_KEYS.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(migrated, key)) {
                    migrated[key] = normalizeDefaultShortcutValue(key, migrated[key]);
                }
            });
        }

        return { ...DEFAULT_SHORTCUTS, ...migrated };
    }

    function getStorageReadError() {
        return chrome.runtime?.lastError?.message || null;
    }

    function getCodeKey(event) {
        if (typeof event?.code !== 'string') return '';
        const letterMatch = event.code.match(/^Key([A-Z])$/i);
        if (letterMatch) return letterMatch[1].toLowerCase();
        const digitMatch = event.code.match(/^Digit([0-9])$/);
        if (digitMatch) return digitMatch[1];
        return '';
    }

    function matchShortcut(event, shortcutString) {
        if (!shortcutString || typeof shortcutString !== 'string') return false;
        if (!event || typeof event.key !== 'string') return false;

        const parts = shortcutString.split('+').map((part) => part.trim().toLowerCase());
        const key = event.key.toLowerCase();

        if (event.ctrlKey !== parts.includes('ctrl')) return false;
        if (event.altKey !== parts.includes('alt')) return false;
        if (event.shiftKey !== parts.includes('shift')) return false;
        if (event.metaKey !== (parts.includes('meta') || parts.includes('command'))) return false;

        const mainKeys = parts.filter((part) => !MODIFIER_KEYS.includes(part));
        if (mainKeys.length !== 1) return false;

        const mainKey = mainKeys[0];
        return key === mainKey || getCodeKey(event) === mainKey;
    }

    function isEditableShortcutTarget(target) {
        if (!(target instanceof Element)) return false;
        if (target.isContentEditable) return true;
        if (
            target.closest?.(
                '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
            )
        ) {
            return true;
        }
        const tagName = target.tagName.toLowerCase();
        return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    }

    function sendRuntimeMessage(message) {
        try {
            const result = chrome.runtime.sendMessage(message);
            result?.catch?.(() => {});
        } catch {
            // 静默忽略:消息发送失败时接收方可能已销毁,无法记录
        }
    }

    class ShortcutFrameBridge {
        constructor() {
            this.appShortcuts = {};
            this.chromeCommandShortcuts = {};
            this.handleStorageChange = this.handleStorageChange.bind(this);
            this.handleDocumentKeydown = (event) => this.handleKeydown(event);
            this.boundRefreshChromeCommandShortcuts = this.refreshChromeCommandShortcuts.bind(this);
            this.init();
        }

        init() {
            chrome.storage.local.get(['geminiShortcuts'], (result) => {
                const errorMessage = getStorageReadError();
                if (errorMessage) {
                    console.warn('Failed to load Gemini Nexus frame shortcuts:', errorMessage);
                    return;
                }

                this.appShortcuts = normalizeShortcutDefaults(result?.geminiShortcuts);
                this.refreshChromeCommandShortcuts();
            });

            chrome.storage.onChanged.addListener(this.handleStorageChange);
            window.addEventListener('focus', this.boundRefreshChromeCommandShortcuts);
            window.addEventListener('keydown', this.handleDocumentKeydown, true);
            document.addEventListener('keydown', this.handleDocumentKeydown, true);
        }

        async refreshChromeCommandShortcuts() {
            try {
                if (!chrome.commands?.getAll) return;
                const commands = await chrome.commands.getAll();
                const mapping = {
                    quickAsk: null,
                    openPanel: null,
                    ocrCapture: null,
                    browserControl: null,
                };
                for (const command of commands) {
                    const shortcut = command.shortcut;
                    if (!shortcut) continue;
                    if (command.name === 'quick-ask') mapping.quickAsk = shortcut;
                    else if (command.name === 'area-ocr') mapping.ocrCapture = shortcut;
                    else if (command.name === '_execute_action') mapping.openPanel = shortcut;
                    else if (command.name === 'browser-control') mapping.browserControl = shortcut;
                }
                this.chromeCommandShortcuts = mapping;
            } catch {
                // 静默降级
            }
        }

        effectiveShortcut(action) {
            const chromeManaged = this.chromeCommandShortcuts?.[action];
            if (chromeManaged) return chromeManaged;
            return this.appShortcuts[action];
        }

        destroy() {
            window.removeEventListener('keydown', this.handleDocumentKeydown, true);
            document.removeEventListener('keydown', this.handleDocumentKeydown, true);
            window.removeEventListener('focus', this.boundRefreshChromeCommandShortcuts);
            chrome.storage?.onChanged?.removeListener?.(this.handleStorageChange);
        }

        handleStorageChange(changes, area) {
            if (area === 'local' && changes.geminiShortcuts) {
                this.appShortcuts = normalizeShortcutDefaults(changes.geminiShortcuts.newValue);
            }
        }

        handleKeydown(event) {
            if (isEditableShortcutTarget(event.target)) return;

            if (matchShortcut(event, this.effectiveShortcut('quickAsk'))) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                sendRuntimeMessage({ action: 'SHOW_QUICK_ASK_FROM_SHORTCUT' });
                return;
            }

            if (matchShortcut(event, this.effectiveShortcut('ocrCapture'))) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                sendRuntimeMessage({
                    action: 'START_AREA_OCR_FROM_SHORTCUT',
                    mode: 'ocr',
                    source: 'local',
                });
                return;
            }

            if (matchShortcut(event, this.effectiveShortcut('snipCapture'))) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                sendRuntimeMessage({
                    action: 'START_SNIP_FROM_SHORTCUT',
                    mode: 'snip',
                    source: 'local',
                });
                return;
            }

            if (matchShortcut(event, this.effectiveShortcut('openPanel'))) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                sendRuntimeMessage({ action: 'TOGGLE_SIDE_PANEL' });
                return;
            }

            if (matchShortcut(event, this.effectiveShortcut('browserControl'))) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                sendRuntimeMessage({ action: 'TOGGLE_SIDE_PANEL_CONTROL' });
                return;
            }
        }
    }

    window.GeminiNexusShortcutFrameBridge = new ShortcutFrameBridge();
})();
