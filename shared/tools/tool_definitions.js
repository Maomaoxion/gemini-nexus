/**
 * Provider-specific tool definition shapes.
 *
 * Kept in shared/ so provider modules do not depend on background/tools.
 */

export function toOpenAIResponsesTools(schemas) {
    return (Array.isArray(schemas) ? schemas : []).map((schema) => ({
        type: 'function',
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
    }));
}

export function toAnthropicTools(schemas) {
    return (Array.isArray(schemas) ? schemas : []).map((schema) => ({
        name: schema.name,
        description: schema.description,
        input_schema: schema.parameters,
    }));
}
