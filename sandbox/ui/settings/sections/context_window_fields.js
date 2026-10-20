import { normalizeContextWindowTokens } from '../../../../shared/models/context_window.js';
import {
    getFirstConfiguredModelForProvider,
    getProviderConnectionSettings,
} from '../../../../shared/settings/connection.js';
import { isDedicatedApiProvider } from '../../../../shared/settings/dedicated_providers.js';
import { DEFAULT_PROVIDER } from '../../../../shared/config/constants.js';
import { formatT, t } from '../../../core/i18n.js';

function setStatus(section, text, isError = false) {
    const status = section.elements.contextWindowStatus;
    if (!status) return;
    status.textContent = text || '';
    status.hidden = !text;
    status.classList.toggle('is-error', isError);
}

export function applyContextSettings(section, settings) {
    const input = section.elements.contextWindowTokens;
    if (!input) return;

    const isAuto = settings?.windowAuto !== false;
    const tokens = normalizeContextWindowTokens(settings?.windowTokens, 0);
    input.value = !isAuto && tokens > 0 ? String(tokens) : '';
    input.placeholder = t('contextWindowAutoPlaceholder');
    setStatus(section, '');
}

export function applyContextWindowFallback(section) {
    setStatus(section, t('contextWindowDetectFailed'), true);
}

export function applyContextWindowResult(section, { tokens, source, diagnostics } = {}) {
    const input = section.elements.contextWindowTokens;
    if (!input) return;

    const formatted = new Intl.NumberFormat().format(normalizeContextWindowTokens(tokens, 0));
    input.placeholder =
        source === 'api' || source === 'catalog'
            ? formatT('contextWindowDetectedPlaceholder', { tokens: formatted })
            : formatT('contextWindowDetectedFallbackPlaceholder', { tokens: formatted });

    if ((input.value || '').trim()) {
        setStatus(section, formatT('contextWindowManualValue', { tokens: input.value.trim() }));
        return;
    }

    if (source === 'api') {
        setStatus(section, formatT('contextWindowApiResult', { tokens: formatted }));
        return;
    }

    if (source === 'catalog') {
        setStatus(section, formatT('contextWindowCatalogResult', { tokens: formatted }));
        return;
    }

    const fields = Array.isArray(diagnostics?.fields)
        ? diagnostics.fields.filter(Boolean).join(', ')
        : '';
    if (diagnostics?.reason === 'no-context-field' && fields) {
        setStatus(
            section,
            formatT('contextWindowMissingFields', { fields, tokens: formatted }),
            true
        );
        return;
    }
    if (diagnostics?.reason === 'request-failed') {
        setStatus(section, formatT('contextWindowApiFailed', { tokens: formatted }), true);
        return;
    }
    setStatus(section, formatT('contextWindowFallbackResult', { tokens: formatted }), true);
}

/**
 * The context window is detected from the first model in the active
 * provider's configured list, using the values currently in the form.
 */
export function buildContextWindowRequest(section) {
    const provider =
        section.elements.providerSelect?.value || section.activeProvider || DEFAULT_PROVIDER;
    if (provider === 'web') return null;

    let dedicatedProviderSettings = null;
    if (isDedicatedApiProvider(provider)) {
        section._saveDedicatedApiProviderEdits(provider);
        dedicatedProviderSettings = {
            ...(section.dedicatedApiProviders?.[provider] || {}),
            baseUrl: section.elements.dedicatedApiBaseUrl?.value.trim() || '',
            apiKey: section.elements.dedicatedApiKey?.value.trim() || '',
            model: section.elements.dedicatedApiModel?.value || '',
        };
    }

    const settings = {
        officialBaseUrl: section.elements.officialBaseUrl?.value.trim() || '',
        apiKey: section.elements.apiKeyInput?.value.trim() || '',
        officialModel: section.elements.officialModel?.value || '',
        openaiBaseUrl: section.elements.openaiBaseUrl?.value.trim() || '',
        openaiApiKey: section.elements.openaiApiKey?.value.trim() || '',
        openaiModel: section.elements.openaiModel?.value || '',
        dedicatedApiProviders: dedicatedProviderSettings
            ? { [provider]: dedicatedProviderSettings }
            : {},
    };

    const model = getFirstConfiguredModelForProvider(provider, settings);
    if (!model) return null;

    const { baseUrl, apiKey } = getProviderConnectionSettings(provider, settings);
    return { provider, model, baseUrl, apiKey };
}
