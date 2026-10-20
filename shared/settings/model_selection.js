import { isDedicatedApiProvider } from './dedicated_providers.js';

export function parseConfiguredModels(rawModels) {
    return String(rawModels || '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean);
}

export function getConfiguredModels(settings, provider) {
    if (!settings) return [];

    if (provider === 'official') return parseConfiguredModels(settings.officialModel);
    if (provider === 'openai') return parseConfiguredModels(settings.openaiModel);
    if (isDedicatedApiProvider(provider)) {
        return parseConfiguredModels(settings.dedicatedApiProviders?.[provider]?.model);
    }
    return [];
}
