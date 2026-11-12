(function () {
    window.GeminiShortcuts?.destroy?.();
    if (window.GeminiNexusPageGuard?.isDisabled) {
        delete window.GeminiShortcuts;
        return;
    }

    // shared/config/constants_global.js is listed before this file in the same
    // manifest content_scripts entry, so the shortcut defaults and their
    // migration live there rather than being re-declared here.
    const nexusConfig = globalThis.GeminiNexusConfig;
    const MODIFIER_KEYS = ['ctrl', 'alt', 'shift', 'meta', 'command'];

    function isShortcutObject(shortcuts) {
        return shortcuts && typeof shortcuts === 'object' && !Array.isArray(shortcuts);
    }

    function normalizeShortcuts(shortcuts) {
        return nexusConfig.normalizeShortcutDefaults(shortcuts);
    }

    function needsShortcutMigration(stored, normalized) {
        if (!isShortcutObject(stored)) return false;
        return (
            Object.keys(normalized).some(
                (key) =>
                    Object.prototype.hasOwnProperty.call(stored, key) &&
                    stored[key] !== normalized[key]
            ) || !Object.prototype.hasOwnProperty.call(stored, 'snipCapture')
        );
    }

    function persistShortcutMigration(stored, normalized) {
        if (!needsShortcutMigration(stored, normalized)) return;

        try {
            const result = chrome.storage.local.set({ geminiShortcuts: normalized });
            result?.catch?.((error) => {
                console.warn('Failed to migrate Gemini Nexus shortcuts:', error?.message || error);
            });
        } catch (error) {
            console.warn('Failed to migrate Gemini Nexus shortcuts:', error?.message || error);
        }
    }

    function getStorageReadError() {
        return chrome.runtime?.lastError?.message || null;
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

    function getCodeKey(event) {
        if (typeof event?.code !== 'string') return '';
        const letterMatch = event.code.match(/^Key([A-Z])$/i);
        if (letterMatch) return letterMatch[1].toLowerCase();
        const digitMatch = event.code.match(/^Digit([0-9])$/);
        if (digitMatch) return digitMatch[1];
        return '';
    }

    function isContextValid() {
        if (window.GeminiNexusPageGuard?.isContextValid) {
            return window.GeminiNexusPageGuard.isContextValid();
        }
        try {
            if (typeof chrome === 'undefined' || !chrome.runtime) return true;
            if ('id' in chrome.runtime && !chrome.runtime.id) {
                return false;
            }
            return true;
        } catch {
            return false;
        }
    }

    function sendRuntimeMessage(message, onError = null) {
        if (!isContextValid()) return;
        try {
            const result = chrome.runtime.sendMessage(message);
            result
                ?.then?.((response) => {
                    if (response?.status === 'error' && typeof onError === 'function') {
                        onError(response.error || 'Gemini Nexus shortcut failed');
                    }
                })
                ?.catch?.((error) => {
                    if (typeof onError === 'function') {
                        onError(error?.message || 'Gemini Nexus shortcut failed');
                    }
                });
        } catch (error) {
            if (typeof onError === 'function') {
                onError(error?.message || 'Gemini Nexus shortcut failed');
            }
        }
    }

    class ShortcutManager {
        constructor() {
            this.appShortcuts = {};
            this.toolbarController = null;
            this.handleStorageChange = this.handleStorageChange.bind(this);
            this.handleDocumentKeydown = (event) => this.handleKeydown(event);
            this.init();
        }

        setController(controller) {
            this.toolbarController = controller;
        }

        init() {
            chrome.storage.local.get(['geminiShortcuts'], (result) => {
                const errorMessage = getStorageReadError();
                if (errorMessage) {
                    console.warn('Failed to load Gemini Nexus shortcuts:', errorMessage);
                } else {
                    this.appShortcuts = normalizeShortcuts(result?.geminiShortcuts);
                    persistShortcutMigration(result?.geminiShortcuts, this.appShortcuts);
                }
            });

            chrome.storage.onChanged.addListener(this.handleStorageChange);

            document.addEventListener('keydown', this.handleDocumentKeydown, true);
        }

        handleStorageChange(changes, area) {
            if (!isContextValid()) {
                this.destroy();
                return;
            }
            if (area === 'local' && changes.geminiShortcuts) {
                this.appShortcuts = normalizeShortcuts(changes.geminiShortcuts.newValue);
                persistShortcutMigration(changes.geminiShortcuts.newValue, this.appShortcuts);
            }
        }

        destroy() {
            document.removeEventListener('keydown', this.handleDocumentKeydown, true);
            chrome.storage?.onChanged?.removeListener?.(this.handleStorageChange);
            this.toolbarController = null;
        }

        handleKeydown(event) {
            if (!isContextValid()) {
                this.destroy();
                return;
            }
            const isEditableTarget = isEditableShortcutTarget(event.target);
            if (isEditableTarget) return;

            if (this.match(event, this.appShortcuts?.quickAsk)) {
                event.preventDefault();
                event.stopPropagation();
                if (this.toolbarController) {
                    this.toolbarController.showGlobalInput();
                } else {
                    sendRuntimeMessage({ action: 'SHOW_QUICK_ASK_FROM_SHORTCUT' });
                }
                return;
            }

            if (this.match(event, this.appShortcuts?.ocrCapture)) {
                event.preventDefault();
                event.stopPropagation();
                sendRuntimeMessage(
                    {
                        action: 'START_AREA_OCR_FROM_SHORTCUT',
                        mode: 'ocr',
                        source: 'local',
                    },
                    (message) =>
                        this.toolbarController?.showExtensionError?.(
                            message || 'Could not start OCR capture'
                        )
                );
                return;
            }

            if (this.match(event, this.appShortcuts?.snipCapture)) {
                event.preventDefault();
                event.stopPropagation();
                sendRuntimeMessage(
                    {
                        action: 'START_SNIP_FROM_SHORTCUT',
                        mode: 'snip',
                        source: 'local',
                    },
                    (message) =>
                        this.toolbarController?.showExtensionError?.(
                            message || 'Could not start screenshot capture'
                        )
                );
                return;
            }

            if (this.match(event, this.appShortcuts?.openPanel)) {
                event.preventDefault();
                event.stopPropagation();
                sendRuntimeMessage({ action: 'TOGGLE_SIDE_PANEL' }, (error) => {
                    this.toolbarController?.showExtensionError?.(
                        error || 'Could not open side panel'
                    );
                });
                return;
            }

            if (this.match(event, this.appShortcuts?.browserControl)) {
                event.preventDefault();
                event.stopPropagation();
                sendRuntimeMessage({ action: 'TOGGLE_SIDE_PANEL_CONTROL' }, (error) => {
                    this.toolbarController?.showExtensionError?.(
                        error || 'Could not start browser control'
                    );
                });
                return;
            }
        }

        match(event, shortcutString) {
            if (!shortcutString || typeof shortcutString !== 'string') return false;
            if (!event || typeof event.key !== 'string') return false;
            if (event.isComposing) return false;

            const parts = shortcutString.split('+').map((part) => part.trim().toLowerCase());
            const key = event.key.toLowerCase();

            const hasCtrl = parts.includes('ctrl');
            const hasAlt = parts.includes('alt');
            const hasShift = parts.includes('shift');
            const hasMeta = parts.includes('meta') || parts.includes('command');

            if (event.ctrlKey !== hasCtrl) return false;
            if (event.altKey !== hasAlt) return false;
            if (event.shiftKey !== hasShift) return false;
            if (event.metaKey !== hasMeta) return false;

            const mainKeys = parts.filter((part) => !MODIFIER_KEYS.includes(part));
            if (mainKeys.length !== 1) return false;

            const mainKey = mainKeys[0];
            return key === mainKey || getCodeKey(event) === mainKey;
        }
    }

    window.GeminiShortcuts = new ShortcutManager();
})();
