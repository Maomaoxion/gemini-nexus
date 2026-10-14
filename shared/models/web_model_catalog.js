(function () {
    // Web model hashes verified against Gemini Web reverse catalogs (Gemi2Api-Server 2026-07-22
    // custom_models examples + free/Plus otAQ7b mode ids) and live Gemini Web requests.
    // Labels follow the public GA lineup.
    const DEFAULT_WEB_MODEL = '56fdd199312815e2';

    const WEB_MODEL_OPTIONS = Object.freeze(
        [
            { value: '56fdd199312815e2', label: '3.8 Flash' },
            { value: 'cf41b0e0dd7d53e5', label: '3.5 Flash-Lite' },
            { value: '95a4c0abcba24364', label: '4 Argon' },
        ].map((option) => Object.freeze(option))
    );

    const LEGACY_WEB_MODEL_ALIASES = Object.freeze({
        'gemini-4-argon': '95a4c0abcba24364',
        'gemini-4': '95a4c0abcba24364',
        '4-argon': '95a4c0abcba24364',
        'gemini-3.8-flash': '56fdd199312815e2',
        'gemini-3.7-flash': '56fdd199312815e2',
        'gemini-3.5-flash-lite': 'cf41b0e0dd7d53e5',
        '8c46e95b1a07cecc': 'cf41b0e0dd7d53e5',
    });

    const WEB_MODEL_HEADER_CONFIGS = Object.freeze({
        // Gemini 3.8 Flash: GA Flash lineup on Gemini Web.
        '56fdd199312815e2': Object.freeze({
            hash: '56fdd199312815e2',
            // The live request uses different legacy and native mode fields.
            legacyMode: 2,
            mode: 1,
            capabilities: Object.freeze([4, 5, 6, 8, 4, 5, 6, 8]),
            fastThinkingLevel: 'minimal',
        }),
        // Current free-tier / GA Flash-Lite (Gemini 3.5 Flash-Lite).
        cf41b0e0dd7d53e5: Object.freeze({
            hash: 'cf41b0e0dd7d53e5',
            mode: 6,
            fastThinkingLevel: 'minimal',
        }),
        // Gemini 4 Argon: Complex tasks and deep reasoning.
        '95a4c0abcba24364': Object.freeze({
            hash: '95a4c0abcba24364',
            mode: 8,
            fastThinkingLevel: 'minimal',
        }),
    });

    function normalizeWebModel(model) {
        const normalized = String(model || DEFAULT_WEB_MODEL).trim();
        return LEGACY_WEB_MODEL_ALIASES[normalized] || normalized;
    }

    function createWebModelOptions() {
        return WEB_MODEL_OPTIONS.map((option) => ({ ...option }));
    }

    function createWebModelOptionMarkup() {
        return WEB_MODEL_OPTIONS.map(
            (option) => `<option value="${option.value}">${option.label}</option>`
        ).join('');
    }

    function getWebModelHeaderConfig(model) {
        const normalized = normalizeWebModel(model);
        const config = WEB_MODEL_HEADER_CONFIGS[normalized];
        return config ? { ...config } : null;
    }

    function getSupportedWebModelValues() {
        return Object.keys(WEB_MODEL_HEADER_CONFIGS);
    }

    globalThis.GeminiNexusWebModelCatalog = Object.freeze({
        DEFAULT_WEB_MODEL,
        createWebModelOptions,
        createWebModelOptionMarkup,
        getSupportedWebModelValues,
        getWebModelHeaderConfig,
    });
})();
