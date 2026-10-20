import { respondWithUiTask } from './ui_async.js';
import { fetchProviderModelEntries } from '../../services/providers/model_catalog.js';

export function handleProviderModelList(request, sendResponse) {
    const provider = String(request.provider || '').trim();

    respondWithUiTask(
        sendResponse,
        async () => {
            const entries = await fetchProviderModelEntries({
                provider,
                baseUrl: request.baseUrl,
                apiKey: request.apiKey,
            });
            const modelIds = [...new Set(entries.map((entry) => entry.id))].sort((left, right) =>
                left.localeCompare(right)
            );

            if (modelIds.length === 0) {
                throw new Error('No models returned.');
            }

            return {
                action: 'PROVIDER_MODELS_RESULT',
                ok: true,
                provider,
                models: modelIds,
                modelText: modelIds.join(', '),
            };
        },
        {
            errorResponse: (error) => ({
                action: 'PROVIDER_MODELS_RESULT',
                ok: false,
                provider,
                models: [],
                modelText: '',
                error: error.message || String(error),
            }),
        }
    );
}
