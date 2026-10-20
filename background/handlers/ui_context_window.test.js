import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleContextWindow } from './ui_context_window.js';
import { resolveContextWindow } from '../managers/session/context_window_resolver.js';

vi.mock('../managers/session/context_window_resolver.js', () => ({
    resolveContextWindow: vi.fn(),
}));

function callHandler(request) {
    return new Promise((resolve) => {
        handleContextWindow(request, resolve);
    });
}

describe('context window handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveContextWindow.mockResolvedValue({ tokens: 200000, source: 'api' });
    });

    it('returns the detected context window for the active model', async () => {
        const response = await callHandler({
            provider: 'official',
            model: 'gemini-4-argon',
            baseUrl: 'https://api.test',
            apiKey: 'key',
        });

        expect(resolveContextWindow).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'official',
                model: 'gemini-4-argon',
                baseUrl: 'https://api.test',
                apiKey: 'key',
            })
        );
        expect(response).toMatchObject({
            action: 'CONTEXT_WINDOW_RESULT',
            ok: true,
            provider: 'official',
            model: 'gemini-4-argon',
            tokens: 200000,
            source: 'api',
        });
    });

    it('rejects missing provider/model and web requests', async () => {
        const missing = await callHandler({ provider: 'official' });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain('required');

        const web = await callHandler({ provider: 'web', model: 'web-model' });
        expect(web.ok).toBe(false);
        expect(web.error).toContain('Gemini Web');
        expect(resolveContextWindow).not.toHaveBeenCalled();
    });
});
