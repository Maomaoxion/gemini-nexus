import {
    getDedicatedApiProviderConfig,
    isDedicatedApiProvider,
} from '../../../../shared/settings/dedicated_providers.js';

export function saveDedicatedApiProviderEdits(section, provider = section.activeProvider) {
    if (!isDedicatedApiProvider(provider)) return;

    const config = getDedicatedApiProviderConfig(provider);
    const {
        dedicatedApiBaseUrl,
        dedicatedApiKey,
        dedicatedApiModel,
        dedicatedApiWebSearch,
        dedicatedApiProviderRouting,
    } = section.elements;
    const previous = section.dedicatedApiProviders[provider] || { provider };
    section.dedicatedApiProviders[provider] = {
        ...previous,
        provider,
        baseUrl: dedicatedApiBaseUrl ? dedicatedApiBaseUrl.value.trim() : previous.baseUrl,
        apiKey: dedicatedApiKey ? dedicatedApiKey.value.trim() : previous.apiKey,
        model: dedicatedApiModel ? dedicatedApiModel.value.trim() : previous.model,
        webSearch: dedicatedApiWebSearch
            ? dedicatedApiWebSearch.checked === true
            : previous.webSearch === true,
        providerRouting:
            config?.supportsProviderRouting === true && dedicatedApiProviderRouting
                ? dedicatedApiProviderRouting.value.trim()
                : previous.providerRouting || '',
    };
}

export function loadDedicatedApiProviderIntoForm(section, provider) {
    if (!isDedicatedApiProvider(provider)) return;

    const config = getDedicatedApiProviderConfig(provider);
    const settings = section.dedicatedApiProviders[provider] || {};
    const {
        dedicatedApiBaseUrl,
        dedicatedApiKey,
        dedicatedApiModel,
        dedicatedApiRefreshModels,
        dedicatedApiModelListStatus,
        dedicatedApiWebSearchRow,
        dedicatedApiWebSearch,
        dedicatedApiProviderRoutingRow,
        dedicatedApiProviderRouting,
    } = section.elements;

    if (dedicatedApiBaseUrl) {
        dedicatedApiBaseUrl.placeholder = config.defaultBaseUrl || '';
        dedicatedApiBaseUrl.value = settings.baseUrl || config.defaultBaseUrl || '';
    }
    if (dedicatedApiKey) dedicatedApiKey.value = settings.apiKey || '';
    if (dedicatedApiModel) {
        dedicatedApiModel.placeholder = config.defaultModels || '';
        dedicatedApiModel.value = settings.model || config.defaultModels || '';
    }
    if (dedicatedApiRefreshModels) {
        dedicatedApiRefreshModels.hidden = false;
        dedicatedApiRefreshModels.disabled = false;
    }
    if (dedicatedApiModelListStatus) {
        dedicatedApiModelListStatus.hidden = true;
        dedicatedApiModelListStatus.textContent = '';
        dedicatedApiModelListStatus.classList.remove('is-error');
    }
    if (dedicatedApiWebSearchRow) {
        dedicatedApiWebSearchRow.hidden = config.supportsWebSearch !== true;
    }
    if (dedicatedApiWebSearch) {
        dedicatedApiWebSearch.checked = settings.webSearch === true;
    }
    if (dedicatedApiProviderRoutingRow) {
        dedicatedApiProviderRoutingRow.hidden = config.supportsProviderRouting !== true;
    }
    if (dedicatedApiProviderRouting) {
        dedicatedApiProviderRouting.placeholder = config.providerRoutingPlaceholder || '{}';
        dedicatedApiProviderRouting.value = settings.providerRouting || '';
    }
}
