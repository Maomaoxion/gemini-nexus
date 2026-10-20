import { respondWithUiTask } from './ui_async.js';
import { resolveContextWindow } from '../managers/session/context_window_resolver.js';

export function handleContextWindow(request, sendResponse) {
    const provider = String(request.provider || '').trim();
    const model = String(request.model || '').trim();

    respondWithUiTask(
        sendResponse,
        async () => {
            if (!provider || !model) {
                throw new Error('Provider and model are required.');
            }
            if (provider === 'web') {
                throw new Error('Context length detection is not available for Gemini Web.');
            }

            const result = await resolveContextWindow({
                provider,
                model,
                baseUrl: request.baseUrl,
                apiKey: request.apiKey,
                force: request.force === true,
                settings: { contextWindowAuto: true },
            });

            return {
                action: 'CONTEXT_WINDOW_RESULT',
                ok: true,
                provider,
                model,
                tokens: result.tokens,
                source: result.source,
                diagnostics: result.diagnostics || null,
            };
        },
        {
            errorResponse: (error) => ({
                action: 'CONTEXT_WINDOW_RESULT',
                ok: false,
                provider,
                model,
                error: error.message || String(error),
            }),
        }
    );
}
