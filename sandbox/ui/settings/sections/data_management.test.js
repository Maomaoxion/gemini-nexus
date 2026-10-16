// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataManagementSection } from './data_management.js';
import { DataManagementSettingsTemplate } from '../../templates/settings/data_management.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function createReport(overrides = {}) {
    const now = Date.now();
    return {
        sessions: [
            {
                id: 'big-chat',
                title: 'Big chat',
                messageCount: 12,
                bytes: 3 * 1024 * 1024,
                imageBytes: 1024 * 1024,
                updatedAt: now,
            },
            {
                id: 'small-chat',
                title: '',
                messageCount: 2,
                bytes: 2048,
                imageBytes: 0,
                updatedAt: now,
            },
        ],
        totals: {
            sessionCount: 2,
            messageCount: 14,
            totalBytes: 3 * 1024 * 1024 + 2048,
            imageBytes: 1024 * 1024,
        },
        now,
        ...overrides,
    };
}

function createSection(callbacks = {}) {
    document.body.innerHTML = `<div id="settings-modal" class="settings-modal visible">${DataManagementSettingsTemplate}</div>`;
    const section = new DataManagementSection(callbacks);
    section.setSessionStorageReport(createReport());
    return section;
}

function getPanel() {
    return document.getElementById('session-storage-panel');
}

describe('DataManagementSection chat storage', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'confirm',
            vi.fn(() => true)
        );
        vi.stubGlobal('alert', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('shows totals for the saved chats', () => {
        createSection();

        const summary = document.getElementById('session-storage-summary').textContent;
        expect(summary).toContain('2');
        expect(summary).toContain('MB');
    });

    it('opens the manager, asks for a fresh report and lists chats by size', () => {
        const onRequestSessionStorageReport = vi.fn();
        createSection({ onRequestSessionStorageReport });

        document.getElementById('manage-sessions').click();

        expect(onRequestSessionStorageReport).toHaveBeenCalledTimes(1);
        expect(getPanel().hidden).toBe(false);
        expect(document.getElementById('manage-sessions').getAttribute('aria-expanded')).toBe(
            'true'
        );

        const rows = document.querySelectorAll('.session-storage-row');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('Big chat');
        expect(rows[1].textContent).toContain('New Chat');
    });

    it('deletes the selected chats after confirmation', async () => {
        const onDeleteSessions = vi.fn(() => ({ deletedCount: 2, skippedGenerating: false }));
        const section = createSection({ onDeleteSessions });

        document.getElementById('manage-sessions').click();
        document.getElementById('session-storage-select-all').checked = true;
        document.getElementById('session-storage-select-all').dispatchEvent(new Event('change'));
        expect(document.getElementById('delete-selected-sessions').disabled).toBe(false);

        document.getElementById('delete-selected-sessions').click();
        await vi.waitFor(() => expect(onDeleteSessions).toHaveBeenCalledTimes(1));

        expect(onDeleteSessions).toHaveBeenCalledWith(['big-chat', 'small-chat']);
        expect(section.getSelectedSessionIds()).toEqual([]);

        await vi.waitFor(() =>
            expect(document.getElementById('session-storage-status').textContent).toContain('2')
        );
    });

    it('keeps the chats when the confirmation is declined', () => {
        const onDeleteSessions = vi.fn();
        globalThis.confirm.mockReturnValue(false);
        createSection({ onDeleteSessions });

        document.getElementById('manage-sessions').click();
        document.getElementById('session-storage-select-all').checked = true;
        document.getElementById('session-storage-select-all').dispatchEvent(new Event('change'));
        document.getElementById('delete-selected-sessions').click();

        expect(onDeleteSessions).not.toHaveBeenCalled();
    });

    it('cleans up only chats inactive for more than 90 days', async () => {
        const onDeleteSessions = vi.fn(() => ({ deletedCount: 1, skippedGenerating: false }));
        const section = createSection({ onDeleteSessions });
        section.setSessionStorageReport(
            createReport({
                sessions: [
                    {
                        id: 'stale-chat',
                        title: 'Old chat',
                        messageCount: 4,
                        bytes: 1024,
                        imageBytes: 0,
                        updatedAt: Date.now() - 120 * DAY_MS,
                    },
                    {
                        id: 'recent-chat',
                        title: 'Recent',
                        messageCount: 4,
                        bytes: 1024,
                        imageBytes: 0,
                        updatedAt: Date.now() - DAY_MS,
                    },
                ],
                totals: { sessionCount: 2, messageCount: 8, totalBytes: 2048, imageBytes: 0 },
            })
        );

        document.getElementById('manage-sessions').click();
        document.getElementById('cleanup-old-sessions').click();

        await vi.waitFor(() => expect(onDeleteSessions).toHaveBeenCalledTimes(1));
        expect(onDeleteSessions).toHaveBeenCalledWith(['stale-chat']);
    });

    it('reports when the running chat was kept', async () => {
        const onDeleteSessions = vi.fn(() => ({ deletedCount: 1, skippedGenerating: true }));
        createSection({ onDeleteSessions });

        document.getElementById('manage-sessions').click();
        const firstRowCheckbox = document.querySelector('.session-storage-row-check');
        firstRowCheckbox.checked = true;
        firstRowCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

        document.getElementById('delete-selected-sessions').click();

        await vi.waitFor(() => expect(onDeleteSessions).toHaveBeenCalledWith(['big-chat']));
        await vi.waitFor(() =>
            expect(document.getElementById('session-storage-status').textContent).toContain(
                'generating'
            )
        );
    });
});
