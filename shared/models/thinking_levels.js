import { DEFAULT_THINKING_LEVEL, DEDICATED_API_PROVIDERS } from '../config/constants.js';
import {
    getDedicatedApiStorageKeys,
    isDedicatedApiProvider,
} from '../settings/dedicated_providers.js';
import { normalizeWebThinkingLevel, supportsWebThinking } from './web_thinking.js';

const OFFICIAL_THINKING_LEVELS = Object.freeze(['auto', 'low', 'medium', 'high']);
const CUSTOM_OPENAI_THINKING_LEVELS = Object.freeze([
    'auto',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
]);

// Providers whose API exposes a plain on/off switch: every enabled level means
// the same thing, so the picker only offers two states.
const TOGGLE_STYLE_PROVIDERS = new Set(['dashscope', 'zhipu']);

function createDedicatedThinkingAdapter(provider) {
    const config = DEDICATED_API_PROVIDERS?.[provider];
    const levels =
        Array.isArray(config?.thinkingLevels) && config.thinkingLevels.length > 0
            ? config.thinkingLevels
            : CUSTOM_OPENAI_THINKING_LEVELS;

    return {
        getLevels: () => [...levels],
        read: (settings) =>
            settings.dedicatedApiProviders?.[provider]?.thinkingLevel || DEFAULT_THINKING_LEVEL,
        write: (settings, level) => {
            const providers = settings.dedicatedApiProviders || {};
            const current = providers[provider] || { provider };
            settings.dedicatedApiProviders = {
                ...providers,
                [provider]: { ...current, thinkingLevel: level },
            };
            return true;
        },
        storageKey: getDedicatedApiStorageKeys(provider)?.thinkingLevel || null,
    };
}

const THINKING_LEVEL_ADAPTERS = {
    web: {
        getLevels: (model) => (supportsWebThinking(model) ? ['low', 'high'] : []),
        read: (settings) => normalizeWebThinkingLevel(settings.webThinkingLevel),
        write: (settings, level) => {
            settings.webThinkingLevel = level;
            return true;
        },
        storageKey: 'geminiWebThinkingLevel',
    },
    official: {
        getLevels: () => [...OFFICIAL_THINKING_LEVELS],
        read: (settings) => settings.thinkingLevel || DEFAULT_THINKING_LEVEL,
        write: (settings, level) => {
            settings.thinkingLevel = level;
            return true;
        },
        storageKey: 'geminiThinkingLevel',
    },
    openai: {
        getLevels: () => [...CUSTOM_OPENAI_THINKING_LEVELS],
        read: (settings) => settings.openaiThinkingLevel || DEFAULT_THINKING_LEVEL,
        write: (settings, level) => {
            settings.openaiThinkingLevel = level;
            return true;
        },
        storageKey: 'geminiOpenaiThinkingLevel',
    },
};

function getThinkingLevelAdapter(provider) {
    return (
        THINKING_LEVEL_ADAPTERS[provider] ||
        (isDedicatedApiProvider(provider) ? createDedicatedThinkingAdapter(provider) : null)
    );
}

/** Levels the active provider/model can actually accept, in display order. */
export function getProviderThinkingLevels(provider, model = '') {
    return getThinkingLevelAdapter(provider)?.getLevels(model) || [];
}

/** Current level for a provider, read from a connection-settings object. */
export function getProviderThinkingLevel(settings, provider) {
    if (!settings) return DEFAULT_THINKING_LEVEL;
    return getThinkingLevelAdapter(provider)?.read(settings) || DEFAULT_THINKING_LEVEL;
}

/** Store a level back into an in-memory connection-settings object. */
export function setProviderThinkingLevel(settings, provider, level) {
    if (!settings) return false;
    return getThinkingLevelAdapter(provider)?.write(settings, level) === true;
}

/**
 * Clamp a requested level to what this provider accepts. Providers differ:
 * Gemini tops out at "high", Anthropic adds xhigh/max, toggle-style providers
 * collapse every enabled level onto one value.
 */
export function normalizeThinkingLevelForProvider(provider, model, level) {
    const levels = getProviderThinkingLevels(provider, model);
    if (levels.length === 0) return null;

    const normalized = String(level || '')
        .trim()
        .toLowerCase();

    if (TOGGLE_STYLE_PROVIDERS.has(provider)) {
        if (normalized === 'auto') return 'auto';
        return normalized === 'off' ? 'off' : 'on';
    }

    if (provider === 'web') {
        return ['medium', 'high', 'xhigh', 'max'].includes(normalized) ? 'high' : 'low';
    }

    if (levels.includes(normalized)) return normalized;

    const fallback = String(DEFAULT_THINKING_LEVEL).trim();
    return levels.includes(fallback) ? fallback : levels[0];
}

export function getThinkingLevelStorageKey(provider) {
    return getThinkingLevelAdapter(provider)?.storageKey || null;
}
