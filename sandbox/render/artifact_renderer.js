import { createPrefixedId } from '../../shared/utils/index.js';
import {
    LIVE_ARTIFACT_MESSAGE_CHANNEL,
    normalizeLiveArtifactFollowupPayload,
} from '../core/live_artifacts.js';
import { LIVE_ARTIFACT_FOLLOWUP_EVENT } from '../core/live_artifacts.js';
import { t } from '../core/i18n.js';
import { sanitizeArtifactMarkup, buildArtifactSrcDoc } from './artifact_sanitize.js';
import { getCodeLanguage } from './artifact_sanitize.js';
import { getArtifactKind } from './artifact_sanitize.js';

let mermaidLoader = () => import('mermaid');
let mermaidModulePromise = null;
let graphvizLoader = () => import('@viz-js/viz');
let graphvizInstancePromise = null;
export const GRAPHVIZ_CACHE_LIMIT = 30;
const graphvizCache = new Map();

async function loadMermaidModule() {
    if (!mermaidModulePromise) {
        mermaidModulePromise = mermaidLoader().then((module) => module.default || module);
    }
    return mermaidModulePromise;
}

async function loadGraphvizInstance() {
    if (!graphvizInstancePromise) {
        graphvizInstancePromise = graphvizLoader()
            .then((module) => {
                const createInstance = module.instance || module.default?.instance;
                if (typeof createInstance !== 'function') {
                    throw new Error(t('liveArtifactPreviewFailed'));
                }
                return createInstance();
            })
            .catch((error) => {
                graphvizInstancePromise = null;
                throw error;
            });
    }
    return graphvizInstancePromise;
}

async function renderMermaidToSvg(code) {
    const mermaid = await loadMermaidModule();
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
        fontFamily: 'inherit',
        flowchart: {
            htmlLabels: false,
            useMaxWidth: true,
        },
    });

    if (typeof mermaid.parse === 'function') {
        const parseResult = await mermaid.parse(code, { suppressErrors: false });
        if (parseResult === false) {
            throw new Error(t('liveArtifactPreviewFailed'));
        }
    }

    const result = await mermaid.render(createPrefixedId('mermaid_svg'), code);
    return result?.svg || '';
}

function isMermaidErrorSvg(svg) {
    const text = String(svg || '').toLowerCase();
    return (
        /class=["'][^"']*error-icon/i.test(svg) ||
        (text.includes('syntax error in text') && text.includes('mermaid version'))
    );
}

function getGraphvizThemeKey() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function getGraphvizLayoutDirection(code) {
    const match = String(code || '').match(/rankdir\s*=\s*(["']?)(LR|TB|RL|BT)\1/i);
    if (!match) return 'LR';

    const direction = match[2].toUpperCase();
    if (direction === 'TB' || direction === 'BT') return 'TB';
    return 'LR';
}

function prepareGraphvizCode(code, themeKey = getGraphvizThemeKey()) {
    let processedCode = String(code || '');
    const effectiveLayout = getGraphvizLayoutDirection(processedCode);
    const rankdirRegex = /(rankdir\s*=\s*)(["']?)(LR|TB|RL|BT)\2/gi;

    if (rankdirRegex.test(processedCode)) {
        processedCode = processedCode.replace(rankdirRegex, `$1"${effectiveLayout}"`);
    } else {
        const graphMatch = processedCode.match(
            /(\s*(?:strict\s+)?(?:di)?graph\s+[\w\d_"]*\s*\{|\s*(?:strict\s+)?(?:di)?graph\s*\{)/i
        );
        if (graphMatch) {
            processedCode = processedCode.replace(
                graphMatch[0],
                `${graphMatch[0]}\n  rankdir="${effectiveLayout}";`
            );
        }
    }

    const color = themeKey === 'dark' ? '#e4e4e7' : '#374151';
    const themeDefaults = `
        graph [bgcolor="transparent" fontcolor="${color}" margin="0"];
        node [color="${color}" fontcolor="${color}"];
        edge [color="${color}" fontcolor="${color}"];
      `;

    const openBraceIndex = processedCode.indexOf('{');
    if (openBraceIndex !== -1) {
        processedCode =
            processedCode.slice(0, openBraceIndex + 1) +
            themeDefaults +
            processedCode.slice(openBraceIndex + 1);
    }

    return {
        code: processedCode,
        layout: effectiveLayout,
        theme: themeKey,
    };
}

async function renderGraphvizToSvg(code) {
    const source = String(code || '');
    if (!source.trim()) return '';

    const prepared = prepareGraphvizCode(source);
    const cacheKey = `${prepared.theme}::${prepared.layout}::${source}`;
    if (graphvizCache.has(cacheKey)) {
        // Refresh recency so frequently viewed diagrams survive eviction.
        const cached = graphvizCache.get(cacheKey);
        graphvizCache.delete(cacheKey);
        graphvizCache.set(cacheKey, cached);
        return cached;
    }

    const vizInstance = await loadGraphvizInstance();
    const svgElement = await vizInstance.renderSVGElement(prepared.code);
    svgElement.style.maxWidth = '100%';
    svgElement.style.height = 'auto';
    svgElement.style.display = 'block';

    const svg = svgElement.outerHTML;
    graphvizCache.set(cacheKey, svg);
    while (graphvizCache.size > GRAPHVIZ_CACHE_LIMIT) {
        // Maps iterate in insertion order: the first key is the stalest.
        graphvizCache.delete(graphvizCache.keys().next().value);
    }
    return svg;
}

function setPreviewLoading(body) {
    body.classList.remove('live-artifact-body-error');
    body.classList.add('live-artifact-body-loading');
    body.setAttribute('aria-busy', 'true');
    body.textContent = t('liveArtifactRendering');
}

function setPreviewError(body, message) {
    body.classList.remove('live-artifact-body-loading');
    body.classList.add('live-artifact-body-error');
    body.removeAttribute('aria-busy');
    body.innerHTML = '';

    const error = document.createElement('div');
    error.className = 'live-artifact-error';
    error.textContent = message || t('liveArtifactPreviewFailed');
    body.appendChild(error);
}

function setPreviewSvg(body, svg) {
    body.classList.remove('live-artifact-body-loading', 'live-artifact-body-error');
    body.removeAttribute('aria-busy');
    body.innerHTML = svg;
}

function renderMermaidPreview(body, code, renderMermaid = renderMermaidToSvg, options = {}) {
    const deferErrors = options.deferErrors === true;
    setPreviewLoading(body);

    Promise.resolve(renderMermaid(code))
        .then((svg) => {
            if (!body.isConnected) return;
            if (isMermaidErrorSvg(svg)) {
                throw new Error(t('liveArtifactPreviewFailed'));
            }

            const sanitizedSvg = sanitizeArtifactMarkup(svg, 'svg');
            if (!sanitizedSvg) {
                setPreviewError(body, t('liveArtifactPreviewFailed'));
                return;
            }

            setPreviewSvg(body, sanitizedSvg);
        })
        .catch((error) => {
            if (!body.isConnected) return;
            if (deferErrors) {
                setPreviewLoading(body);
                return;
            }

            const errorMessage = error instanceof Error ? error.message : '';
            setPreviewError(body, errorMessage || t('liveArtifactPreviewFailed'));
        });
}

function formatGraphvizErrorMessage(error) {
    const message = error instanceof Error ? error.message : '';
    return message.replace(/.*error:\s*/i, '') || t('liveArtifactPreviewFailed');
}

function renderGraphvizPreview(body, code, renderGraphviz = renderGraphvizToSvg, options = {}) {
    const deferErrors = options.deferErrors === true;
    setPreviewLoading(body);

    Promise.resolve(renderGraphviz(code))
        .then((svg) => {
            if (!body.isConnected) return;
            const sanitizedSvg = sanitizeArtifactMarkup(svg, 'svg');
            if (!sanitizedSvg && String(code || '').trim()) {
                setPreviewError(body, t('liveArtifactPreviewFailed'));
                return;
            }

            setPreviewSvg(body, sanitizedSvg);
        })
        .catch((error) => {
            if (!body.isConnected) return;
            if (deferErrors) {
                setPreviewLoading(body);
                return;
            }

            setPreviewError(body, formatGraphvizErrorMessage(error));
        });
}

export function createLiveArtifactPreview(kind, code, options = {}) {
    const preview = document.createElement('section');
    preview.className = 'live-artifact-preview';
    preview.dataset.liveArtifactKind = kind;

    if (kind !== 'html') {
        const header = document.createElement('div');
        header.className = 'live-artifact-header';

        const title = document.createElement('span');
        title.className = 'live-artifact-title';
        title.textContent = t('liveArtifactPreview');

        const badge = document.createElement('span');
        badge.className = 'live-artifact-badge';
        badge.textContent = kind.toUpperCase();

        header.appendChild(title);
        header.appendChild(badge);
        preview.appendChild(header);
    }

    const body = document.createElement('div');
    body.className = `live-artifact-body live-artifact-body-${kind}`;
    preview.appendChild(body);

    if (kind === 'mermaid') {
        renderMermaidPreview(body, code, options.renderMermaid, {
            deferErrors: options.deferMermaidErrors === true,
        });
        return preview;
    }

    if (kind === 'graphviz') {
        renderGraphvizPreview(body, code, options.renderGraphviz, {
            deferErrors: options.deferGraphvizErrors === true,
        });
        return preview;
    }

    const frame = document.createElement('iframe');
    frame.className = 'live-artifact-frame';
    frame.title = `${t('liveArtifactPreviewTitle')} (${kind.toUpperCase()})`;
    frame.setAttribute('sandbox', kind === 'html' ? 'allow-scripts allow-forms' : '');
    frame.referrerPolicy = 'no-referrer';
    frame.loading = 'lazy';
    frame.srcdoc = buildArtifactSrcDoc(kind, code);
    body.appendChild(frame);

    if (kind === 'html') {
        const handleMessage = (event) => {
            // Security: verify the message comes from the iframe we created.
            // `event.source === frame.contentWindow` is an identity check — each
            // window object is unique and cannot be spoofed by another frame.
            // This is the correct gate for srcdoc iframes (which have a null
            // opaque origin, so event.origin is 'null' and not useful for
            // discrimination). The outbound `targetOrigin: '*'` in the bridge
            // script is required because sandboxed iframes cannot specify a
            // precise target origin; only this parent receives the message.
            if (event.source !== frame.contentWindow) return;

            const data = event.data || {};
            if (data.channel !== LIVE_ARTIFACT_MESSAGE_CHANNEL) return;

            if (data.event === 'followup') {
                const payload = normalizeLiveArtifactFollowupPayload(data.payload);
                if (payload) {
                    if (typeof options.onFollowUp === 'function') {
                        options.onFollowUp(payload);
                    } else {
                        window.dispatchEvent(
                            new CustomEvent(LIVE_ARTIFACT_FOLLOWUP_EVENT, { detail: payload })
                        );
                    }
                }
                return;
            }

            if (data.event === 'resize' && typeof data.height === 'number') {
                const height = Math.max(120, Math.ceil(data.height));
                frame.style.height = `${height}px`;
            }
        };
        window.addEventListener('message', handleMessage);
        preview.__liveArtifactCleanup = () => {
            window.removeEventListener('message', handleMessage);
        };
    }

    return preview;
}

function replaceCodeBlockWithPreview(wrapper, preview) {
    preview.dataset.liveArtifactEnhanced = 'true';

    if (wrapper.parentNode) {
        wrapper.replaceWith(preview);
        return;
    }

    wrapper.className = 'live-artifact-inline-wrapper';
    wrapper.innerHTML = '';
    wrapper.appendChild(preview);
}

export function cleanupLiveArtifacts(root) {
    if (!root || typeof document === 'undefined') return;
    const nodes = root.querySelectorAll?.('[data-live-artifact-enhanced="true"]');
    if (!nodes) return;
    nodes.forEach((node) => {
        const preview = node.querySelector?.('.live-artifact-preview') || node;
        if (typeof preview.__liveArtifactCleanup === 'function') {
            preview.__liveArtifactCleanup();
        }
    });
}

export function enhanceLiveArtifacts(root, options = {}) {
    if (!root || typeof document === 'undefined') return;

    const wrappers = root.matches?.('.code-block-wrapper')
        ? [root]
        : Array.from(root.querySelectorAll?.('.code-block-wrapper') || []);

    wrappers.forEach((wrapper) => {
        if (wrapper.dataset.liveArtifactEnhanced === 'true') return;

        const codeElement = wrapper.querySelector('pre code');
        const code = codeElement?.textContent || '';
        const kind = getArtifactKind(getCodeLanguage(wrapper), code);
        if (!kind) return;

        const preview = createLiveArtifactPreview(kind, code, options);
        if (kind === 'html') {
            replaceCodeBlockWithPreview(wrapper, preview);
            return;
        }

        wrapper.dataset.liveArtifactEnhanced = 'true';
        wrapper.appendChild(preview);
    });
}

export function setMermaidLoaderForTest(loader) {
    mermaidLoader = typeof loader === 'function' ? loader : () => import('mermaid');
    mermaidModulePromise = null;
}

export function setGraphvizLoaderForTest(loader) {
    graphvizLoader = typeof loader === 'function' ? loader : () => import('@viz-js/viz');
    graphvizInstancePromise = null;
    graphvizCache.clear();
}
