// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function installPageGuard(url) {
    vi.resetModules();
    window.history.replaceState({}, '', url);
    delete window.GeminiNexusPageGuard;

    await import('./page_guard.js');

    return window.GeminiNexusPageGuard;
}

describe('Gemini Nexus page guard', () => {
    beforeEach(() => {
        delete window.GeminiNexusPageGuard;
    });

    it('disables content scripts on MHTML archive URLs', async () => {
        const guard = await installPageGuard('/Users/jones/Downloads/saved-page.mhtml');

        expect(guard.isDisabled).toBe(true);
        expect(guard.reason).toBe('mhtml');
    });

    it('recognizes local uppercase MHT archive URLs', async () => {
        const guard = await installPageGuard('/article');

        expect(guard.isMhtmlArchiveUrl('file:///Users/jones/Downloads/SAVED-PAGE.MHT')).toBe(true);
    });

    it('allows ordinary web pages', async () => {
        const guard = await installPageGuard('/article');

        expect(guard.isDisabled).toBe(false);
        expect(guard.reason).toBeNull();
    });

    it('validates extension context correctly', async () => {
        const guard = await installPageGuard('/article');

        // When chrome is undefined
        const originalChrome = globalThis.chrome;
        try {
            delete globalThis.chrome;
            expect(guard.isContextValid()).toBe(true);

            // When chrome.runtime has an active id
            globalThis.chrome = {
                runtime: {
                    id: 'active-ext-id',
                    getURL: (path) => `chrome-extension://active-ext-id/${path}`,
                },
            };
            expect(guard.isContextValid()).toBe(true);
            expect(guard.safeGetURL('logo.png')).toBe('chrome-extension://active-ext-id/logo.png');

            // When chrome.runtime is invalidated (id is undefined)
            globalThis.chrome = {
                runtime: {
                    id: undefined,
                    getURL: () => {
                        throw new Error('Extension context invalidated.');
                    },
                },
            };
            expect(guard.isContextValid()).toBe(false);
            expect(guard.safeGetURL('logo.png')).toBe('');
        } finally {
            if (originalChrome) {
                globalThis.chrome = originalChrome;
            } else {
                delete globalThis.chrome;
            }
        }
    });
});
