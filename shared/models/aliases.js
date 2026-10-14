/**
 * Model ID aliases for the Gemini Official API.
 * Externalized so model renames don't require code changes.
 */
const OFFICIAL_MODEL_ALIASES = Object.freeze({});

/**
 * Resolve a model alias to its canonical Official API model ID.
 */
export function normalizeOfficialModelId(model) {
    return OFFICIAL_MODEL_ALIASES[model] ?? model;
}
