// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { GeneralSettingsTemplate } from './general.js';
import { ConnectionSettingsTemplate } from './connection.js';
import { ShortcutsSettingsTemplate } from './shortcuts.js';
import { AppearanceSettingsTemplate } from './appearance.js';
import { DataManagementSettingsTemplate } from './data_management.js';
import { AboutSettingsTemplate } from './about.js';
import { SettingsPageTemplate } from './index.js';
import { DOM_IDS, CONFIG_LIMITS } from '../../settings/constants.js';
import {
    CONTEXT_RECENT_TURNS_LIMITS,
    DEFAULT_CONTEXT_RECENT_TURNS,
} from '../../../../shared/config/constants.js';

describe('settings templates', () => {
    it('moves explanatory copy into compact help buttons', () => {
        document.body.innerHTML =
            GeneralSettingsTemplate + ConnectionSettingsTemplate + ShortcutsSettingsTemplate;

        expect(document.querySelectorAll('.setting-desc')).toHaveLength(0);
        expect(document.querySelectorAll('.setting-radio-desc')).toHaveLength(0);

        const helpButtons = [...document.querySelectorAll('.setting-help')];
        const helpKeys = helpButtons.map((button) => button.getAttribute('data-i18n-title'));

        expect(helpKeys).toEqual(
            expect.arrayContaining([
                'textSelectionDesc',
                'textSelectionBlacklistDesc',
                'imageToolsToggleDesc',
                'accountIndicesDesc',
                'contextModeDesc',
                'contextRecentTurnsDesc',
                'sidebarBehaviorAutoDesc',
                'mcpToolsDesc',
                'mcpHeadersDesc',
                'shortcutDesc',
            ])
        );
        expect(helpButtons.every((button) => button.type === 'button')).toBe(true);
        expect(helpButtons.every((button) => button.title.length > 0)).toBe(true);
    });

    it('uses hidden attributes instead of inline display styles for collapsed panels', () => {
        document.body.innerHTML = ConnectionSettingsTemplate;

        const collapsedPanels = [
            'api-key-container',
            'official-fields',
            'openai-fields',
            'mcp-fields',
        ].map((id) => document.getElementById(id));

        expect(collapsedPanels.every((panel) => panel.hidden)).toBe(true);
        expect(document.querySelectorAll('[style*="display: none"]').length).toBe(0);
    });

    it('presents Streamable HTTP as the standard transport and labels WebSocket as custom', () => {
        document.body.innerHTML = ConnectionSettingsTemplate;

        const options = [...document.querySelectorAll('#mcp-transport option')].map((option) => ({
            value: option.value,
            text: option.textContent,
        }));

        expect(options[0]).toEqual({
            value: 'streamable-http',
            text: 'Streamable HTTP',
        });
        expect(options).toContainEqual({
            value: 'ws',
            text: 'WebSocket',
        });
        expect(document.getElementById('mcp-server-url').placeholder).toBe(
            'http://127.0.0.1:3006/mcp'
        );
    });

    it('keeps MCP headers and tool exposure status visible in the server editor', () => {
        document.body.innerHTML = ConnectionSettingsTemplate;

        const headers = document.getElementById('mcp-headers');
        expect(headers).toBeTruthy();
        expect(headers.getAttribute('data-i18n-placeholder')).toBe('mcpHeadersPlaceholder');
        expect(headers.className).toContain('settings-monospace-textarea');
        expect(document.getElementById('mcp-tools-summary')).toBeTruthy();
    });

    it('keeps settings templates free of static inline styles', () => {
        document.body.innerHTML =
            GeneralSettingsTemplate +
            ConnectionSettingsTemplate +
            AppearanceSettingsTemplate +
            ShortcutsSettingsTemplate +
            DataManagementSettingsTemplate +
            AboutSettingsTemplate;

        expect(document.querySelectorAll('[style]')).toHaveLength(0);
    });

    it('keeps settings DOM id constants aligned with rendered templates', () => {
        document.body.innerHTML = SettingsPageTemplate;

        const missingIds = Object.entries(DOM_IDS)
            .filter(([, id]) => !document.getElementById(id))
            .map(([name, id]) => `${name}:${id}`);

        expect(missingIds).toEqual([]);
    });

    it('renders a polite save status region near the save action', () => {
        document.body.innerHTML = SettingsPageTemplate;

        const status = document.getElementById('settings-save-status');

        expect(status).toBeTruthy();
        expect(status.getAttribute('role')).toBe('status');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.hidden).toBe(true);
    });

    it('uses keyboard-reachable sidebar tabs for the split settings navigation', () => {
        document.body.innerHTML = SettingsPageTemplate;

        const tabs = [...document.querySelectorAll('.settings-tab')];

        expect(tabs).toHaveLength(6);
        expect(tabs.every((tab) => tab.getAttribute('role') === 'button')).toBe(true);
        expect(tabs.every((tab) => tab.getAttribute('tabindex') === '0')).toBe(true);
        expect(tabs.map((tab) => tab.dataset.tab)).toEqual([
            'connection',
            'general',
            'appearance',
            'shortcuts',
            'data',
            'about',
        ]);
    });

    it('renders data management as its own AMC-style settings tab', () => {
        document.body.innerHTML = SettingsPageTemplate;

        const dataTab = document.querySelector('.settings-tab[data-tab="data"]');
        const dataSection = document.querySelector('.settings-section[data-section="data"]');
        const cards = [...dataSection.querySelectorAll('.data-management-card')];

        expect(dataTab.querySelector('.tab-label').getAttribute('data-i18n')).toBe(
            'dataManagement'
        );
        expect(dataTab.querySelector('.tab-icon svg')).not.toBeNull();
        expect(cards).toHaveLength(3);
        expect(cards.map((card) => card.querySelector('h5').getAttribute('data-i18n'))).toEqual([
            'historyDataTitle',
            'settingsDataTitle',
            'debugLogs',
        ]);
        expect(dataSection.querySelectorAll('.data-action-btn')).toHaveLength(8);
        expect(dataSection.querySelectorAll('.data-action-icon svg').length).toBeGreaterThan(0);
        // Saved-chat cleanup starts collapsed and cannot delete before a selection.
        expect(dataSection.querySelector('#manage-sessions')).not.toBeNull();
        expect(dataSection.querySelector('#session-storage-panel').hidden).toBe(true);
        expect(dataSection.querySelector('#delete-selected-sessions').disabled).toBe(true);
        // Import overwrites local data — marked as danger actions.
        expect(
            dataSection
                .querySelector('#import-history-data')
                .classList.contains('data-action-btn-danger')
        ).toBe(true);
        expect(
            dataSection
                .querySelector('#import-settings-data')
                .classList.contains('data-action-btn-danger')
        ).toBe(true);
        expect(document.querySelector('#about-settings-group #export-history-data')).toBeNull();
        expect(
            document.getElementById('reset-shortcuts').classList.contains('btn-danger-soft')
        ).toBe(true);
    });

    it('labels the connection settings navigation item as API with a key icon', () => {
        document.body.innerHTML = SettingsPageTemplate;

        const apiTab = document.querySelector('.settings-tab[data-tab="connection"]');

        expect(apiTab.querySelector('.tab-label').textContent).toBe('API');
        expect(apiTab.querySelector('.tab-label').getAttribute('data-i18n')).toBe('apiSettings');
        expect(apiTab.querySelector('.tab-icon').innerHTML).toContain(
            'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'
        );
        expect(apiTab.querySelector('.tab-icon').innerHTML).toContain(
            '<circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle>'
        );
    });

    it('shares the recent-turns default with the app-wide setting default', () => {
        expect(CONFIG_LIMITS.RECENT_TURNS.DEFAULT).toBe(DEFAULT_CONTEXT_RECENT_TURNS);
        expect(CONFIG_LIMITS.RECENT_TURNS).toEqual(CONTEXT_RECENT_TURNS_LIMITS);
    });
});
