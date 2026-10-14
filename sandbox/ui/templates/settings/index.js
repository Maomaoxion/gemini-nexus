import { ConnectionSettingsTemplate } from './connection.js';
import { GeneralSettingsTemplate } from './general.js';
import { AppearanceSettingsTemplate } from './appearance.js';
import { ShortcutsSettingsTemplate } from './shortcuts.js';
import { DataManagementSettingsTemplate } from './data_management.js';
import { AboutSettingsTemplate } from './about.js';
import { TemplateIcons } from '../icons.js';

const SettingsContentTemplate = `
    <div class="settings-content split-layout">
        <div class="settings-sidebar">
            <div class="settings-sidebar-header">
                <h3 data-i18n="settingsTitle">Settings</h3>
            </div>
            <ul class="settings-tabs">
                <li class="settings-tab active" data-tab="connection" role="button" tabindex="0" aria-selected="true">
                    <span class="tab-icon">${TemplateIcons.KEY}</span>
                    <span class="tab-label" data-i18n="apiSettings">API</span>
                </li>
                <li class="settings-tab" data-tab="general" role="button" tabindex="0" aria-selected="false">
                    <span class="tab-icon">${TemplateIcons.SETTINGS}</span>
                    <span class="tab-label" data-i18n="general">General</span>
                </li>
                <li class="settings-tab" data-tab="appearance" role="button" tabindex="0" aria-selected="false">
                    <span class="tab-icon">${TemplateIcons.LAYOUT_PANEL_LEFT}</span>
                    <span class="tab-label" data-i18n="appearance">Appearance</span>
                </li>
                <li class="settings-tab" data-tab="shortcuts" role="button" tabindex="0" aria-selected="false">
                    <span class="tab-icon">${TemplateIcons.COMMAND}</span>
                    <span class="tab-label" data-i18n="keyboardShortcuts">Shortcuts</span>
                </li>
                <li class="settings-tab" data-tab="data" role="button" tabindex="0" aria-selected="false">
                    <span class="tab-icon">${TemplateIcons.DATABASE}</span>
                    <span class="tab-label" data-i18n="dataManagement">Data Management</span>
                </li>
                <li class="settings-tab" data-tab="about" role="button" tabindex="0" aria-selected="false">
                    <span class="tab-icon">${TemplateIcons.INFO}</span>
                    <span class="tab-label" data-i18n="about">About</span>
                </li>
            </ul>
        </div>
        <div class="settings-main">
            <div class="settings-header">
                <h3 id="settings-tab-title" data-i18n="apiSettings">API</h3>
                <div class="settings-header-actions">
                    <button id="reset-shortcuts" class="btn-secondary btn-danger-soft" data-i18n="resetDefault">Reset Default</button>
                    <button id="save-shortcuts" class="btn-primary" data-i18n="saveChanges">Save Changes</button>
                    <span id="settings-save-status" class="settings-save-status" role="status" aria-live="polite" hidden></span>
                    <button id="close-settings" class="icon-btn small" data-i18n-title="close" title="Close">${TemplateIcons.CLOSE}</button>
                </div>
            </div>
            <div class="settings-body">
                <div class="settings-section active" data-section="connection">
                    ${ConnectionSettingsTemplate}
                </div>
                <div class="settings-section" data-section="general">
                    ${GeneralSettingsTemplate}
                </div>
                <div class="settings-section" data-section="appearance">
                    ${AppearanceSettingsTemplate}
                </div>
                <div class="settings-section" data-section="shortcuts">
                    ${ShortcutsSettingsTemplate}
                </div>
                <div class="settings-section" data-section="data">
                    ${DataManagementSettingsTemplate}
                </div>
                <div class="settings-section" data-section="about">
                    ${AboutSettingsTemplate}
                </div>
            </div>
        </div>
    </div>
`;

export const SettingsPageTemplate = `
    <main id="settings-modal" class="settings-page visible">
        ${SettingsContentTemplate}
    </main>
`;

export const SettingsModalTemplate = `
    <div id="settings-modal" class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-tab-title">
        ${SettingsContentTemplate}
    </div>
`;
