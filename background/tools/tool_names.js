/**
 * Tool-name helpers derived from the schema definitions in tool_schemas.js.
 * Kept free of other imports so control-layer modules can use it without
 * pulling in the MCP schema dependencies.
 */

/**
 * Builds the set of tool names declared by a schema list.
 * @param {Array<{ name?: string }>} schemas
 * @returns {Set<string>}
 */
export function toolNameSet(schemas) {
    const names = (Array.isArray(schemas) ? schemas : [])
        .map((schema) => schema?.name)
        .filter((name) => typeof name === 'string' && name.length > 0);
    return new Set(names);
}

/**
 * Builds a case-insensitive alternation pattern over the schema tool names.
 * @param {Array<{ name?: string }>} schemas
 * @returns {RegExp}
 */
export function buildToolNamePattern(schemas) {
    const names = (Array.isArray(schemas) ? schemas : [])
        .map((schema) => schema?.name)
        .filter((name) => typeof name === 'string' && name.length > 0)
        // Longest first keeps alternation matches deterministic for names that
        // share a prefix (e.g. fill/fill_form, wait_for/wait_for_download).
        .sort((left, right) => right.length - left.length)
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(?:${names.join('|')})`, 'i');
}
