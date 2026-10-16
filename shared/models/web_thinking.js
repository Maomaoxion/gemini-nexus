import './web_model_catalog.js';
import './web_thinking_global.js';

const webThinking = globalThis.GeminiNexusWebThinking;

export const DEFAULT_WEB_THINKING_LEVEL = webThinking.DEFAULT_WEB_THINKING_LEVEL;
export const WEB_NATIVE_THINKING_LEVELS = webThinking.WEB_NATIVE_THINKING_LEVELS;
export function normalizeWebThinkingLevel(level, fallback = DEFAULT_WEB_THINKING_LEVEL) {
    return webThinking.normalizeWebThinkingLevel(level, fallback);
}

export function supportsWebThinking(model) {
    return webThinking.supportsWebThinking(model);
}

// The global already normalises the model's fast level with a 'low' fallback.
export function getWebThinkingFastLevel(model) {
    return webThinking.getWebThinkingFastLevel(model);
}

export function normalizeWebThinkingLevelForModel(
    model,
    level,
    fallback = DEFAULT_WEB_THINKING_LEVEL
) {
    return webThinking.normalizeWebThinkingLevelForModel(model, level, fallback);
}

export function getNextWebThinkingLevel(model, currentLevel) {
    return webThinking.getNextWebThinkingLevel(model, currentLevel);
}

export function getWebNativeThinkingLevel(model, level) {
    return webThinking.getWebNativeThinkingLevel(model, level);
}
