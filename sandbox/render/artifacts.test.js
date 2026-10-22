// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    GRAPHVIZ_CACHE_LIMIT,
    buildArtifactSrcDoc,
    cleanupLiveArtifacts,
    createLiveArtifactPreview,
    enhanceLiveArtifacts,
    getArtifactKind,
    sanitizeArtifactMarkup,
    setGraphvizLoaderForTest,
    setMermaidLoaderForTest,
} from './artifacts.js';
import { LIVE_ARTIFACT_FOLLOWUP_EVENT } from '../core/live_artifacts.js';
import { setLanguagePreference } from '../core/i18n.js';

function createCodeBlock(language, code) {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    wrapper.dataset.codeLang = language;

    const header = document.createElement('div');
    header.className = 'code-header';
    const label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = language;
    header.appendChild(label);
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-code-btn';
    copyButton.textContent = 'Copy';
    header.appendChild(copyButton);
    wrapper.appendChild(header);

    const pre = document.createElement('pre');
    const codeElement = document.createElement('code');
    codeElement.textContent = code;
    pre.appendChild(codeElement);
    wrapper.appendChild(pre);

    return wrapper;
}

function readFrameSrcDoc(frame) {
    return frame.getAttribute('srcdoc') || frame.srcdoc || '';
}

async function flushMicrotasks() {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
    }
}

describe('Live Artifact previews', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        document.documentElement.removeAttribute('data-theme');
        setLanguagePreference('en');
        setGraphvizLoaderForTest();
        setMermaidLoaderForTest();
    });

    it('detects previewable artifact languages and common bare diagrams', () => {
        expect(getArtifactKind('html', '<div>Hello</div>')).toBeNull();
        expect(getArtifactKind('amc-live-artifact-html', '<section>Hello</section>')).toBe('html');
        expect(getArtifactKind('amc-live-artifact-html', '')).toBeNull();
        expect(getArtifactKind('amc-live-artifact-html', 'Just text')).toBeNull();
        expect(getArtifactKind('svg', '<svg viewBox="0 0 1 1"></svg>')).toBe('svg');
        expect(getArtifactKind('mermaid', 'graph TD\n  A --> B')).toBe('mermaid');
        expect(getArtifactKind('graphviz', 'digraph G { A -> B; }')).toBe('graphviz');
        expect(getArtifactKind('dot', 'digraph G { A -> B; }')).toBe('graphviz');
        expect(getArtifactKind('plaintext', 'sequenceDiagram\n  A->>B: Hi')).toBe('mermaid');
        expect(getArtifactKind('text', 'digraph G {\n  A -> B;\n}')).toBe('graphviz');
        expect(getArtifactKind('plaintext', '<section>Hello</section>')).toBeNull();
        expect(getArtifactKind('javascript', 'console.log("no preview")')).toBeNull();
    });

    it('renders HTML previews in a sandboxed iframe with the AMC follow-up bridge', () => {
        const root = document.createElement('div');
        const wrapper = createCodeBlock(
            'amc-live-artifact-html',
            [
                '<button onclick="alert(1)">Run</button>',
                '<script>alert(2)</script>',
                '<iframe srcdoc="<script>alert(3)</script>"></iframe>',
                '<img src="https://example.com/remote.png">',
                '<img src="data:image/png;base64,AAAA">',
                '<button data-amc-followup=\'{"instruction":"Continue","state":{"selected":"B"}}\'>Continue</button>',
            ].join('')
        );
        root.appendChild(wrapper);

        enhanceLiveArtifacts(root);

        const frame = root.querySelector('iframe.live-artifact-frame');
        const srcdoc = readFrameSrcDoc(frame);

        expect(frame).not.toBeNull();
        expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
        expect(srcdoc).toContain('<button>Run</button>');
        expect(srcdoc).toContain('https://example.com/remote.png');
        expect(srcdoc).toContain('data:image/png;base64,AAAA');
        expect(srcdoc).toContain('amc-live-artifact-preview');
        expect(srcdoc).toContain('data-amc-followup');
        expect(srcdoc).toContain("notify('followup'");
        expect(srcdoc).not.toContain('onclick');
        expect(srcdoc).not.toContain('srcdoc=');
        expect(srcdoc).toContain('background:transparent');
        expect(srcdoc).not.toContain('body.artifact-html{padding:16px}');
    });

    it('replaces Live Artifact HTML code chrome with the inline artifact frame', () => {
        const wrapper = createCodeBlock(
            'amc-live-artifact-html',
            '<section><strong>Inline Artifact</strong></section>'
        );

        enhanceLiveArtifacts(wrapper);

        expect(wrapper.querySelector('pre')).toBeNull();
        expect(wrapper.querySelector('.code-header')).toBeNull();
        expect(wrapper.querySelector('.live-artifact-preview')).not.toBeNull();
        expect(wrapper.querySelector('iframe.live-artifact-frame')).not.toBeNull();
    });

    it('keeps regular HTML code blocks as code instead of inline Live Artifacts', () => {
        const wrapper = createCodeBlock('html', '<section><strong>Code sample</strong></section>');

        enhanceLiveArtifacts(wrapper);

        expect(wrapper.querySelector('pre')).not.toBeNull();
        expect(wrapper.querySelector('.live-artifact-preview')).toBeNull();
        expect(wrapper.dataset.liveArtifactEnhanced).toBeUndefined();
    });

    it('does not render blank Live Artifact frames for empty or non-HTML content', () => {
        const root = document.createElement('div');
        const emptyArtifact = createCodeBlock('amc-live-artifact-html', '   ');
        const textArtifact = createCodeBlock('amc-live-artifact-html', 'Just text');
        root.append(emptyArtifact, textArtifact);

        enhanceLiveArtifacts(root);

        expect(root.querySelector('.live-artifact-preview')).toBeNull();
        expect(emptyArtifact.querySelector('pre')).not.toBeNull();
        expect(textArtifact.querySelector('pre')).not.toBeNull();
    });

    it('forwards valid Live Artifact follow-up payloads from the current iframe', () => {
        const handleFollowUp = vi.fn();
        const preview = createLiveArtifactPreview(
            'html',
            '<section><button data-amc-followup="Continue">Continue</button></section>',
            { onFollowUp: handleFollowUp }
        );
        document.body.appendChild(preview);

        const frame = preview.querySelector('iframe.live-artifact-frame');
        const source = frame.contentWindow || {};

        window.dispatchEvent(
            new MessageEvent('message', {
                source,
                data: {
                    channel: 'amc-live-artifact-preview',
                    event: 'followup',
                    payload: { instruction: 'Continue' },
                },
            })
        );

        window.dispatchEvent(
            new MessageEvent('message', {
                source: {},
                data: {
                    channel: 'amc-live-artifact-preview',
                    event: 'followup',
                    payload: { instruction: 'Ignore' },
                },
            })
        );

        expect(handleFollowUp).toHaveBeenCalledTimes(1);
        expect(handleFollowUp).toHaveBeenCalledWith({ instruction: 'Continue' });
    });

    it('dispatches Live Artifact follow-up events when no callback is injected', () => {
        const handleFollowUpEvent = vi.fn();
        const preview = createLiveArtifactPreview(
            'html',
            '<section><button data-amc-followup="Continue">Continue</button></section>'
        );
        document.body.appendChild(preview);
        window.addEventListener(LIVE_ARTIFACT_FOLLOWUP_EVENT, handleFollowUpEvent);

        const frame = preview.querySelector('iframe.live-artifact-frame');
        const source = frame.contentWindow || {};

        window.dispatchEvent(
            new MessageEvent('message', {
                source,
                data: {
                    channel: 'amc-live-artifact-preview',
                    event: 'followup',
                    payload: { instruction: 'Continue' },
                },
            })
        );

        window.removeEventListener(LIVE_ARTIFACT_FOLLOWUP_EVENT, handleFollowUpEvent);

        expect(handleFollowUpEvent).toHaveBeenCalledTimes(1);
        expect(handleFollowUpEvent.mock.calls[0][0].detail).toEqual({ instruction: 'Continue' });
    });

    it('sanitizes SVG previews before embedding them in srcdoc', () => {
        const srcdoc = buildArtifactSrcDoc(
            'svg',
            [
                '<svg viewBox="0 0 10 10" onclick="alert(1)">',
                '<script>alert(2)</script>',
                '<foreignObject><button>bad</button></foreignObject>',
                '<a href="javascript:alert(3)"><rect width="10" height="10"/></a>',
                '</svg>',
            ].join('')
        );

        expect(srcdoc).toContain('<svg');
        expect(srcdoc).toContain('<rect');
        expect(srcdoc).not.toContain('<script');
        expect(srcdoc).not.toContain('onclick');
        expect(srcdoc).not.toContain('foreignObject');
        expect(srcdoc).not.toContain('javascript:');
    });

    it('enhances Mermaid code blocks with sanitized rendered SVG output', async () => {
        const root = document.createElement('div');
        const wrapper = createCodeBlock('mermaid', 'graph TD\n  A --> B');
        root.appendChild(wrapper);
        document.body.appendChild(root);
        const renderMermaid = vi.fn(
            async () =>
                '<svg onclick="alert(1)"><script>alert(2)</script><text>Rendered</text></svg>'
        );

        enhanceLiveArtifacts(root, { renderMermaid });
        await flushMicrotasks();

        const preview = wrapper.querySelector('.live-artifact-preview');
        const body = wrapper.querySelector('.live-artifact-body-mermaid');

        expect(renderMermaid).toHaveBeenCalledWith('graph TD\n  A --> B');
        expect(preview?.dataset.liveArtifactKind).toBe('mermaid');
        expect(body?.textContent).toContain('Rendered');
        expect(body?.innerHTML).not.toContain('<script');
        expect(body?.innerHTML).not.toContain('onclick');
    });

    it('defaults enhanced Mermaid blocks to the preview and toggles to code', async () => {
        const root = document.createElement('div');
        const wrapper = createCodeBlock('mermaid', 'graph TD\n  A --> B');
        root.appendChild(wrapper);
        document.body.appendChild(root);

        enhanceLiveArtifacts(root, {
            renderMermaid: vi.fn(async () => '<svg><text>Rendered</text></svg>'),
        });
        await flushMicrotasks();

        const toggle = wrapper.querySelector('.live-artifact-view-toggle');
        const [previewButton, codeButton] = toggle.querySelectorAll('.live-artifact-view-btn');

        expect(toggle).not.toBeNull();
        expect(wrapper.firstElementChild).toBe(wrapper.querySelector('.live-artifact-preview'));
        expect(
            wrapper.querySelector('.live-artifact-header-actions .copy-code-btn')
        ).not.toBeNull();
        expect(wrapper.querySelector('.code-header .copy-code-btn')).toBeNull();
        expect(wrapper.classList.contains('live-artifact-show-code')).toBe(false);
        expect(previewButton.classList.contains('is-active')).toBe(true);

        codeButton.click();
        expect(wrapper.classList.contains('live-artifact-show-code')).toBe(true);
        expect(codeButton.classList.contains('is-active')).toBe(true);

        previewButton.click();
        expect(wrapper.classList.contains('live-artifact-show-code')).toBe(false);
        expect(previewButton.classList.contains('is-active')).toBe(true);
    });

    it('zooms Mermaid previews with Ctrl + wheel', async () => {
        const preview = createLiveArtifactPreview('mermaid', 'graph TD\n  A --> B', {
            renderMermaid: vi.fn(async () => '<svg><text>Rendered</text></svg>'),
        });
        document.body.appendChild(preview);
        await flushMicrotasks();

        const body = preview.querySelector('.live-artifact-body-mermaid');
        const svg = body.querySelector('svg');
        svg.getBoundingClientRect = () => ({ width: 200, height: 100 });
        body.__refreshPreviewZoom();

        const stage = body.querySelector('.live-artifact-zoom-stage');
        expect(stage).not.toBeNull();

        body.dispatchEvent(
            new WheelEvent('wheel', {
                deltaY: -100,
                ctrlKey: true,
                cancelable: true,
                bubbles: true,
            })
        );
        expect(svg.style.width).toBe('220px');
        expect(stage.style.transform).toContain('translate');

        body.dispatchEvent(
            new WheelEvent('wheel', {
                deltaY: 100,
                ctrlKey: true,
                cancelable: true,
                bubbles: true,
            })
        );
        expect(svg.style.width).toBe('200px');
    });

    it('shows a compact error instead of Mermaid error SVG artwork', async () => {
        const preview = createLiveArtifactPreview('mermaid', 'graph TD\n  A -->', {
            renderMermaid: vi.fn(
                async () =>
                    '<svg><g class="error-icon"></g><text>Syntax error in text</text><text>mermaid version 10.9.6</text></svg>'
            ),
        });
        document.body.appendChild(preview);
        await flushMicrotasks();

        const body = preview.querySelector('.live-artifact-body-mermaid');

        expect(body?.classList.contains('live-artifact-body-error')).toBe(true);
        expect(body?.querySelector('.live-artifact-error')).not.toBeNull();
        expect(body?.querySelector('svg')).toBeNull();
        expect(body?.innerHTML).not.toContain('error-icon');
    });

    it('keeps streaming Mermaid parse failures in the loading state', async () => {
        const preview = createLiveArtifactPreview('mermaid', 'graph TD\n  A -->', {
            deferMermaidErrors: true,
            renderMermaid: vi.fn(async () => {
                throw new Error('Syntax error in text');
            }),
        });
        document.body.appendChild(preview);
        await flushMicrotasks();

        const body = preview.querySelector('.live-artifact-body-mermaid');

        expect(body?.classList.contains('live-artifact-body-loading')).toBe(true);
        expect(body?.classList.contains('live-artifact-body-error')).toBe(false);
        expect(body?.textContent).toBe('Rendering preview...');
    });

    it('enhances Graphviz code blocks with sanitized rendered SVG output', async () => {
        const root = document.createElement('div');
        const wrapper = createCodeBlock('dot', 'digraph G { A -> B; }');
        root.appendChild(wrapper);
        document.body.appendChild(root);
        const renderGraphviz = vi.fn(
            async () =>
                '<svg onclick="alert(1)"><script>alert(2)</script><text>Rendered</text></svg>'
        );

        enhanceLiveArtifacts(root, { renderGraphviz });
        await flushMicrotasks();

        const preview = wrapper.querySelector('.live-artifact-preview');
        const body = wrapper.querySelector('.live-artifact-body-graphviz');

        expect(renderGraphviz).toHaveBeenCalledWith('digraph G { A -> B; }');
        expect(preview?.dataset.liveArtifactKind).toBe('graphviz');
        expect(body?.textContent).toContain('Rendered');
        expect(body?.innerHTML).not.toContain('<script');
        expect(body?.innerHTML).not.toContain('onclick');
    });

    it('keeps streaming Graphviz render failures in the loading state', async () => {
        const preview = createLiveArtifactPreview('graphviz', 'digraph G { A ->', {
            deferGraphvizErrors: true,
            renderGraphviz: vi.fn(async () => {
                throw new Error('syntax error near line 1');
            }),
        });
        document.body.appendChild(preview);
        await flushMicrotasks();

        const body = preview.querySelector('.live-artifact-body-graphviz');

        expect(body?.classList.contains('live-artifact-body-loading')).toBe(true);
        expect(body?.classList.contains('live-artifact-body-error')).toBe(false);
        expect(body?.textContent).toBe('Rendering preview...');
    });

    it('can use an injected Graphviz loader for the default renderer', async () => {
        const renderSVGElement = vi.fn((source) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.innerHTML = '<text>Loaded</text>';
            return svg;
        });

        setGraphvizLoaderForTest(async () => ({
            instance: async () => ({ renderSVGElement }),
        }));

        const preview = createLiveArtifactPreview('graphviz', 'digraph G { A -> B; }');
        document.body.appendChild(preview);
        await flushMicrotasks();

        expect(renderSVGElement).toHaveBeenCalledWith(expect.stringContaining('rankdir="LR";'));
        expect(renderSVGElement).toHaveBeenCalledWith(
            expect.stringContaining('graph [bgcolor="transparent" fontcolor="#374151" margin="0"];')
        );
        expect(preview.textContent).toContain('Loaded');
    });

    it('evicts the stalest cached Graphviz render beyond the cache limit', async () => {
        const renderSVGElement = vi.fn((source) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.innerHTML = `<text>${source.slice(0, 24)}</text>`;
            return svg;
        });

        setGraphvizLoaderForTest(async () => ({
            instance: async () => ({ renderSVGElement }),
        }));

        const codes = Array.from(
            { length: GRAPHVIZ_CACHE_LIMIT + 1 },
            (_, index) => `digraph G${index} { A -> B${index}; }`
        );
        for (const code of codes) {
            document.body.appendChild(createLiveArtifactPreview('graphviz', code));
        }
        await flushMicrotasks();
        expect(renderSVGElement).toHaveBeenCalledTimes(GRAPHVIZ_CACHE_LIMIT + 1);

        // The first graph was evicted: rendering it again re-invokes viz.
        document.body.appendChild(createLiveArtifactPreview('graphviz', codes[0]));
        await flushMicrotasks();
        expect(renderSVGElement).toHaveBeenCalledTimes(GRAPHVIZ_CACHE_LIMIT + 2);

        // The most recent graph is still cached: no new render.
        document.body.appendChild(
            createLiveArtifactPreview('graphviz', codes[GRAPHVIZ_CACHE_LIMIT])
        );
        await flushMicrotasks();
        expect(renderSVGElement).toHaveBeenCalledTimes(GRAPHVIZ_CACHE_LIMIT + 2);
    });

    it('does not duplicate previews when the same node is enhanced again', () => {
        const wrapper = createCodeBlock('svg', '<svg viewBox="0 0 1 1"></svg>');

        enhanceLiveArtifacts(wrapper);
        enhanceLiveArtifacts(wrapper);

        expect(wrapper.querySelectorAll('.live-artifact-preview')).toHaveLength(1);
    });

    it('can use an injected Mermaid loader for the default renderer', async () => {
        const initialize = vi.fn();
        setMermaidLoaderForTest(async () => ({
            default: {
                initialize,
                parse: vi.fn(async () => true),
                render: vi.fn(async () => ({ svg: '<svg><text>Loaded</text></svg>' })),
            },
        }));

        const preview = createLiveArtifactPreview('mermaid', 'graph TD\n  A --> B');
        document.body.appendChild(preview);
        await flushMicrotasks();

        expect(initialize).toHaveBeenCalledWith(
            expect.objectContaining({
                flowchart: expect.objectContaining({ htmlLabels: false, useMaxWidth: true }),
            })
        );
        expect(preview.textContent).toContain('Loaded');
    });

    it('keeps sanitizer usable without DOM APIs', () => {
        const originalDocument = globalThis.document;

        try {
            Reflect.deleteProperty(globalThis, 'document');

            expect(sanitizeArtifactMarkup('<b>x</b>', 'html')).toBe('&lt;b&gt;x&lt;/b&gt;');
        } finally {
            globalThis.document = originalDocument;
        }
    });

    it('releases iframe message listeners when enhanced previews are cleaned up', () => {
        const root = document.createElement('div');
        const wrapper = createCodeBlock(
            'amc-live-artifact-html',
            '<section><button data-amc-followup="Continue">Continue</button></section>'
        );
        root.appendChild(wrapper);
        document.body.appendChild(root);

        const handleFollowUpEvent = vi.fn();
        window.addEventListener(LIVE_ARTIFACT_FOLLOWUP_EVENT, handleFollowUpEvent);

        enhanceLiveArtifacts(root);

        const preview = root.querySelector('.live-artifact-preview');
        expect(preview.dataset.liveArtifactEnhanced).toBe('true');

        const frame = preview.querySelector('iframe.live-artifact-frame');
        const source = frame.contentWindow || {};
        const dispatchFollowup = () =>
            window.dispatchEvent(
                new MessageEvent('message', {
                    source,
                    data: {
                        channel: 'amc-live-artifact-preview',
                        event: 'followup',
                        payload: { instruction: 'Continue' },
                    },
                })
            );

        dispatchFollowup();
        expect(handleFollowUpEvent).toHaveBeenCalledTimes(1);

        cleanupLiveArtifacts(root);

        dispatchFollowup();
        expect(handleFollowUpEvent).toHaveBeenCalledTimes(1);

        window.removeEventListener(LIVE_ARTIFACT_FOLLOWUP_EVENT, handleFollowUpEvent);
    });
});
