import { isDedicatedApiProvider } from '../../../../shared/settings/dedicated_providers.js';

export function applyProviderVisibility(section, provider) {
    const { apiKeyContainer, webFields, officialFields, openaiFields, dedicatedApiFields } =
        section.elements;
    if (!apiKeyContainer) return;

    if (webFields) webFields.hidden = provider !== 'web';
    if (officialFields) officialFields.hidden = provider !== 'official';
    if (openaiFields) openaiFields.hidden = provider !== 'openai';
    if (dedicatedApiFields) dedicatedApiFields.hidden = !isDedicatedApiProvider(provider);
    if (provider === 'web') {
        apiKeyContainer.hidden = true;
    } else {
        apiKeyContainer.hidden = false;
        if (isDedicatedApiProvider(provider)) section._loadDedicatedApiProviderIntoForm(provider);
    }
    section.activeProvider = provider;
}
