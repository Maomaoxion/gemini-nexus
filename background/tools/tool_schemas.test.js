import { describe, expect, it, vi } from 'vitest';
import {
    CONTROL_TOOL_SCHEMAS,
    DEBUG_TOOL_SCHEMAS,
    buildToolSchemas,
    toGeminiFunctionDeclarations,
} from './tool_schemas.js';

describe('tool schemas', () => {
    it('builds debug schemas instead of control schemas when debug is enabled', async () => {
        const schemas = await buildToolSchemas({
            request: { enableDebugTools: true, enableBrowserControl: true },
            mcpManager: null,
        });

        expect(schemas.map((schema) => schema.name)).toEqual(
            DEBUG_TOOL_SCHEMAS.map((schema) => schema.name)
        );
    });

    it('builds control schemas when only browser control is enabled', async () => {
        const schemas = await buildToolSchemas({
            request: { enableBrowserControl: true },
            mcpManager: null,
        });

        expect(schemas.map((schema) => schema.name)).toEqual(
            CONTROL_TOOL_SCHEMAS.map((schema) => schema.name)
        );
    });

    it('converts schemas to Gemini declarations with uppercase types', () => {
        const schema = {
            name: 'example',
            description: 'Example',
            parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
                additionalProperties: false,
            },
        };

        const [declaration] = toGeminiFunctionDeclarations([schema]);

        expect(declaration.parameters).toEqual({
            type: 'OBJECT',
            properties: { value: { type: 'STRING' } },
            required: ['value'],
        });
    });

    it('includes MCP tools from the manager', async () => {
        const mcpManager = {
            listAllActiveTools: vi.fn(async () => [
                {
                    name: 'search',
                    _serverId: 'srv',
                    _toolId: 'srv__search',
                    description: 'Search',
                    inputSchema: {
                        type: 'object',
                        properties: { q: { type: 'string' } },
                    },
                },
            ]),
        };

        const schemas = await buildToolSchemas({
            request: {
                enableMcpTools: true,
                mcpServers: [{ id: 'srv', toolMode: 'all' }],
            },
            mcpManager,
        });

        expect(schemas).toEqual([
            {
                name: 'srv__search',
                description: 'Search',
                parameters: {
                    type: 'object',
                    properties: { q: { type: 'string' } },
                },
            },
        ]);
    });
});
