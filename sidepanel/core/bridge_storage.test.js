// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreSidePanelInputDrafts, saveSidePanelInputDraft } from './bridge_storage.js';

function createSessionStorage() {
    let store = {};
    return {
        get(keys, callback) {
            const result = {};
            for (const key of keys) {
                if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
            }
            callback(result);
        },
        set(value) {
            store = { ...store, ...value };
            return Promise.resolve();
        },
        snapshot: () => store,
    };
}

describe('side panel input draft storage', () => {
    let storage;

    beforeEach(() => {
        storage = createSessionStorage();
        globalThis.chrome = {
            runtime: { lastError: null },
            storage: { session: storage },
        };
    });

    it('saves drafts keyed by tab', () => {
        saveSidePanelInputDraft({ tabId: 5, value: { text: 'hi', files: [] } });

        expect(storage.snapshot().geminiSidePanelInputDrafts).toEqual({
            'draft:5': { text: 'hi', files: [], tabs: [] },
        });
    });

    it('removes the entry when the draft is emptied', () => {
        saveSidePanelInputDraft({ tabId: 5, value: { text: 'hi', files: [] } });
        saveSidePanelInputDraft({ tabId: 5, value: { text: '', files: [] } });

        expect(storage.snapshot().geminiSidePanelInputDrafts).toEqual({});
    });

    it('keeps drafts of other tabs untouched', () => {
        saveSidePanelInputDraft({ tabId: 1, value: { text: 'one', files: [] } });
        saveSidePanelInputDraft({ tabId: 2, value: { text: 'two', files: [] } });

        expect(storage.snapshot().geminiSidePanelInputDrafts).toEqual({
            'draft:1': { text: 'one', files: [], tabs: [] },
            'draft:2': { text: 'two', files: [], tabs: [] },
        });
    });

    it('keeps referenced tabs in the stored draft', () => {
        saveSidePanelInputDraft({
            tabId: 8,
            value: {
                text: '',
                files: [],
                tabs: [{ id: 2, title: 'Docs', url: 'https://docs.test/' }],
            },
        });

        expect(storage.snapshot().geminiSidePanelInputDrafts).toEqual({
            'draft:8': {
                text: '',
                files: [],
                tabs: [{ id: 2, title: 'Docs', url: 'https://docs.test/', favIconUrl: '' }],
            },
        });
    });

    it('restores normalized drafts into the frame', () => {
        saveSidePanelInputDraft({ tabId: 3, value: { text: 'restored', files: [] } });
        const frame = { postMessage: vi.fn() };

        restoreSidePanelInputDrafts(frame);

        expect(frame.postMessage).toHaveBeenCalledWith({
            action: 'RESTORE_INPUT_DRAFTS',
            payload: { 'draft:3': { text: 'restored', files: [], tabs: [] } },
        });
    });

    it('skips writes when the storage read fails', () => {
        globalThis.chrome.runtime.lastError = { message: 'boom' };

        saveSidePanelInputDraft({ tabId: 5, value: { text: 'hi' } });

        expect(storage.snapshot()).toEqual({});
    });
});
