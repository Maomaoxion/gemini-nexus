import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    captureNewTabWatchState,
    detectNewTabsFromWatch,
    formatNewTabFollowNote,
    formatPossibleNewTabHint,
    pickMostRecentTab,
    pickPreferredNewTab,
    queryTabsInWindow,
    replaceInlinePageSnapshot,
} from './new_tab_follow.js';
import { hasInlinePageSnapshot } from './snapshot/marker.js';

describe('new_tab_follow helpers', () => {
    beforeEach(() => {
        vi.stubGlobal('chrome', {
            tabs: {
                query: vi.fn(),
                get: vi.fn(),
            },
        });
    });

    it('pickPreferredNewTab only returns opener-linked tabs', () => {
        const tabs = [
            { id: 10, openerTabId: 1 },
            { id: 12, openerTabId: 99 },
            { id: 11, openerTabId: 1 },
        ];
        expect(pickPreferredNewTab(tabs, 1).id).toBe(11);
        // No fallback to arbitrary new tabs when opener does not match.
        expect(pickPreferredNewTab(tabs, 50)).toBeNull();
        expect(pickPreferredNewTab(tabs, null)).toBeNull();
        expect(pickPreferredNewTab([], 1)).toBeNull();
    });

    it('pickMostRecentTab picks highest id for notes', () => {
        expect(pickMostRecentTab([{ id: 3 }, { id: 9 }, { id: 7 }]).id).toBe(9);
        expect(pickMostRecentTab([])).toBeNull();
    });

    it('captureNewTabWatchState records ids and opener url', async () => {
        chrome.tabs.get.mockResolvedValue({ id: 5, url: 'https://google.com/', windowId: 1 });
        chrome.tabs.query.mockResolvedValue([
            { id: 5, url: 'https://google.com/' },
            { id: 6, url: 'https://other.test/' },
        ]);

        const state = await captureNewTabWatchState({ openerTabId: 5 });
        expect(state.openerUrl).toBe('https://google.com/');
        expect(state.windowId).toBe(1);
        expect([...state.beforeIds].sort()).toEqual([5, 6]);
    });

    it('detectNewTabsFromWatch finds opener-linked tab and stops early', async () => {
        chrome.tabs.get.mockResolvedValue({ id: 5, url: 'https://google.com/search' });
        chrome.tabs.query
            .mockResolvedValueOnce([{ id: 5 }, { id: 9, openerTabId: 5, url: 'https://ms.com/' }])
            .mockResolvedValue([]);

        const result = await detectNewTabsFromWatch(
            {
                beforeIds: new Set([5]),
                openerTabId: 5,
                windowId: 1,
                openerUrl: 'https://google.com/search',
            },
            { sleep: async () => {}, maxPolls: 5, pollMs: 0 }
        );

        expect(result.preferred?.id).toBe(9);
        expect(result.openerNavigated).toBe(false);
        expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
    });

    it('detectNewTabsFromWatch does not prefer untrusted new tabs', async () => {
        chrome.tabs.get.mockResolvedValue({ id: 5, url: 'https://google.com/search' });
        chrome.tabs.query.mockResolvedValue([
            { id: 5 },
            { id: 20, openerTabId: 999, url: 'https://ads.test/' },
        ]);

        const result = await detectNewTabsFromWatch(
            {
                beforeIds: new Set([5]),
                openerTabId: 5,
                windowId: 1,
                openerUrl: 'https://google.com/search',
            },
            { sleep: async () => {}, maxPolls: 4, pollMs: 0 }
        );

        expect(result.preferred).toBeNull();
        expect(result.newTabs.map((t) => t.id)).toContain(20);
    });

    it('detectNewTabsFromWatch marks same-tab navigation', async () => {
        chrome.tabs.get.mockResolvedValue({
            id: 5,
            url: 'https://www.microsoft.com/download',
        });
        chrome.tabs.query.mockResolvedValue([{ id: 5 }]);

        const result = await detectNewTabsFromWatch(
            {
                beforeIds: new Set([5]),
                openerTabId: 5,
                windowId: 1,
                openerUrl: 'https://google.com/search',
            },
            { sleep: async () => {}, maxPolls: 2, pollMs: 0 }
        );

        expect(result.openerNavigated).toBe(true);
        expect(result.preferred).toBeNull();
    });

    it('formats follow notes for the model', () => {
        const note = formatNewTabFollowNote(
            { title: 'Download Windows 11', url: 'https://microsoft.com/x' },
            { autoSwitched: true }
        );
        expect(note).toContain('## New tab detected');
        expect(note).toContain('auto-switched');
        expect(
            formatNewTabFollowNote({ title: 'x', url: 'https://x' }, { autoSwitched: false })
        ).toContain('not auto-switched');
        expect(
            formatNewTabFollowNote({ title: 'x', url: 'https://x' }, { attachFailed: true })
        ).toContain('not controllable');
        expect(formatPossibleNewTabHint()).toContain('list_pages');
    });

    it('replaceInlinePageSnapshot replaces or appends the snapshot block', () => {
        const withSnap =
            'Completed 2 steps.\nStep 1 (click): ok\n\n## Latest page snapshot\nuid=1_1 old';
        const replaced = replaceInlinePageSnapshot(withSnap, 'uid=9_9 new');
        expect(replaced).toContain('uid=9_9 new');
        expect(replaced).not.toContain('uid=1_1 old');
        expect(hasInlinePageSnapshot(replaced)).toBe(true);

        const appended = replaceInlinePageSnapshot('Clicked.', 'uid=2_2');
        expect(appended).toContain('## Latest page snapshot');
        expect(appended).toContain('uid=2_2');
    });

    it('queryTabsInWindow scopes by window when provided', async () => {
        chrome.tabs.query.mockResolvedValue([]);
        await queryTabsInWindow(42);
        expect(chrome.tabs.query).toHaveBeenCalledWith({ windowId: 42 });
        await queryTabsInWindow(null);
        expect(chrome.tabs.query).toHaveBeenLastCalledWith({});
    });
});
