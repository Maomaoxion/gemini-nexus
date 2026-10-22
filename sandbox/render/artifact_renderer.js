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
    body.__refreshPreviewZoom?.();
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

const PREVIEW_MIN_ZOOM = 0.5;
const PREVIEW_MAX_ZOOM = 3;
const PREVIEW_ZOOM_STEP = 0.1;

function attachPreviewZoom(body) {
    let zoom = 1;
    let translateX = 0;
    let translateY = 0;
    let stage = null;
    let svgElement = null;
    let baseWidth = 0;
    let baseHeight = 0;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartTranslateX = 0;
    let dragStartTranslateY = 0;
    let retryCount = 0;

    const applyTransform = () => {
        if (!stage) return;
        // Integer translation avoids sub-pixel resampling, which makes vector
        // content look soft until the next forced repaint.
        stage.style.transform = `translate(${Math.round(translateX)}px, ${Math.round(translateY)}px)`;
    };

    const applyScale = () => {
        if (!stage || !svgElement) return;

        // Resize the SVG instead of CSS-scaling it: vector content is re-rasterized
        // at the new size, so zoomed diagrams stay sharp.
        const width = Math.round(baseWidth * zoom);
        const height = Math.round(baseHeight * zoom);
        svgElement.style.width = `${width}px`;
        svgElement.style.height = `${height}px`;
        stage.style.width = `${width}px`;
        stage.style.height = `${height}px`;
        applyTransform();
    };

    const centerContent = () => {
        translateX = Math.max(0, (body.clientWidth - baseWidth * zoom) / 2);
        translateY = Math.max(0, (body.clientHeight - baseHeight * zoom) / 2);
        applyScale();
    };

    const setup = () => {
        const svg = body.querySelector('svg');
        if (!svg) return;
        if (stage?.contains(svg)) return;

        const rect = svg.getBoundingClientRect();
        baseWidth = rect.width || svg.clientWidth || 0;
        baseHeight = rect.height || svg.clientHeight || 0;
        if (!baseWidth || !baseHeight) {
            if (retryCount < 2) {
                retryCount++;
                requestAnimationFrame(() => setup());
            }
            return;
        }
        retryCount = 0;

        body.classList.add('live-artifact-zoom-enabled');
        body.style.height = `${Math.min(520, Math.max(150, baseHeight + 32))}px`;

        stage = document.createElement('div');
        stage.className = 'live-artifact-zoom-stage';
        stage.style.width = `${baseWidth}px`;
        stage.style.height = `${baseHeight}px`;

        svg.style.maxWidth = 'none';
        svg.style.maxHeight = 'none';
        svg.style.width = `${baseWidth}px`;
        svg.style.height = `${baseHeight}px`;
        svg.setAttribute('shape-rendering', 'geometricPrecision');

        body.replaceChildren(stage);
        stage.appendChild(svg);
        svgElement = svg;
        zoom = 1;
        centerContent();
    };

    // setPreviewSvg rewrites innerHTML on every render; re-wrap the new SVG.
    body.__refreshPreviewZoom = () => {
        stage = null;
        svgElement = null;
        setup();
    };

    const observer =
        typeof MutationObserver === 'function'
            ? new MutationObserver(() => {
                  if (
                      !stage ||
                      !body.contains(stage) ||
                      !body.querySelector('.live-artifact-zoom-stage svg')
                  ) {
                      setup();
                  }
              })
            : null;
    observer?.observe(body, { childList: true });

    body.addEventListener(
        'wheel',
        (event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            if (!stage) return;

            const rect = body.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            const previousZoom = zoom;
            const direction = event.deltaY < 0 ? 1 : -1;
            zoom = Math.min(
                PREVIEW_MAX_ZOOM,
                Math.max(PREVIEW_MIN_ZOOM, zoom + direction * PREVIEW_ZOOM_STEP)
            );

            // Keep the point under the cursor anchored while zooming.
            translateX = mouseX - ((mouseX - translateX) / previousZoom) * zoom;
            translateY = mouseY - ((mouseY - translateY) / previousZoom) * zoom;
            applyScale();
        },
        { passive: false }
    );

    body.addEventListener('pointerdown', (event) => {
        if (!stage || event.button !== 0 || event.ctrlKey || event.metaKey) return;
        dragging = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragStartTranslateX = translateX;
        dragStartTranslateY = translateY;
        body.setPointerCapture?.(event.pointerId);
        body.classList.add('is-panning');
        event.preventDefault();
    });

    body.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        translateX = dragStartTranslateX + (event.clientX - dragStartX);
        translateY = dragStartTranslateY + (event.clientY - dragStartY);
        applyTransform();
    });

    const endDrag = (event) => {
        if (!dragging) return;
        dragging = false;
        body.releasePointerCapture?.(event.pointerId);
        body.classList.remove('is-panning');
    };
    body.addEventListener('pointerup', endDrag);
    body.addEventListener('pointercancel', endDrag);
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
        title.textContent = kind.toUpperCase();

        const actions = document.createElement('div');
        actions.className = 'live-artifact-header-actions';

        header.appendChild(title);
        header.appendChild(actions);
        preview.appendChild(header);
    }

    const body = document.createElement('div');
    body.className = `live-artifact-body live-artifact-body-${kind}`;
    preview.appendChild(body);

    if (kind === 'mermaid') {
        attachPreviewZoom(body);
        renderMermaidPreview(body, code, options.renderMermaid, {
            deferErrors: options.deferMermaidErrors === true,
        });
        return preview;
    }

    if (kind === 'graphviz') {
        attachPreviewZoom(body);
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
        addArtifactViewToggle(wrapper, preview);
        // Keep the shared header (kind + view switch) above the source block
        // when the user switches to code.
        wrapper.prepend(preview);
    });
}

/**
 * Mermaid/graphviz blocks keep the source for copy/debugging but default to
 * the preview, so the message does not take twice the vertical space.
 */
function addArtifactViewToggle(wrapper, preview) {
    const actions = preview.querySelector('.live-artifact-header-actions');
    const previewBody = preview.querySelector('.live-artifact-body');
    if (!actions || !previewBody) return;

    // The source block's own header becomes redundant once the shared header
    // exists; keep its copy action and move it into the shared header.
    const copyButton = wrapper.querySelector('.code-header .copy-code-btn');
    if (copyButton) {
        actions.appendChild(copyButton);
    }

    const toggle = document.createElement('div');
    toggle.className = 'live-artifact-view-toggle';

    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'live-artifact-view-btn is-active';
    previewButton.textContent = t('liveArtifactPreview');

    const codeButton = document.createElement('button');
    codeButton.type = 'button';
    codeButton.className = 'live-artifact-view-btn';
    codeButton.textContent = t('liveArtifactCode');

    const setView = (view) => {
        const showCode = view === 'code';
        wrapper.classList.toggle('live-artifact-show-code', showCode);
        previewButton.classList.toggle('is-active', !showCode);
        codeButton.classList.toggle('is-active', showCode);
    };

    previewButton.addEventListener('click', () => setView('preview'));
    codeButton.addEventListener('click', () => setView('code'));

    toggle.appendChild(previewButton);
    toggle.appendChild(codeButton);
    actions.appendChild(toggle);
    setView('preview');
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
