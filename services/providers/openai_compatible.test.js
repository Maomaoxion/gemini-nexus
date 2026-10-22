import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendOpenAIMessage } from './openai_compatible.js';
import { buildResponsesInput } from './openai_payloads.js';

function makeChatSseStream(text = 'ok') {
    const encoder = new TextEncoder();
    const payload = `data: ${JSON.stringify({
        choices: [{ delta: { content: text } }],
    })}\n\ndata: [DONE]\n\n`;

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

function makeResponsesSseStream(text = 'ok') {
    const encoder = new TextEncoder();
    const payload = `data: ${JSON.stringify({
        type: 'response.output_text.delta',
        delta: text,
    })}\n\ndata: [DONE]\n\n`;

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

function makeOpenRouterReasoningStream() {
    const encoder = new TextEncoder();
    const payload = [
        {
            choices: [{ delta: { reasoning: 'thinking ', content: '' } }],
        },
        {
            choices: [{ delta: { reasoning_details: [{ text: 'more' }] } }],
        },
        {
            choices: [{ delta: { content: 'done' } }],
        },
    ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join('');

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

describe('sendOpenAIMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });
    });

    it('replays stored user image attachments from normalized metadata', async () => {
        await sendOpenAIMessage(
            'Continue',
            '',
            [
                {
                    role: 'user',
                    text: 'Look at this',
                    attachments: [
                        {
                            base64: 'data:image/png;base64,AAAA',
                            type: 'image/png',
                            name: 'image.png',
                        },
                    ],
                },
            ],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'gpt-test',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages[0]).toEqual({
            role: 'user',
            content: [
                {
                    type: 'image_url',
                    image_url: {
                        url: 'data:image/png;base64,AAAA',
                        detail: 'high',
                    },
                },
                { type: 'text', text: 'Look at this' },
            ],
        });
    });

    it('marks stored non-image attachments instead of silently dropping them', async () => {
        await sendOpenAIMessage(
            'Continue',
            '',
            [
                {
                    role: 'user',
                    text: 'Review spec',
                    attachments: [
                        {
                            base64: 'data:application/pdf;base64,BBBB',
                            type: 'application/pdf',
                            name: 'spec.pdf',
                        },
                    ],
                },
            ],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'gpt-test',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages[0]).toEqual({
            role: 'user',
            content: 'Review spec\n[1 unsupported file attachment(s) omitted: spec.pdf]',
        });
    });

    it('rejects current non-image attachments before sending an OpenAI request', async () => {
        await expect(
            sendOpenAIMessage(
                'Review attached spec',
                '',
                [],
                {
                    baseUrl: 'https://api.example.test/v1',
                    model: 'gpt-test',
                },
                [
                    {
                        base64: 'data:application/pdf;base64,BBBB',
                        type: 'application/pdf',
                        name: 'spec.pdf',
                    },
                ],
                null,
                vi.fn()
            )
        ).rejects.toThrow(/supports image attachments only/);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('keeps image data URLs with generic MIME metadata in Chat Completions payloads', async () => {
        await sendOpenAIMessage(
            'Describe this image',
            '',
            [],
            {
                baseUrl: 'https://api.x.ai/v1',
                model: 'grok-4.3',
            },
            [
                {
                    base64: 'data:application/octet-stream;base64,iVBORw0KGgoAAA',
                    type: 'application/octet-stream',
                    name: 'capture.bin',
                },
            ],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages[payload.messages.length - 1]).toEqual({
            role: 'user',
            content: [
                {
                    type: 'image_url',
                    image_url: {
                        url: 'data:image/png;base64,iVBORw0KGgoAAA',
                        detail: 'high',
                    },
                },
                { type: 'text', text: 'Describe this image' },
            ],
        });
    });

    it('merges provider-specific Chat Completions payload options', async () => {
        await sendOpenAIMessage(
            'Think',
            '',
            [],
            {
                baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
                model: 'glm-test',
                chatPayload: { thinking: { type: 'enabled' } },
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.thinking).toEqual({ type: 'enabled' });
    });

    it('streams OpenRouter reasoning deltas into thoughts', async () => {
        const onUpdate = vi.fn();
        global.fetch.mockResolvedValueOnce({
            ok: true,
            body: makeOpenRouterReasoningStream(),
        });

        await expect(
            sendOpenAIMessage(
                'Think',
                '',
                [],
                {
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'openai/gpt-5.2',
                    chatPayload: {
                        reasoning: { effort: 'high', exclude: false },
                    },
                },
                [],
                null,
                onUpdate
            )
        ).resolves.toEqual(
            expect.objectContaining({
                text: 'done',
                thoughts: 'thinking more',
            })
        );

        expect(onUpdate).toHaveBeenLastCalledWith('done', 'thinking more');
    });

    it('keeps image data URLs in Responses API payloads with high detail', async () => {
        global.fetch.mockResolvedValue({ ok: true, body: makeResponsesSseStream('done') });

        await sendOpenAIMessage(
            'Describe this image',
            '',
            [],
            {
                baseUrl: 'https://api.x.ai/v1',
                model: 'grok-4.3',
                useResponsesApi: true,
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

        const [url, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(url).toBe('https://api.x.ai/v1/responses');
        expect(payload.input[payload.input.length - 1]).toEqual({
            role: 'user',
            content: [
                {
                    type: 'input_image',
                    image_url: 'data:image/png;base64,AAAA',
                    detail: 'high',
                },
                { type: 'input_text', text: 'Describe this image' },
            ],
        });
        expect(payload.store).toBe(false);
    });

    it('does not disable storage for non-xAI Responses API image payloads', async () => {
        global.fetch.mockResolvedValue({ ok: true, body: makeResponsesSseStream('done') });

        await sendOpenAIMessage(
            'Describe this image',
            '',
            [],
            {
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-5',
                useResponsesApi: true,
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
        expect(payload.input[payload.input.length - 1].content[0]).toEqual({
            type: 'input_image',
            image_url: 'data:image/png;base64,AAAA',
            detail: 'high',
        });
        expect(payload).not.toHaveProperty('store');
    });

    it('disables xAI Responses storage when replayed history contains image attachments', async () => {
        global.fetch.mockResolvedValue({ ok: true, body: makeResponsesSseStream('done') });

        await sendOpenAIMessage(
            'Continue',
            '',
            [
                {
                    role: 'user',
                    text: 'Earlier image',
                    attachments: [
                        {
                            base64: 'data:image/png;base64,BBBB',
                            type: 'image/png',
                            name: 'earlier.png',
                        },
                    ],
                },
            ],
            {
                baseUrl: 'https://api.x.ai/v1',
                model: 'grok-4.3',
                useResponsesApi: true,
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.store).toBe(false);
    });

    it('ignores protected chat payload keys while keeping user extras', async () => {
        await sendOpenAIMessage(
            'Hello',
            '',
            [],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'gpt-test',
                chatPayload: {
                    model: 'evil-model',
                    messages: [{ role: 'user', content: 'evil' }],
                    stream: false,
                    temperature: 0.5,
                },
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.model).toBe('gpt-test');
        expect(payload.stream).toBe(true);
        expect(payload.messages).not.toEqual([{ role: 'user', content: 'evil' }]);
        expect(payload.temperature).toBe(0.5);
    });

    it('never lets user headers override authorization or content type', async () => {
        await sendOpenAIMessage(
            'Hello',
            '',
            [],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'gpt-test',
                apiKey: 'real-key',
                headers: {
                    Authorization: 'Bearer fake-key',
                    'content-type': 'text/plain',
                    'X-Title': 'Gemini Nexus',
                },
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        expect(init.headers['Authorization']).toBe('Bearer real-key');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(init.headers['X-Title']).toBe('Gemini Nexus');
    });

    it('throws a truncation error instead of an empty success on max length', async () => {
        const encoder = new TextEncoder();
        global.fetch.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader() {
                    return {
                        read: vi
                            .fn()
                            .mockResolvedValueOnce({
                                done: false,
                                value: encoder.encode(
                                    'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n'
                                ),
                            })
                            .mockResolvedValueOnce({ done: true }),
                    };
                },
            },
        });

        await expect(
            sendOpenAIMessage(
                'Hello',
                '',
                [],
                { baseUrl: 'https://api.example.test/v1', model: 'gpt-test' },
                [],
                null,
                vi.fn()
            )
        ).rejects.toThrow(/truncated/);
    });

    it('throws a blocked error on incomplete responses', async () => {
        const encoder = new TextEncoder();
        global.fetch.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader() {
                    return {
                        read: vi
                            .fn()
                            .mockResolvedValueOnce({
                                done: false,
                                value: encoder.encode(
                                    'data: {"type":"response.completed","response":{"status":"incomplete","incomplete_details":{"reason":"content_filter"}}}\n\n'
                                ),
                            })
                            .mockResolvedValueOnce({ done: true }),
                    };
                },
            },
        });

        await expect(
            sendOpenAIMessage(
                'Hello',
                '',
                [],
                {
                    baseUrl: 'https://api.example.test/v1',
                    model: 'gpt-test',
                    useResponsesApi: true,
                },
                [],
                null,
                vi.fn()
            )
        ).rejects.toThrow(/blocked/);
    });
});

function makeToolCallSseStream() {
    const encoder = new TextEncoder();
    const events = [
        { choices: [{ delta: { content: 'Checking...' } }] },
        {
            choices: [
                {
                    delta: {
                        tool_calls: [
                            {
                                index: 0,
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'get_page_errors', arguments: '{"a":' },
                            },
                        ],
                    },
                },
            ],
        },
        {
            choices: [
                {
                    delta: {
                        tool_calls: [{ index: 0, function: { arguments: '1}' } }],
                    },
                    finish_reason: 'tool_calls',
                },
            ],
        },
    ];
    const payload =
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';

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

describe('sendOpenAIMessage native tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('parses streamed tool_calls into functionCalls', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeToolCallSseStream(),
        });

        const result = await sendOpenAIMessage(
            'Check errors',
            '',
            [],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'deepseek-chat',
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'get_page_errors',
                            description: 'Read errors',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                ],
            },
            [],
            null,
            vi.fn()
        );

        expect(result.functionCalls).toEqual([
            { id: 'call_1', name: 'get_page_errors', args: { a: 1 } },
        ]);
        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.tools).toHaveLength(1);
        expect(payload.tool_choice).toBe('auto');
    });

    it('replays assistant tool_calls and tool rows without an empty user turn', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });

        await sendOpenAIMessage(
            '',
            '',
            [
                {
                    role: 'ai',
                    text: 'Checking...',
                    toolCalls: [{ id: 'call_1', name: 'get_page_errors', args: {} }],
                },
                {
                    role: 'user',
                    text: '[Tool Output: get_page_errors]',
                    kind: 'tool-output',
                    toolCallId: 'call_1',
                    toolOutput: 'no errors',
                },
            ],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'deepseek-chat',
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'get_page_errors',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                ],
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages).toEqual([
            {
                role: 'assistant',
                content: 'Checking...',
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'get_page_errors', arguments: '{}' },
                    },
                ],
            },
            { role: 'tool', tool_call_id: 'call_1', content: 'no errors' },
        ]);
    });

    it('replays reasoning_content for DeepSeek tool-call turns', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });

        await sendOpenAIMessage(
            '',
            '',
            [
                {
                    role: 'ai',
                    text: '',
                    thoughts: 'I should check the console first.',
                    toolCalls: [{ id: 'call_1', name: 'get_console_logs', args: {} }],
                },
                {
                    role: 'user',
                    text: '[Tool Output: get_console_logs]',
                    kind: 'tool-output',
                    toolCallId: 'call_1',
                    toolOutput: 'no logs',
                },
            ],
            {
                baseUrl: 'https://api.deepseek.com',
                model: 'deepseek-flash',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages[0]).toEqual(
            expect.objectContaining({
                role: 'assistant',
                reasoning_content: 'I should check the console first.',
            })
        );
    });

    it('replays reasoning_content for plain DeepSeek assistant turns', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });

        await sendOpenAIMessage(
            'Continue',
            '',
            [
                { role: 'user', text: 'Hello' },
                {
                    role: 'ai',
                    text: 'Hi there',
                    thoughts: 'The user greeted me.',
                },
            ],
            {
                baseUrl: 'https://api.deepseek.com',
                model: 'deepseek-flash',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages[1]).toEqual(
            expect.objectContaining({
                role: 'assistant',
                reasoning_content: 'The user greeted me.',
            })
        );
    });

    it('does not send reasoning_content to non-DeepSeek chat providers', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });

        await sendOpenAIMessage(
            '',
            '',
            [
                {
                    role: 'ai',
                    text: '',
                    thoughts: 'Internal plan',
                    toolCalls: [{ id: 'call_1', name: 'get_console_logs', args: {} }],
                },
                {
                    role: 'user',
                    text: '[Tool Output: get_console_logs]',
                    kind: 'tool-output',
                    toolCallId: 'call_1',
                    toolOutput: 'no logs',
                },
            ],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'gpt-test',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages[0]).not.toHaveProperty('reasoning_content');
    });

    it('pairs a tool result by order when the session snapshot lost its id', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            await sendOpenAIMessage(
                '',
                '',
                [
                    {
                        role: 'ai',
                        text: '',
                        toolCalls: [{ id: 'call_1', name: 'get_console_logs', args: {} }],
                    },
                    {
                        role: 'user',
                        text: '[Tool Output: get_console_logs]\nlog line\n\n[Proceeding to step 1]',
                        kind: 'tool-output',
                        toolName: 'get_console_logs',
                        toolOutput: 'log line',
                    },
                ],
                {
                    baseUrl: 'https://api.deepseek.com',
                    model: 'deepseek-flash',
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
            role: 'tool',
            tool_call_id: 'call_1',
            content: 'log line',
        });
        expect(payload.messages).not.toContainEqual(
            expect.objectContaining({ content: '[Tool result unavailable]' })
        );
    });

    it('pairs a tool result by order when its stored id does not match', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            await sendOpenAIMessage(
                '',
                '',
                [
                    {
                        role: 'ai',
                        text: '',
                        toolCalls: [{ id: 'call_1', name: 'get_console_logs', args: {} }],
                    },
                    {
                        role: 'user',
                        text: '[Tool Output: get_console_logs]\nlog line',
                        kind: 'tool-output',
                        toolName: 'get_console_logs',
                        toolCallId: 'call_other',
                        toolOutput: 'log line',
                    },
                ],
                {
                    baseUrl: 'https://api.deepseek.com',
                    model: 'deepseek-flash',
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
            role: 'tool',
            tool_call_id: 'call_1',
            content: 'log line',
        });
    });

    it('drops orphan tool rows left by history trimming', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });

        await sendOpenAIMessage(
            'Continue',
            '',
            [
                { role: 'user', text: 'Check errors' },
                {
                    role: 'user',
                    text: '[Tool Output: get_page_errors]',
                    kind: 'tool-output',
                    toolCallId: 'missing',
                    toolOutput: 'orphan',
                },
            ],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'deepseek-chat',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages.some((message) => message.role === 'tool')).toBe(false);
    });

    it('fills missing tool rows when history ends mid tool call', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });

        await sendOpenAIMessage(
            '',
            '',
            [
                {
                    role: 'ai',
                    text: 'Checking...',
                    toolCalls: [{ id: 'call_1', name: 'get_page_errors', args: {} }],
                },
                { role: 'user', text: 'Continue' },
            ],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'deepseek-chat',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.messages).toContainEqual({
            role: 'tool',
            tool_call_id: 'call_1',
            content: '[Tool result unavailable]',
        });
    });

    it('sends Responses tools and parses function_call items', async () => {
        const encoder = new TextEncoder();
        const events = [
            {
                type: 'response.output_item.done',
                item: {
                    type: 'function_call',
                    call_id: 'call_1',
                    name: 'get_page_errors',
                    arguments: '{"a":1}',
                },
            },
            { type: 'response.completed', response: { status: 'completed', output: [] } },
        ];
        const streamPayload =
            events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
            'data: [DONE]\n\n';
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: {
                getReader() {
                    return {
                        read: vi
                            .fn()
                            .mockResolvedValueOnce({
                                done: false,
                                value: encoder.encode(streamPayload),
                            })
                            .mockResolvedValueOnce({ done: true }),
                    };
                },
            },
        });

        const result = await sendOpenAIMessage(
            'Check errors',
            '',
            [],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'gpt-test',
                useResponsesApi: true,
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
            { id: 'call_1', name: 'get_page_errors', args: { a: 1 } },
        ]);

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload.tools).toEqual([
            {
                type: 'function',
                name: 'get_page_errors',
                description: 'Read errors',
                parameters: { type: 'object', properties: {} },
            },
        ]);
    });

    it('omits reasoning effort when the thinking level is auto', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeChatSseStream('done'),
        });

        await sendOpenAIMessage(
            'Hello',
            '',
            [],
            {
                baseUrl: 'https://api.deepseek.com',
                model: 'deepseek-flash',
                reasoningEffort: 'auto',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload).not.toHaveProperty('reasoning_effort');
        expect(payload).not.toHaveProperty('reasoning');
    });

    it('omits Responses reasoning when the thinking level is auto', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: makeResponsesSseStream('done'),
        });

        await sendOpenAIMessage(
            'Hello',
            '',
            [],
            {
                baseUrl: 'https://api.example.test/v1',
                model: 'gpt-test',
                useResponsesApi: true,
                reasoningEffort: 'auto',
            },
            [],
            null,
            vi.fn()
        );

        const [, init] = global.fetch.mock.calls[0];
        const payload = JSON.parse(init.body);
        expect(payload).not.toHaveProperty('reasoning');
    });
});

describe('buildResponsesInput tool result replay', () => {
    it('pairs a tool-output row without toolCallId by call order', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const input = buildResponsesInput(
                '',
                [
                    {
                        role: 'ai',
                        toolCalls: [{ id: 'call_1', name: 'get_console_logs', args: {} }],
                    },
                    {
                        role: 'user',
                        text: '[Tool Output: get_console_logs]\nlog line',
                        toolName: 'get_console_logs',
                        toolOutput: 'log line',
                    },
                ],
                []
            );

            expect(input).toContainEqual({
                type: 'function_call_output',
                call_id: 'call_1',
                output: 'log line',
            });
            expect(input.some((item) => item.output === '[Tool result unavailable]')).toBe(false);
            expect(warnSpy).toHaveBeenCalledWith(
                '[Gemini Nexus] Tool result id mismatch; pairing by order',
                expect.objectContaining({
                    storedToolCallId: '',
                    pairedToolCallId: 'call_1',
                    expectedToolName: 'get_console_logs',
                })
            );
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('pairs a tool result by order when its stored id does not match', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const input = buildResponsesInput(
                '',
                [
                    {
                        role: 'ai',
                        toolCalls: [{ id: 'call_1', name: 'get_page_errors', args: {} }],
                    },
                    {
                        role: 'user',
                        kind: 'tool-output',
                        toolCallId: 'call_other',
                        toolOutput: 'no errors',
                    },
                ],
                []
            );

            expect(input).toContainEqual({
                type: 'function_call_output',
                call_id: 'call_1',
                output: 'no errors',
            });
            expect(warnSpy).toHaveBeenCalledTimes(1);
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('drops orphan tool rows left by history trimming', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const input = buildResponsesInput(
                '',
                [
                    { role: 'user', text: 'Check errors' },
                    {
                        role: 'user',
                        kind: 'tool-output',
                        toolCallId: 'missing',
                        toolOutput: 'orphan',
                    },
                ],
                []
            );

            expect(input.some((item) => item.type === 'function_call_output')).toBe(false);
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('fills a placeholder when history ends mid tool call', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const input = buildResponsesInput(
                '',
                [
                    {
                        role: 'ai',
                        text: 'Checking...',
                        toolCalls: [{ id: 'call_1', name: 'get_page_errors', args: {} }],
                    },
                ],
                []
            );

            expect(input).toContainEqual({
                type: 'function_call_output',
                call_id: 'call_1',
                output: '[Tool result unavailable]',
            });
            expect(warnSpy).toHaveBeenCalledWith(
                '[Gemini Nexus] Tool results missing at end of history',
                expect.objectContaining({ toolCallIds: ['call_1'] })
            );
        } finally {
            warnSpy.mockRestore();
        }
    });
});
