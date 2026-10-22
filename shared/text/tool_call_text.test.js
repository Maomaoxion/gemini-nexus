import { describe, expect, it } from 'vitest';
import {
    TOOL_OUTPUT_TEXT_PREFIX,
    buildToolOutputText,
    isToolCallOnlyText,
    isToolOutputText,
    parseToolCommand,
    parseToolOutputHeader,
    splitToolCallFromText,
    stripToolCallMarkup,
} from './tool_call_text.js';

const adjacentToolCalls = `{
  "tool": "fill",
  "args": {
    "uid": "1_43",
    "value": "168168\\n518518"
  }
}
\`\`\`\`\`\`json
{
  "tool": "click",
  "args": {
    "uid": "1_44"
  }
}
\`\`\`\`\`\`json
{
  "tool": "take_snapshot",
  "args": {}
}
\`\`\`\`\`\`json
{
  "tool": "fill",
  "args": {
    "uid": "1_43",
    "value": "808168\\n606168"
  }
}
\`\`\`对于六位纯数字的 .xyz 域名，价格通常很便宜。`;

describe('tool call text utilities', () => {
    it('strips adjacent malformed fenced tool calls before final prose', () => {
        expect(splitToolCallFromText(adjacentToolCalls)).toEqual({
            displayText: '对于六位纯数字的 .xyz 域名，价格通常很便宜。',
            toolCallText:
                '{\n  "tool": "fill",\n  "args": {\n    "uid": "1_43",\n    "value": "808168\\n606168"\n  }\n}',
            hasToolCall: true,
        });
    });

    it('strips a trailing sequence of tool calls without visible prose', () => {
        const text = `I will use the page.
\`\`\`json
{"tool":"click","args":{"uid":"1_1"}}
\`\`\`
\`\`\`\`\`\`json
{"tool":"take_snapshot","args":{}}
\`\`\``;

        expect(splitToolCallFromText(text)).toEqual({
            displayText: 'I will use the page.',
            toolCallText: '{"tool":"take_snapshot","args":{}}',
            hasToolCall: true,
        });
    });

    it('keeps ordinary JSON examples visible', () => {
        const text = 'Example:\n```json\n{"name":"demo","args":{}}\n```';

        expect(splitToolCallFromText(text)).toEqual({
            displayText: text,
            toolCallText: '',
            hasToolCall: false,
        });
    });

    it('hides streaming tool-call prefixes before they become complete JSON', () => {
        expect(splitToolCallFromText('```json', { allowPartial: true })).toEqual({
            displayText: '',
            toolCallText: '```json',
            hasToolCall: true,
        });

        expect(splitToolCallFromText('```json\n{', { allowPartial: true })).toEqual({
            displayText: '',
            toolCallText: '{',
            hasToolCall: true,
        });

        expect(
            splitToolCallFromText('```json\n{\n  "tool": "fill"', { allowPartial: true })
        ).toEqual({
            displayText: '',
            toolCallText: '{\n  "tool": "fill"',
            hasToolCall: true,
        });
    });

    it('reveals partial JSON once it no longer looks like a tool call', () => {
        const text = '```json\n{\n  "name": "demo"';

        expect(splitToolCallFromText(text, { allowPartial: true })).toEqual({
            displayText: text,
            toolCallText: '',
            hasToolCall: false,
        });
    });

    it('releases long uncertain code blocks instead of waiting for generation to finish', () => {
        const longJsonPrefix = `\`\`\`json\n{\n${' '.repeat(180)}`;

        expect(splitToolCallFromText(longJsonPrefix, { allowPartial: true })).toEqual({
            displayText: longJsonPrefix,
            toolCallText: '',
            hasToolCall: false,
        });
    });

    it('continues hiding confirmed partial tool calls beyond the uncertain prefix budget', () => {
        const partialToolCall = `\`\`\`json\n{\n  "tool": "fill",\n  "args": {\n    "value": "${'1'.repeat(180)}"`;

        expect(splitToolCallFromText(partialToolCall, { allowPartial: true })).toEqual({
            displayText: '',
            toolCallText:
                '{\n  "tool": "fill",\n  "args": {\n    "value": "' + '1'.repeat(180) + '"',
            hasToolCall: true,
        });
    });

    it('preserves prose while hiding a trailing streaming tool-call prefix', () => {
        expect(
            splitToolCallFromText('I will click now.\n```json\n{', { allowPartial: true })
        ).toEqual({
            displayText: 'I will click now.',
            toolCallText: '{',
            hasToolCall: true,
        });
    });

    it('preserves prose before a trailing partial fenced tool call', () => {
        expect(
            splitToolCallFromText(
                '好的，我先检查一下配置状态。\n```json\n{"tool":"get_config_info","args":{}}',
                { allowPartial: true }
            )
        ).toEqual({
            displayText: '好的，我先检查一下配置状态。',
            toolCallText: '{"tool":"get_config_info","args":{}}',
            hasToolCall: true,
        });
    });

    it('parses fenced tool commands without swallowing adjacent blocks', () => {
        expect(parseToolCommand(adjacentToolCalls)).toEqual({
            name: 'click',
            args: { uid: '1_44' },
        });
    });

    it('keeps prose that merely mentions tool names visible', () => {
        const text = 'Use the "tool" key only inside JSON payloads.\nThat is all.';

        expect(splitToolCallFromText(text, { allowPartial: true })).toEqual({
            displayText: text,
            toolCallText: '',
            hasToolCall: false,
        });
    });

    it('still hides an indented streaming tool call', () => {
        const text = 'Plan:\n    ```json\n    {"tool":"click","args":{}}';

        expect(splitToolCallFromText(text, { allowPartial: true })).toEqual({
            displayText: 'Plan:',
            toolCallText: '{"tool":"click","args":{}}',
            hasToolCall: true,
        });
    });

    it('leaves a long prose answer untouched', () => {
        const text = `${Array.from({ length: 400 }, (_value, index) => `Step ${index}: keep going.`).join('\n')}\nDone.`;

        expect(splitToolCallFromText(text, { allowPartial: true })).toEqual({
            displayText: text,
            toolCallText: '',
            hasToolCall: false,
        });
    });

    it('parses native model tool-call tokens with a plain tool name', () => {
        const text = 'Checking now.\n<|tool_call_begin|>get_page_errors<|tool_call_end|>';

        expect(parseToolCommand(text)).toEqual({ name: 'get_page_errors', args: {} });
        expect(splitToolCallFromText(text, { allowPartial: true })).toEqual({
            displayText: 'Checking now.',
            toolCallText: '<|tool_call_begin|>get_page_errors<|tool_call_end|>',
            hasToolCall: true,
        });
    });

    it('parses native model tool-call tokens with JSON arguments', () => {
        const text =
            '<|tool_call_begin|>function<|tool_sep|>{"name":"get_dom_html","arguments":{"selector":"#app"}}<|tool_call_end|>';

        expect(parseToolCommand(text)).toEqual({
            name: 'get_dom_html',
            args: { selector: '#app' },
        });
    });

    it('parses double-pipe native tool-call token variants', () => {
        const text = '<||tool_call_begin||>get_network_requests<||tool_call_end||>';

        expect(parseToolCommand(text)).toEqual({ name: 'get_network_requests', args: {} });
    });

    it('hides DSML tool-call markup while keeping the prose before it', () => {
        const text = `好的，我再压一轮。这次加大力度。
<||DSML|| calls>
<||DSML|| invoke name="get_page_info">
</||DSML|| invoke>
<||DSML|| invoke name="get_page_errors">
</||DSML|| invoke>
</||DSML|| calls>`;

        expect(splitToolCallFromText(text, { allowPartial: true })).toEqual({
            displayText: '好的，我再压一轮。这次加大力度。',
            toolCallText: expect.stringContaining('<||DSML|| calls>'),
            hasToolCall: true,
        });
        expect(stripToolCallMarkup(text)).toBe('好的，我再压一轮。这次加大力度。');
    });

    it('hides a streaming DSML block before its closing tag arrives', () => {
        const text = `Checking now.
<||DSML|| calls>
<||DSML|| invoke name="get_page_info">`;

        expect(splitToolCallFromText(text, { allowPartial: true })).toEqual({
            displayText: 'Checking now.',
            toolCallText: expect.stringContaining('<||DSML|| calls>'),
            hasToolCall: true,
        });
    });

    it('treats DSML-only text as a tool call', () => {
        const text =
            '<||DSML|| calls><||DSML|| invoke name="get_page_info"></||DSML|| invoke></||DSML|| calls>';

        expect(isToolCallOnlyText(text)).toBe(true);
    });
});

describe('tool output text helpers', () => {
    it('builds the stored tool-output history text', () => {
        expect(buildToolOutputText('search', 'Found docs')).toBe(
            '[Tool Output: search]\nFound docs'
        );
        expect(buildToolOutputText('', null)).toBe('[Tool Output: tool]\n');
    });

    it('detects and parses the tool-output header', () => {
        expect(isToolOutputText(`${TOOL_OUTPUT_TEXT_PREFIX} search]`)).toBe(true);
        expect(isToolOutputText('plain answer')).toBe(false);
        expect(parseToolOutputHeader('[Tool Output: search]\nFound docs')).toEqual({
            toolName: 'search',
            body: 'Found docs',
        });
        expect(parseToolOutputHeader('plain answer')).toEqual({
            toolName: '',
            body: 'plain answer',
        });
    });
});
