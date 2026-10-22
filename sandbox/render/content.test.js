// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { renderContent } from './content.js';
import { transformMarkdown } from './pipeline.js';
import { enhanceLiveArtifacts } from './artifacts.js';

vi.mock('./pipeline.js', () => ({
    transformMarkdown: vi.fn((text) => `<pre>${text}</pre>`),
}));

vi.mock('./artifacts.js', () => ({
    cleanupLiveArtifacts: vi.fn(),
    enhanceLiveArtifacts: vi.fn(),
}));

vi.mock('../core/i18n.js', () => ({
    formatT: (key, values = {}) => {
        const templates = {
            callLabel: 'Call {index}/{count}',
            collapseTool: 'Collapse {name}',
            durationLabel: '{duration}',
            expandTool: 'Expand {name}',
            stepLabel: 'Step {step}',
            toolStatusCancelled: 'Cancelled {name}',
            toolStatusFailed: 'Failed {name}',
            toolStatusRunning: 'Using {name}...',
            toolStatusUsed: 'Used {name}',
        };
        return (templates[key] || key).replace(/\{(\w+)\}/g, (_, name) =>
            String(values[name] ?? '')
        );
    },
    t: (key) =>
        ({
            rawTool: 'Raw tool',
            toolBadgeDone: 'Done',
            toolBadgeFailed: 'Failed',
            toolBadgeRunning: 'Running',
            toolBadgeCancelled: 'Cancelled',
            toolFallbackName: 'tool',
        })[key] || key,
}));

vi.mock('../../shared/utils/index.js', () => ({
    createPrefixedId: (prefix) => `${prefix}-test`,
}));

describe('renderContent tool disclosure', () => {
    it('renders tool duration in disclosure metadata', () => {
        const contentDiv = document.createElement('div');

        renderContent(contentDiv, '{"ok":true}', 'tool-output', {
            toolName: 'click',
            toolStatus: 'completed',
            toolDurationMs: 1500,
            toolCallText: '{"tool":"click","args":{"uid":"1_2"}}',
        });

        expect(contentDiv.querySelector('.tool-disclosure-meta')?.textContent).toContain('1.5s');
        expect(contentDiv.querySelector('.tool-call-code')?.textContent).toContain(
            '"tool": "click"'
        );
        expect(contentDiv.querySelector('.tool-output-text')?.textContent).toContain('"ok": true');
        expect(contentDiv.querySelector('.code-block-wrapper')).toBeNull();
        expect(contentDiv.querySelector('.tool-disclosure-meta')?.textContent).not.toContain(
            'Raw tool'
        );
    });

    it('renders the Control button icon for every browser-control tool card', () => {
        const toolNames = [
            'navigate_page',
            'new_page',
            'close_page',
            'list_pages',
            'select_page',
            'click',
            'hover',
            'fill',
            'fill_form',
            'press_key',
            'type_text',
            'attach_file',
            'take_snapshot',
            'take_screenshot',
            'wait_for',
            'wait_for_url',
            'wait_for_load_state',
            'drag',
            'scroll',
            'run_steps',
            'handle_dialog',
            'evaluate_script',
        ];

        for (const toolName of toolNames) {
            const contentDiv = document.createElement('div');

            renderContent(contentDiv, '{"ok":true}', 'tool-status', {
                toolName,
                toolStatus: 'running',
                toolCallText: JSON.stringify({ tool: toolName, args: {} }),
            });

            const icon = contentDiv.querySelector('.tool-disclosure-icon');
            expect(icon, toolName).not.toBeNull();
            expect(icon?.dataset.toolIcon, toolName).toBe('browser-control');
            // Same glyph as the input #browser-control-btn (masked cursor-chat PNG).
            expect(icon?.querySelector('.tool-icon-browser-control'), toolName).not.toBeNull();
            expect(icon?.querySelector('svg'), toolName).toBeNull();
        }
    });

    it('keeps an expanded card open when progress updates re-render it', () => {
        const contentDiv = document.createElement('div');
        const options = {
            toolName: 'click',
            toolStatus: 'running',
            toolCallText: '{"uid":"1_2"}',
        };

        renderContent(contentDiv, 'Running click...', 'tool-status', options);
        contentDiv.querySelector('.tool-disclosure-toggle').click();

        renderContent(contentDiv, 'Running click (step 2)...', 'tool-status', {
            ...options,
            isCollapsed: true,
        });

        const wrapper = contentDiv.querySelector('.tool-disclosure');
        expect(wrapper.classList.contains('tool-disclosure-expanded')).toBe(true);
        expect(wrapper.querySelector('.tool-disclosure-body')?.hidden).toBe(false);
    });

    it('uses keyword icons for routed MCP tools and a plug fallback for unknown tools', () => {
        const searchDiv = document.createElement('div');
        renderContent(searchDiv, 'results', 'tool-output', {
            toolName: 'browser_mcp__search_query',
            toolStatus: 'completed',
        });

        const unknownDiv = document.createElement('div');
        renderContent(unknownDiv, 'done', 'tool-output', {
            toolName: 'custom_tool',
            toolStatus: 'completed',
        });

        expect(searchDiv.querySelector('.tool-disclosure-icon')?.dataset.toolIcon).toBe('search');
        expect(unknownDiv.querySelector('.tool-disclosure-icon')?.dataset.toolIcon).toBe('tool');
    });
});

describe('renderContent ai error boundaries', () => {
    it('falls back to escaped text when Markdown rendering throws', () => {
        vi.mocked(transformMarkdown).mockImplementationOnce(() => {
            throw new Error('marked boom');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const contentDiv = document.createElement('div');

        expect(() => renderContent(contentDiv, '<img src=x onerror=alert(1)>', 'ai')).not.toThrow();
        expect(contentDiv.querySelector('[onerror]')).toBeNull();
        expect(contentDiv.innerHTML).toContain('&lt;img');

        errorSpy.mockRestore();
    });

    it('keeps the rendered message when math rendering throws', () => {
        globalThis.renderMathInElement = () => {
            throw new Error('katex boom');
        };
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const contentDiv = document.createElement('div');

        try {
            expect(() => renderContent(contentDiv, 'hello $x$', 'ai')).not.toThrow();
            expect(contentDiv.innerHTML).toContain('hello');
        } finally {
            delete globalThis.renderMathInElement;
            errorSpy.mockRestore();
        }
    });

    it('keeps the rendered message when artifact enhancement throws', () => {
        vi.mocked(transformMarkdown).mockImplementationOnce(
            () => '<div class="code-block-wrapper"><pre><code>graph TD</code></pre></div>'
        );
        vi.mocked(enhanceLiveArtifacts).mockImplementationOnce(() => {
            throw new Error('artifact boom');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const contentDiv = document.createElement('div');

        expect(() => renderContent(contentDiv, '```mermaid\ngraph TD', 'ai')).not.toThrow();
        expect(contentDiv.querySelector('.code-block-wrapper')).not.toBeNull();

        errorSpy.mockRestore();
    });
});

describe('renderContent post-pass guards', () => {
    it('skips math rendering when the text cannot contain math', () => {
        globalThis.renderMathInElement = vi.fn();
        const contentDiv = document.createElement('div');

        try {
            renderContent(contentDiv, 'plain prose, no delimiters', 'ai');

            expect(globalThis.renderMathInElement).not.toHaveBeenCalled();
        } finally {
            delete globalThis.renderMathInElement;
        }
    });

    it('still runs math rendering when delimiters may be present', () => {
        globalThis.renderMathInElement = vi.fn();
        const contentDiv = document.createElement('div');

        try {
            renderContent(contentDiv, 'energy $E = mc^2$', 'ai');

            expect(globalThis.renderMathInElement).toHaveBeenCalledTimes(1);
        } finally {
            delete globalThis.renderMathInElement;
        }
    });

    it('skips artifact enhancement for prose without code blocks', () => {
        vi.mocked(enhanceLiveArtifacts).mockClear();
        const contentDiv = document.createElement('div');

        renderContent(contentDiv, 'just some words', 'ai');

        expect(enhanceLiveArtifacts).not.toHaveBeenCalled();
    });

    it('still enhances messages that contain code blocks', () => {
        vi.mocked(transformMarkdown).mockImplementationOnce(
            () => '<div class="code-block-wrapper"><pre><code>graph TD</code></pre></div>'
        );
        vi.mocked(enhanceLiveArtifacts).mockClear();
        const contentDiv = document.createElement('div');

        renderContent(contentDiv, '```mermaid\ngraph TD', 'ai');

        expect(enhanceLiveArtifacts).toHaveBeenCalledTimes(1);
    });
});
