import { createSettingsHelpButton } from './help_button.js';

export const ShortcutsSettingsTemplate = `
    <div class="setting-group">
        <h4><span data-i18n="keyboardShortcuts">Keyboard Shortcuts</span>${createSettingsHelpButton('shortcutDesc')}</h4>

        <div class="setting-panel">
            <div class="setting-shortcut-list">
                <div class="setting-shortcut-row">
                    <span class="setting-shortcut-title" data-i18n="quickAsk">Quick Ask</span>
                    <input type="text" id="shortcut-quick-ask" class="shortcut-input" readonly value="Alt+Q">
                </div>

                <div class="setting-shortcut-row">
                    <span class="setting-shortcut-title" data-i18n="openSidePanel">Side Panel</span>
                    <input type="text" id="shortcut-open-panel" class="shortcut-input" readonly value="Alt+G">
                </div>

                <div class="setting-shortcut-row">
                    <span class="setting-shortcut-title" data-i18n="shortcutBrowserControl">Browser Control</span>
                    <input type="text" id="shortcut-browser-control" class="shortcut-input" readonly value="Alt+Shift+B">
                </div>

                <div class="setting-shortcut-row">
                    <span class="setting-shortcut-title" data-i18n="shortcutOcrCapture">Area OCR</span>
                    <input type="text" id="shortcut-ocr-capture" class="shortcut-input" readonly value="Alt+O">
                </div>

                <div class="setting-shortcut-row">
                    <span class="setting-shortcut-title" data-i18n="shortcutSnipCapture">Screenshot Ask</span>
                    <input type="text" id="shortcut-snip-capture" class="shortcut-input" readonly value="Alt+S">
                </div>

                <div class="setting-shortcut-row setting-shortcut-static-row">
                    <span class="setting-shortcut-title" data-i18n="shortcutFocusInput">Focus Input</span>
                    <input type="text" class="shortcut-input" readonly value="Ctrl+P">
                </div>

                <div class="setting-shortcut-row setting-shortcut-static-row">
                    <span class="setting-shortcut-title" data-i18n="shortcutSwitchModel">Switch Model</span>
                    <input type="text" class="shortcut-input" readonly value="Ctrl+M">
                </div>

                <div class="setting-shortcut-row setting-shortcut-static-row">
                    <span class="setting-shortcut-title" data-i18n="shortcutNewChat">New Chat</span>
                    <input type="text" class="shortcut-input" readonly value="Alt+N">
                </div>

                <div class="setting-shortcut-row setting-shortcut-static-row">
                    <span class="setting-shortcut-title" data-i18n="shortcutToggleThinking">Toggle Thinking</span>
                    <input type="text" class="shortcut-input" readonly value="Alt+T">
                </div>

                <div class="setting-shortcut-row setting-shortcut-static-row">
                    <span class="setting-shortcut-title" data-i18n="shortcutToggleHistory">Toggle History Sidebar</span>
                    <input type="text" class="shortcut-input" readonly value="Alt+H">
                </div>
            </div>
        </div>
    </div>`;
