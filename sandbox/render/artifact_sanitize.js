import {
    HTML_LANGUAGES,
    SVG_LANGUAGES,
    MERMAID_LANGUAGES,
    GRAPHVIZ_LANGUAGES,
    TEXT_LANGUAGES,
    DANGEROUS_TAGS,
    BLOCKED_ATTRS,
    URI_ATTRS,
    ARTIFACT_BRIDGE_SCRIPT,
    STREAMING_PATCH_SCRIPT,
} from './artifact_constants.js';
import { escapeHtml } from '../../shared/utils/escape.js';

function normalizeLanguage(language) {
    return String(language || '')
        .trim()
        .split(/\s+/)[0]
        .toLowerCase();
}

function getCodeLanguage(wrapper) {
    const dataLang = wrapper.dataset?.codeLang;
    if (dataLang) return dataLang;

    const labelLang = wrapper.querySelector('.code-lang')?.textContent;
    if (labelLang) return labelLang;

    const code = wrapper.querySelector('pre code');
    const languageClass = Array.from(code?.classList || []).find((className) =>
        className.startsWith('language-')
    );
    return languageClass ? languageClass.slice('language-'.length) : '';
}

function looksLikeSvg(code) {
    return /^\s*<svg(?:\s|>)/i.test(code);
}

function looksLikeHtml(code) {
    return /^\s*(?:<!doctype\s+html|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)|<(?:article|aside|blockquote|button|canvas|caption|details|div|figure|figcaption|footer|form|h[1-6]|header|label|li|main|meter|nav|ol|p|progress|section|select|span|summary|table|tbody|td|tfoot|th|thead|tr|ul|style)(?:\s|>))/i.test(
        code
    );
}

function stripMermaidComments(code) {
    return String(code || '')
        .replace(/^(?:\s*%%[^\n]*(?:\n|$))+/, '')
        .trim();
}

function looksLikeMermaid(code) {
    return /^(?:c4component|c4container|c4context|classdiagram|erdiagram|flowchart|gantt|gitgraph|graph|journey|mindmap|pie|quadrantchart|requirementdiagram|sequencediagram|statediagram(?:-v2)?|timeline)\b/i.test(
        stripMermaidComments(code)
    );
}

function looksLikeGraphviz(code) {
    return /^\s*(?:strict\s+)?(?:di)?graph(?:\s+[\w\d_"]+)?\s*\{/i.test(code);
}

function looksLikeLiveArtifactHtml(code) {
    const text = String(code || '');
    // Live Artifacts always use AMC design tokens or the required root container pattern.
    // This distinguishes them from plain HTML code samples like <section><strong>Code sample</strong></section>.
    return (
        /var\(--amc-live-artifact/i.test(text) ||
        (/display\s*:\s*block/i.test(text) && /width\s*:\s*100%/i.test(text))
    );
}

export function getArtifactKind(language, code = '') {
    const normalizedLanguage = normalizeLanguage(language);
    const trimmedCode = String(code || '').trim();

    if (HTML_LANGUAGES.has(normalizedLanguage)) return looksLikeHtml(trimmedCode) ? 'html' : null;
    if (SVG_LANGUAGES.has(normalizedLanguage)) return 'svg';
    if (MERMAID_LANGUAGES.has(normalizedLanguage)) return 'mermaid';
    if (GRAPHVIZ_LANGUAGES.has(normalizedLanguage)) return 'graphviz';
    if (looksLikeSvg(trimmedCode)) return 'svg';

    if (TEXT_LANGUAGES.has(normalizedLanguage)) {
        if (looksLikeHtml(trimmedCode) && looksLikeLiveArtifactHtml(trimmedCode)) return 'html';
        if (looksLikeMermaid(trimmedCode)) return 'mermaid';
        if (looksLikeGraphviz(trimmedCode)) return 'graphviz';
    }

    // Tolerant handling for model wrapping Live Artifacts in ```html fences.
    // Only treat html fences as live artifacts when they actually look like
    // Live Artifacts (contain AMC tokens / root container pattern), otherwise
    // keep them as plain code blocks (see artifacts.test.js).
    if (
        normalizedLanguage === 'html' ||
        normalizedLanguage === 'htm' ||
        normalizedLanguage === 'xml'
    ) {
        if (looksLikeHtml(trimmedCode) && looksLikeLiveArtifactHtml(trimmedCode)) return 'html';
    }

    // Tolerant: markdown fences wrapping Live Artifacts (model sometimes uses ```markdown)
    if (
        (normalizedLanguage === 'markdown' || normalizedLanguage === 'md') &&
        looksLikeHtml(trimmedCode) &&
        looksLikeLiveArtifactHtml(trimmedCode)
    ) {
        return 'html';
    }

    return null;
}

function isSafePreviewUrl(value) {
    const normalized = String(value || '')
        .replace(/[\u0000-\u001f]+/g, '')
        .trim();

    if (!normalized || normalized.startsWith('#')) return true;
    return /^(https?:|data:image\/(?:gif|jpe?g|png|svg\+xml|webp);base64,|blob:|\/)/i.test(
        normalized
    );
}

function sanitizeCssText(cssText) {
    return String(cssText || '')
        .replace(/@import\s+[^;]+;?/gi, '')
        .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote, url) =>
            isSafePreviewUrl(url) ? match : ''
        )
        .replace(/expression\s*\([^)]*\)/gi, '')
        .replace(/-moz-binding\s*:[^;]+;?/gi, '')
        .replace(/javascript\s*:/gi, '');
}

function sanitizePreviewElement(element, kind) {
    const tagName = element.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tagName) || (kind === 'svg' && tagName === 'foreignobject')) {
        element.remove();
        return;
    }

    Array.from(element.attributes || []).forEach((attr) => {
        const attrName = attr.name.toLowerCase();
        if (attrName.startsWith('on') || BLOCKED_ATTRS.has(attrName)) {
            element.removeAttribute(attr.name);
            return;
        }

        if (URI_ATTRS.has(attrName) && !isSafePreviewUrl(attr.value)) {
            element.removeAttribute(attr.name);
            return;
        }

        if (attrName === 'style') {
            const sanitizedStyle = sanitizeCssText(attr.value);
            if (sanitizedStyle.trim()) {
                element.setAttribute(attr.name, sanitizedStyle);
            } else {
                element.removeAttribute(attr.name);
            }
        }
    });

    if (tagName === 'style') {
        element.textContent = sanitizeCssText(element.textContent || '');
    }
}

function sanitizePreviewContainer(container, kind) {
    Array.from(container.querySelectorAll('*')).forEach((element) =>
        sanitizePreviewElement(element, kind)
    );
}

export function sanitizeArtifactMarkup(markup, kind = 'html') {
    if (typeof document === 'undefined') return escapeHtml(markup);

    const source = String(markup || '');
    if (kind === 'html') {
        const parsed = new DOMParser().parseFromString(source, 'text/html');
        sanitizePreviewContainer(parsed, 'html');

        const styleHtml = Array.from(parsed.head.querySelectorAll('style'))
            .map((style) => style.outerHTML)
            .join('');
        return `${styleHtml}${parsed.body.innerHTML}`.trim();
    }

    const template = document.createElement('template');
    template.innerHTML = source;
    sanitizePreviewContainer(template.content, 'svg');
    const svg = template.content.querySelector('svg');
    return svg ? svg.outerHTML : template.innerHTML.trim();
}

// Live Artifacts markup uses this token layer for semantic colors, surfaces and
// borders. Define it inside the preview document: an iframe does not inherit
// custom properties from the host page, so without these every var() reference
// in the model's markup resolves to nothing and the artifact renders colorless.
const ARTIFACT_THEME_STYLE = `
:root{
    color-scheme:light;
    --amc-live-artifact-font-size:16px;
    --amc-live-artifact-text:#1f1f1f;
    --amc-live-artifact-muted:#5e5e5e;
    --amc-live-artifact-subtle:#80868b;
    --amc-live-artifact-border:#e1e3e1;
    --amc-live-artifact-surface:#f8fafd;
    --amc-live-artifact-surface-muted:rgba(0,0,0,0.04);
    --amc-live-artifact-accent:#0b57d0;
    --amc-live-artifact-accent-surface:color-mix(in srgb,#0b57d0 22%,transparent);
    --amc-live-artifact-success:#047857;
    --amc-live-artifact-success-surface:color-mix(in srgb,#047857 22%,transparent);
    --amc-live-artifact-warning:#b45309;
    --amc-live-artifact-warning-surface:color-mix(in srgb,#b45309 22%,transparent);
    --amc-live-artifact-danger:#c62828;
    --amc-live-artifact-danger-surface:color-mix(in srgb,#c62828 22%,transparent);
}
:root[data-theme='dark']{
    color-scheme:dark;
    --amc-live-artifact-text:#e3e3e3;
    --amc-live-artifact-muted:#c4c7c5;
    --amc-live-artifact-subtle:#8e918f;
    --amc-live-artifact-border:#3c4043;
    --amc-live-artifact-surface:#1e1f20;
    --amc-live-artifact-surface-muted:rgba(255,255,255,0.06);
    --amc-live-artifact-accent:#6b9ef5;
    --amc-live-artifact-accent-surface:color-mix(in srgb,#6b9ef5 22%,transparent);
    --amc-live-artifact-success:#81c995;
    --amc-live-artifact-success-surface:color-mix(in srgb,#81c995 22%,transparent);
    --amc-live-artifact-warning:#fdd663;
    --amc-live-artifact-warning-surface:color-mix(in srgb,#fdd663 22%,transparent);
    --amc-live-artifact-danger:#f2b8b5;
    --amc-live-artifact-danger-surface:color-mix(in srgb,#f2b8b5 22%,transparent);
}
`;

export function buildArtifactSrcDoc(kind, code, options = {}) {
    const sanitizedMarkup = sanitizeArtifactMarkup(code, kind);
    const bodyClass = kind === 'svg' ? 'artifact-svg' : 'artifact-html';
    const streaming = kind === 'html' && options.streaming === true;
    const bridgeScript = kind === 'html' ? ARTIFACT_BRIDGE_SCRIPT : '';
    const streamScript = streaming ? STREAMING_PATCH_SCRIPT : '';
    // Streaming updates patch children of a stable root; the initial document
    // uses the same shape so the first postMessage can reconcile in place.
    const bodyMarkup = streaming
        ? `<div data-amc-artifact-root>${sanitizedMarkup}</div>`
        : sanitizedMarkup;
    const theme = options.theme === 'dark' ? 'dark' : 'light';

    return `<!doctype html>
<html data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'unsafe-inline'; connect-src https: data: blob:; media-src https: data: blob:; form-action 'none'; base-uri 'none'">
<style>
${ARTIFACT_THEME_STYLE}
html,body{min-height:100%;margin:0;background:transparent;color:var(--amc-live-artifact-text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{box-sizing:border-box;overflow:hidden;font-size:var(--amc-live-artifact-font-size)}
body.artifact-html{padding:0}
body.artifact-svg{display:grid;place-items:center;padding:16px}
*,*::before,*::after{box-sizing:border-box}
img,svg,canvas,video{max-width:100%}
svg{height:auto}
</style>
</head>
<body class="${bodyClass}">${bodyMarkup}${bridgeScript}${streamScript}</body>
</html>`;
}

export { getCodeLanguage };
