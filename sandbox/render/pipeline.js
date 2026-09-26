import { MathPlaceholderProtector } from './math_placeholders.js';
import { LIVE_ARTIFACT_HTML_LANGUAGE } from '../core/live_artifacts.js';
import { escapeHtml } from '../../shared/utils/escape.js';

const ALLOWED_TAGS = new Set([
    'a',
    'blockquote',
    'br',
    'button',
    'code',
    'del',
    'details',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
    'input',
    'kbd',
    'li',
    'ol',
    'p',
    'pre',
    's',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'svg',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
    'path',
    'polyline',
    'rect',
]);

const GLOBAL_ATTRS = new Set(['aria-hidden', 'aria-label', 'class', 'hidden', 'id', 'title']);

const TAG_ATTRS = {
    a: new Set(['href', 'target', 'rel']),
    button: new Set(['type']),
    code: new Set(['class']),
    img: new Set(['alt', 'src', 'title']),
    input: new Set(['checked', 'disabled', 'type']),
    path: new Set(['d']),
    polyline: new Set(['points']),
    rect: new Set(['height', 'rx', 'ry', 'width', 'x', 'y']),
    span: new Set(['data-line']),
    svg: new Set([
        'fill',
        'height',
        'stroke',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-width',
        'viewbox',
        'viewBox',
        'width',
        'xmlns',
    ]),
    th: new Set(['align']),
    td: new Set(['align']),
};

const URI_ATTRS = new Set(['href', 'src']);
const SAFE_URI_PATTERN = /^(https?:|data:image\/(?:png|gif|jpe?g|webp);base64,|blob:|#|\/)/i;
const FENCED_CODE_BLOCK_START_REGEX = /^\s*```/;
const HTML_DOCUMENT_REGEX = /^(?:<!doctype\s+html\b[^>]*>\s*)?<html\b[\s\S]*<\/html>$/i;
const HTML_FRAGMENT_TAG_NAMES = [
    'article',
    'aside',
    'blockquote',
    'button',
    'caption',
    'details',
    'div',
    'figure',
    'figcaption',
    'footer',
    'form',
    'h[1-6]',
    'header',
    'label',
    'li',
    'main',
    'meter',
    'nav',
    'ol',
    'p',
    'progress',
    'section',
    'select',
    'span',
    'summary',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
].join('|');
const HTML_FRAGMENT_REGEX = new RegExp(
    `^<(?:${HTML_FRAGMENT_TAG_NAMES})(?:\\s[^>]*)?>[\\s\\S]*<\\/(?:${HTML_FRAGMENT_TAG_NAMES})>$`,
    'i'
);
const UNSAFE_ARTIFACT_FRAGMENT_TAG_REGEX = /<(?:script|style|iframe|object|embed)\b/i;

function isAllowedAttribute(tagName, attrName) {
    const lower = attrName.toLowerCase();
    if (lower.startsWith('on')) return false;
    if (lower.startsWith('data-')) {
        // Only allow safe data-* values: alphanum, dash, underscore
        return /^[a-z0-9_-]+$/.test(lower.slice(5)) && lower.length < 64;
    }
    return GLOBAL_ATTRS.has(lower) || TAG_ATTRS[tagName]?.has(lower) === true;
}

function isSafeAttributeValue(attrName, value) {
    if (!URI_ATTRS.has(attrName)) return true;
    return SAFE_URI_PATTERN.test(String(value || '').trim());
}

function sanitizeElement(element) {
    const tagName = element.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) {
        element.remove();
        return;
    }

    Array.from(element.attributes).forEach((attr) => {
        const attrName = attr.name.toLowerCase();
        if (!isAllowedAttribute(tagName, attrName) || !isSafeAttributeValue(attrName, attr.value)) {
            element.removeAttribute(attr.name);
        }
    });

    if (tagName === 'a' && element.getAttribute('target') === '_blank') {
        element.setAttribute('rel', 'noopener noreferrer');
    }
}

function sanitizeHtml(html) {
    if (typeof document === 'undefined') return escapeHtml(html);

    const template = document.createElement('template');
    template.innerHTML = html || '';
    Array.from(template.content.querySelectorAll('*')).forEach(sanitizeElement);
    return template.innerHTML;
}

function isStandaloneHtmlArtifact(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || FENCED_CODE_BLOCK_START_REGEX.test(trimmed)) return false;
    if (UNSAFE_ARTIFACT_FRAGMENT_TAG_REGEX.test(trimmed)) return false;
    return HTML_DOCUMENT_REGEX.test(trimmed) || HTML_FRAGMENT_REGEX.test(trimmed);
}

function normalizePreviewableMarkdownContent(text) {
    if (!isStandaloneHtmlArtifact(text)) return text || '';

    const content = String(text || '').trim();
    return `\`\`\`${LIVE_ARTIFACT_HTML_LANGUAGE}\n${content}\n\`\`\``;
}

/**
 * Transforms raw text into HTML with Math placeholders protected/restored.
 * @param {string} text - Raw Markdown text
 * @returns {string} - HTML string
 */
export function transformMarkdown(text) {
    try {
        if (typeof marked === 'undefined') {
            // Library loads asynchronously; app will rerender when ready.
            // Return raw text in the meantime without polluting console.
            return escapeHtml(text);
        }

        const mathHandler = new MathPlaceholderProtector();

        let processedText = mathHandler.protect(normalizePreviewableMarkdownContent(text));

        let html = marked.parse(processedText);

        html = mathHandler.restore(html);

        return sanitizeHtml(html);
    } catch (error) {
        // One bad input must not break the whole message update (notably
        // streaming, where every token re-renders the full text).
        console.error('[Gemini Nexus] Markdown transform failed, falling back to text', error);
        return escapeHtml(text);
    }
}
