import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendAnthropicMessage } from './anthropic.js';

function makeAnthropicSseStream(events) {
    const encoder = new TextEncoder();
    const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

    return {
        getReader() {
            return {
                read: vi
                    .fn()
                    .mockResolvedValueOnce({ done: false, value: encoder.encode(payload) })
                    .mockResolvedValueOnce({ done: true }),
            };
        },
    };
}

describe('sendAnthropicMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeAnthropicSseStream([
                {
                    type: 'content_block_delta',
                    delta: { type: 'thinking_delta', thinking: 'thinking...' },
                },
                {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: 'done' },
                },
            ]),
        });
    });

    it('sends native Anthropic messages and streams thinking deltas', async () => {
        const onUpdate = vi.fn();

        await expect(
            sendAnthropicMessage(
                'Hello',
                'system',
                [],
                {
                    baseUrl: 'https://api.anthropic.com/v1',
                    apiKey: 'anthropic-key',
                    model: 'claude-test',
                    thinkingLevel: 'high',
                },
                [],
                null,
                onUpdate
            )
        ).resolves.toEqual({
            text: 'done',
            thoughts: 'thinking...',
            sources: [],
            images: [],
            context: null,
            functionCalls: [],
            anthropicContent: null,
        });

        const [url, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(init.headers).toEqual(
            expect.objectContaining({
                'x-api-key': 'anthropic-key',
                'anthropic-version': '2023-06-01',
            })
        );
        expect(payload).toEqual(
            expect.objectContaining({
                model: 'claude-test',
                system: 'system',
                thinking: { type: 'enabled', budget_tokens: 4096 },
                messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
                stream: true,
            })
        );
        expect(onUpdate).toHaveBeenCalledWith('', 'thinking...');
        expect(onUpdate).toHaveBeenCalledWith('done', 'thinking...');
    });

    it('encodes image attachments as Anthropic image content blocks', async () => {
        await sendAnthropicMessage(
            'Describe',
            '',
            [],
            {
                baseUrl: 'https://api.anthropic.com/v1',
                apiKey: 'anthropic-key',
                model: 'claude-test',
            },
            [
                {
                    base64: 'data:image/png;base64,AAAA',
                    type: 'image/png',
                    name: 'capture.png',
                },
            ],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages[0].content).toEqual([
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'AAAA',
                },
            },
            { type: 'text', text: 'Describe' },
        ]);
    });

    it('uses adaptive thinking for Claude models that reject fixed thinking budgets', async () => {
        for (const model of [
            'claude-jupiter-v1-p',
            'claude-mythos-preview',
            'claude-opus-4-7',
            'claude-opus-4-8-20261201',
            'claude-sonnet-5',
            'claude-opus-5',
            'claude-fable-5-1',
            'claude-sonnet-5-5',
            'claude-opus-5-5',
            'claude-haiku-5-5',
        ]) {
            global.fetch.mockClear();

            await sendAnthropicMessage(
                'Think carefully',
                '',
                [],
                {
                    baseUrl: 'https://api.anthropic.com/v1',
                    apiKey: 'anthropic-key',
                    model,
                    thinkingLevel: 'medium',
                },
                [],
                null,
                vi.fn()
            );

            const [, init] = global.fetch.mock.calls[0];
            const payload = JSON.parse(init.body);
            expect(payload.thinking).toEqual({ type: 'adaptive' });
            expect(payload.output_config).toEqual({ effort: 'medium' });
        }
    });

    it('merges consecutive same-role turns and skips empty assistant rows', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeAnthropicSseStream([
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
            ]),
        });

        await sendAnthropicMessage(
            'Next question',
            '',
            [
                { role: 'user', text: 'First' },
                { role: 'ai', text: '   ' },
                { role: 'user', text: 'Second' },
            ],
            {
                baseUrl: 'https://api.anthropic.com/v1',
                apiKey: 'anthropic-key',
                model: 'claude-test',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages).toHaveLength(1);
        expect(payload.messages[0].role).toBe('user');
        expect(payload.messages[0].content.map((part) => part.text)).toEqual([
            'First',
            'Second',
            'Next question',
        ]);
    });

    it('throws a truncation error on max_tokens instead of an empty success', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeAnthropicSseStream([
                {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: 'partial' },
                },
                {
                    type: 'message_delta',
                    delta: { stop_reason: 'max_tokens' },
                },
            ]),
        });

        await expect(
            sendAnthropicMessage(
                'Hello',
                '',
                [],
                {
                    baseUrl: 'https://api.anthropic.com/v1',
                    apiKey: 'anthropic-key',
                    model: 'claude-test',
                },
                [],
                null,
                vi.fn()
            )
        ).rejects.toThrow(/truncated/);
    });

    it('surfaces the Anthropic API error message instead of the raw JSON body', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: async () =>
                '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
        });

        await expect(
            sendAnthropicMessage(
                'Hello',
                '',
                [],
                {
                    baseUrl: 'https://api.anthropic.com/v1',
                    apiKey: 'bad',
                    model: 'claude-test',
                },
                [],
                null,
                vi.fn()
            )
        ).rejects.toThrow('API Error (401): invalid x-api-key');
    });

    it('parses streamed tool_use blocks into functionCalls', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeAnthropicSseStream([
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: {
                        type: 'tool_use',
                        id: 'toolu_1',
                        name: 'get_page_errors',
                        input: {},
                    },
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'input_json_delta', partial_json: '{"a":1}' },
                },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
            ]),
        });

        const result = await sendAnthropicMessage(
            'Check',
            '',
            [],
            {
                baseUrl: 'https://api.anthropic.com/v1',
                apiKey: 'key',
                model: 'claude-test',
                toolSchemas: [
                    {
                        name: 'get_page_errors',
                        description: 'Read errors',
                        parameters: { type: 'object', properties: {} },
                    },
                ],
            },
            [],
            null,
            vi.fn()
        );

        expect(result.functionCalls).toEqual([
            { id: 'toolu_1', name: 'get_page_errors', args: { a: 1 } },
        ]);

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.tools).toEqual([
            {
                name: 'get_page_errors',
                description: 'Read errors',
                input_schema: { type: 'object', properties: {} },
            },
        ]);
    });

    it('pairs a tool result by order when its tool_call_id is missing', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            await sendAnthropicMessage(
                '',
                '',
                [
                    {
                        role: 'ai',
                        text: '',
                        toolCalls: [{ id: 'toolu_1', name: 'get_page_errors', args: {} }],
                    },
                    {
                        role: 'user',
                        text: '[Tool Output: get_page_errors]\nno errors',
                        kind: 'tool-output',
                        toolName: 'get_page_errors',
                        toolOutput: 'no errors',
                    },
                ],
                {
                    baseUrl: 'https://api.anthropic.com/v1',
                    apiKey: 'key',
                    model: 'claude-test',
                },
                [],
                null,
                vi.fn()
            );
        } finally {
            warnSpy.mockRestore();
        }

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages).toContainEqual({
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: 'toolu_1',
                    content: 'no errors',
                },
            ],
        });
    });

    it('captures thinking blocks with signatures and tool_use blocks for replay', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeAnthropicSseStream([
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'thinking', thinking: '', signature: '' },
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'thinking_delta', thinking: 'Check the ' },
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'thinking_delta', thinking: 'console first.' },
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'signature_delta', signature: 'sig-abc' },
                },
                { type: 'content_block_stop', index: 0 },
                {
                    type: 'content_block_start',
                    index: 1,
                    content_block: {
                        type: 'tool_use',
                        id: 'toolu_1',
                        name: 'get_page_errors',
                        input: {},
                    },
                },
                {
                    type: 'content_block_delta',
                    index: 1,
                    delta: { type: 'input_json_delta', partial_json: '{"limit":' },
                },
                {
                    type: 'content_block_delta',
                    index: 1,
                    delta: { type: 'input_json_delta', partial_json: '10}' },
                },
                { type: 'content_block_stop', index: 1 },
                { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
            ]),
        });

        const result = await sendAnthropicMessage(
            'Check',
            '',
            [],
            {
                baseUrl: 'https://api.anthropic.com/v1',
                apiKey: 'key',
                model: 'claude-test',
                thinkingLevel: 'low',
            },
            [],
            null,
            vi.fn()
        );

        expect(result.anthropicContent).toEqual([
            {
                type: 'thinking',
                thinking: 'Check the console first.',
                signature: 'sig-abc',
            },
            { type: 'tool_use', id: 'toolu_1', name: 'get_page_errors', input: { limit: 10 } },
        ]);
        expect(result.functionCalls).toEqual([
            { id: 'toolu_1', name: 'get_page_errors', args: { limit: 10 } },
        ]);
    });

    it('keeps redacted_thinking blocks and drops blocks that cannot be replayed', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeAnthropicSseStream([
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'thinking', thinking: '', signature: '' },
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'thinking_delta', thinking: 'unsigned' },
                },
                { type: 'content_block_stop', index: 0 },
                {
                    type: 'content_block_start',
                    index: 1,
                    content_block: { type: 'redacted_thinking', data: 'opaque-data' },
                },
                { type: 'content_block_stop', index: 1 },
                {
                    type: 'content_block_start',
                    index: 2,
                    content_block: { type: 'text', text: '' },
                },
                {
                    type: 'content_block_delta',
                    index: 2,
                    delta: { type: 'text_delta', text: 'done' },
                },
                { type: 'content_block_stop', index: 2 },
            ]),
        });

        const result = await sendAnthropicMessage(
            'Hello',
            '',
            [],
            {
                baseUrl: 'https://api.anthropic.com/v1',
                apiKey: 'key',
                model: 'claude-test',
                thinkingLevel: 'low',
            },
            [],
            null,
            vi.fn()
        );

        expect(result.thoughts).toBe('unsigned\n[redacted thinking]');
        expect(result.anthropicContent).toEqual([
            { type: 'redacted_thinking', data: 'opaque-data' },
            { type: 'text', text: 'done' },
        ]);
    });

    it('replays stored anthropicContent verbatim and pairs tool results by id', async () => {
        const rawContent = [
            { type: 'thinking', thinking: 'Check logs.', signature: 'sig-abc' },
            { type: 'text', text: 'Checking.' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_page_errors', input: { limit: 5 } },
        ];

        await sendAnthropicMessage(
            '',
            '',
            [
                { role: 'user', text: 'Check the page' },
                { role: 'ai', text: 'Checking.', anthropicContent: rawContent },
                {
                    role: 'user',
                    text: '[Tool Output: get_page_errors]\nno errors',
                    kind: 'tool-output',
                    toolName: 'get_page_errors',
                    toolOutput: 'no errors',
                    toolCallId: 'toolu_1',
                },
            ],
            {
                baseUrl: 'https://api.anthropic.com/v1',
                apiKey: 'key',
                model: 'claude-test',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'Check the page' }] },
            { role: 'assistant', content: rawContent },
            {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'no errors' }],
            },
        ]);
    });

    it('drops unreplayable thinking blocks and keeps raw turns unmerged', async () => {
        await sendAnthropicMessage(
            '',
            '',
            [
                { role: 'user', text: 'Question' },
                { role: 'ai', text: 'First answer' },
                {
                    role: 'ai',
                    text: 'Second answer',
                    anthropicContent: [
                        { type: 'thinking', thinking: 'no signature' },
                        { type: 'thinking', thinking: 'signed', signature: 'sig-1' },
                    ],
                },
            ],
            {
                baseUrl: 'https://api.anthropic.com/v1',
                apiKey: 'key',
                model: 'claude-test',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'Question' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
            {
                role: 'assistant',
                content: [{ type: 'thinking', thinking: 'signed', signature: 'sig-1' }],
            },
        ]);
    });
});
