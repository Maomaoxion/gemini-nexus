import { transformMarkdown } from './pipeline.js';
import { cleanupLiveArtifacts, enhanceLiveArtifacts } from './artifacts.js';
import { escapeHtml } from '../../shared/utils/escape.js';
import { formatT, t } from '../core/i18n.js';
import { TemplateIcons } from '../ui/templates/icons.js';
import { createPrefixedId } from '../../shared/utils/index.js';
import { parseToolOutputHeader } from '../../shared/text/tool_call_text.js';

const TOOL_STEP_FOOTER_PATTERN = /\n\n\[Proceeding to step\s+(\d+)\]\s*$/;
const TOOL_DISCLOSURE_PREFIX = 'tool-disclosure';
// Browser-control actions share the input "Control" button glyph (cursor-chat mask).
const BROWSER_CONTROL_TOOL_ICON = {
    id: 'browser-control',
    html: TemplateIcons.BROWSER_CONTROL,
};
const BROWSER_CONTROL_TOOL_NAMES = [
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
    'wait_for_timeout',
    'list_downloads',
    'wait_for_download',
    'handle_dialog',
    'evaluate_script',
    'drag',
    'scroll',
    'run_steps',
];
const TOOL_ICON_BY_NAME = new Map(
    BROWSER_CONTROL_TOOL_NAMES.map((name) => [name, BROWSER_CONTROL_TOOL_ICON])
);
const TOOL_ICON_KEYWORDS = [
    { pattern: /(?:search|find|lookup|query|grep|rg)/i, id: 'search', html: TemplateIcons.SEARCH },
    {
        pattern: /(?:browser|page|tab|navigate|open|url|web)/i,
        id: 'page',
        html: TemplateIcons.BROWSER_TAB,
    },
    {
        pattern: /(?:screenshot|capture|image|vision|ocr)/i,
        id: 'capture',
        html: TemplateIcons.SCREEN_CAPTURE,
    },
    { pattern: /(?:keyboard|press|type|input)/i, id: 'keyboard', html: TemplateIcons.KEYBOARD },
    { pattern: /(?:file|attach|upload)/i, id: 'attach', html: TemplateIcons.PAPERCLIP },
    { pattern: /(?:download|export|save)/i, id: 'download', html: TemplateIcons.DOWNLOAD },
    { pattern: /(?:edit|write|patch|update|replace)/i, id: 'edit', html: TemplateIcons.EDIT },
    { pattern: /(?:read|document|context|summary)/i, id: 'document', html: TemplateIcons.SUMMARY },
    { pattern: /(?:database|sql|db|store)/i, id: 'database', html: TemplateIcons.DATABASE },
    { pattern: /(?:key|secret|auth|token)/i, id: 'key', html: TemplateIcons.KEY },
    {
        pattern: /(?:terminal|shell|exec|command|bash|run)/i,
        id: 'terminal',
        html: TemplateIcons.TERMINAL,
    },
    { pattern: /(?:code|script|evaluate|eval)/i, id: 'code', html: TemplateIcons.CODE },
];
const FALLBACK_TOOL_ICON = { id: 'tool', html: TemplateIcons.PLUG };

function normalizeEscapedFenceMarkers(text) {
    return (text || '')
        .replace(/(?:\\+`){3}/g, '```')
        .replace(/&grave;/gi, '`')
        .replace(/&#96;/g, '`')
        .replace(/&Backtick;/gi, '`');
}

function stripOuterMarkdownFence(text) {
    const trimmed = normalizeEscapedFenceMarkers(text).trim();
    if (!trimmed) return '';

    const withoutOpening = trimmed.replace(
        /^```[ \t]*(?:json|javascript|js|text|txt)?(?:[ \t]*\r?\n|[ \t]+)?/i,
        ''
    );
    return withoutOpening.replace(/\r?\n?[ \t]*```[\s\S]*$/i, '').trim();
}

// Tool calls and tool outputs are both JSON payloads shown in a fence; pretty
// print them and fall back to the raw text when a model emits malformed JSON.
function formatToolJsonBody(text) {
    const trimmed = stripOuterMarkdownFence(text);
    if (!trimmed) return '';

    try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
        return trimmed;
    }
}

function sanitizeToolName(toolName) {
    const raw = typeof toolName === 'string' ? toolName.trim() : '';
    if (!raw) return t('toolFallbackName');

    const withoutRouting = raw.includes('__') ? raw.split('__').pop() : raw;
    const withoutPrefix = withoutRouting.replace(/^mcp[_-]+/i, '');
    const words = withoutPrefix
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_./:-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return words || t('toolFallbackName');
}

function normalizeToolNameForIcon(toolName) {
    const raw = typeof toolName === 'string' ? toolName.trim() : '';
    const routedName = raw.includes('__') ? raw.split('__').pop() : raw;
    return routedName.replace(/^mcp[_-]+/i, '').toLowerCase();
}

function getToolIcon(toolName) {
    const normalized = normalizeToolNameForIcon(toolName);
    if (!normalized) return FALLBACK_TOOL_ICON;

    const exactIcon = TOOL_ICON_BY_NAME.get(normalized);
    if (exactIcon) return exactIcon;

    for (const keywordIcon of TOOL_ICON_KEYWORDS) {
        if (keywordIcon.pattern.test(normalized)) return keywordIcon;
    }

    return FALLBACK_TOOL_ICON;
}

function createToolIcon(toolName) {
    const icon = getToolIcon(toolName);
    const element = document.createElement('span');
    element.className = 'tool-disclosure-icon';
    element.dataset.toolIcon = icon.id;
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = icon.html;
    return element;
}

function normalizeToolStatus(status) {
    const normalized = typeof status === 'string' ? status.toLowerCase() : '';
    if (['running', 'completed', 'failed', 'cancelled'].includes(normalized)) {
        return normalized;
    }
    return 'completed';
}

function getToolStatusCopy(status, displayName) {
    if (status === 'running') return formatT('toolStatusRunning', { name: displayName });
    if (status === 'failed') return formatT('toolStatusFailed', { name: displayName });
    if (status === 'cancelled') return formatT('toolStatusCancelled', { name: displayName });
    return formatT('toolStatusUsed', { name: displayName });
}

function getToolBadgeText(status) {
    if (status === 'running') return t('toolBadgeRunning');
    if (status === 'failed') return t('toolBadgeFailed');
    if (status === 'cancelled') return t('toolBadgeCancelled');
    return t('toolBadgeDone');
}

function formatDurationMs(durationMs) {
    const value = Number(durationMs);
    if (!Number.isFinite(value) || value < 0) return '';

    if (value < 1000) return `${Math.round(value)}ms`;
    if (value < 10000) return `${(value / 1000).toFixed(1)}s`;
    return `${Math.round(value / 1000)}s`;
}

function parseToolOutputText(text) {
    const value = typeof text === 'string' ? text : '';
    const { toolName, body } = parseToolOutputHeader(value);
    const stepMatch = body.match(TOOL_STEP_FOOTER_PATTERN);
    const bodyEnd = stepMatch ? body.length - stepMatch[0].length : body.length;

    return {
        toolName,
        body: body.slice(0, bodyEnd),
        step: stepMatch ? stepMatch[1] : '',
    };
}

function createToolDisclosure(contentDiv, text, options = {}) {
    const parsed = parseToolOutputText(text);
    const rawToolName = options.toolName || parsed.toolName || '';
    const step = options.step || parsed.step || '';
    const callIndex = Number(options.callIndex);
    const callCount = Number(options.callCount);
    const status = normalizeToolStatus(options.toolStatus);
    const outputText = options.kind === 'tool-status' ? text || '' : parsed.body;
    const formattedBody = formatToolJsonBody(outputText);
    const formattedToolCall = formatToolJsonBody(options.toolCallText);
    const displayName = sanitizeToolName(rawToolName);
    const regionId = createPrefixedId(TOOL_DISCLOSURE_PREFIX);
    // Progress updates re-render the card; keep the user's expanded state
    // instead of collapsing it under them.
    const wasExpanded =
        contentDiv
            .querySelector(':scope > .tool-disclosure')
            ?.classList.contains('tool-disclosure-expanded') === true;
    const expanded = wasExpanded || options.isCollapsed === false;
    const hasOutput = formattedBody.trim().length > 0;
    const durationText = formatDurationMs(options.toolDurationMs);

    contentDiv.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = `tool-disclosure tool-disclosure-${status}`;
    wrapper.dataset.toolStatus = status;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tool-disclosure-toggle';
    toggle.setAttribute('aria-controls', regionId);

    const arrow = document.createElement('span');
    arrow.className = 'tool-disclosure-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';

    const main = document.createElement('span');
    main.className = 'tool-disclosure-main';

    const title = document.createElement('span');
    title.className = 'tool-disclosure-title';
    title.textContent = getToolStatusCopy(status, displayName);

    const badge = document.createElement('span');
    badge.className = 'tool-disclosure-badge';
    badge.textContent = getToolBadgeText(status);

    main.appendChild(title);
    main.appendChild(badge);

    toggle.appendChild(arrow);
    toggle.appendChild(createToolIcon(rawToolName));
    toggle.appendChild(main);

    const body = document.createElement('div');
    body.id = regionId;
    body.className = 'tool-disclosure-body';

    if (
        step ||
        durationText ||
        (Number.isFinite(callIndex) && Number.isFinite(callCount) && callCount > 1)
    ) {
        const meta = document.createElement('div');
        meta.className = 'tool-disclosure-meta';
        const metaParts = [];
        if (step) metaParts.push(formatT('stepLabel', { step }));
        if (Number.isFinite(callIndex) && Number.isFinite(callCount) && callCount > 1) {
            metaParts.push(formatT('callLabel', { index: callIndex, count: callCount }));
        }
        if (durationText) metaParts.push(formatT('durationLabel', { duration: durationText }));
        meta.textContent = metaParts.join(' · ');
        body.appendChild(meta);
    }

    if (formattedToolCall) {
        const call = document.createElement('div');
        call.className = 'tool-call-body';
        const label = document.createElement('div');
        label.className = 'tool-block-label';
        label.textContent = t('toolCallLabel');
        const pre = document.createElement('pre');
        pre.className = 'tool-call-code';
        pre.textContent = formattedToolCall;
        call.appendChild(label);
        call.appendChild(pre);
        body.appendChild(call);
    }

    if (hasOutput) {
        const output = document.createElement('div');
        output.className = 'tool-output-body';
        const label = document.createElement('div');
        label.className = 'tool-block-label';
        label.textContent = t('toolOutputLabel');
        const pre = document.createElement('pre');
        pre.className = 'tool-output-text';
        pre.textContent = formattedBody;
        output.appendChild(label);
        output.appendChild(pre);
        body.appendChild(output);
    }

    const setExpanded = (nextExpanded) => {
        wrapper.classList.toggle('tool-disclosure-expanded', nextExpanded);
        toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        toggle.setAttribute(
            'aria-label',
            nextExpanded
                ? formatT('collapseTool', { name: displayName })
                : formatT('expandTool', { name: displayName })
        );
        body.hidden = !nextExpanded;
    };

    toggle.addEventListener('click', () => {
        setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(body);
    contentDiv.appendChild(wrapper);
    setExpanded(expanded);
}

// Helper: Render Markdown/Math/Text into an element
export function renderContent(contentDiv, text, role, options = {}) {
    // Release message listeners / iframe resources from any prior Live Artifact
    // previews before we overwrite innerHTML (streaming updates, rerenders, etc).
    cleanupLiveArtifacts(contentDiv);

    if (role === 'tool-output' || role === 'tool-status') {
        createToolDisclosure(contentDiv, text, {
            ...options,
            kind: role,
        });
        return;
    }

    if (role === 'ai') {
        let html;
        try {
            html = transformMarkdown(text);
        } catch (error) {
            // transformMarkdown already falls back internally; this guards
            // test doubles and future renderers that throw instead.
            console.error('[Gemini Nexus] Markdown render failed, falling back to text', error);
            html = escapeHtml(typeof text === 'string' ? text : '');
        }
        contentDiv.innerHTML = html;

        // Streaming re-renders the full text per token: skip the expensive
        // post-passes when they cannot match anything. All four math
        // delimiters ($$, $, \(, \[) contain '$' or '\', so rendered text
        // without either cannot produce math (entities included, since we test
        // the decoded textContent rather than the raw input).
        if (
            typeof renderMathInElement !== 'undefined' &&
            /[$\\]/.test(contentDiv.textContent || '')
        ) {
            try {
                renderMathInElement(contentDiv, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false },
                        { left: '\\(', right: '\\)', display: false },
                        { left: '\\[', right: '\\]', display: true },
                    ],
                    throwOnError: false,
                });
            } catch (error) {
                // Math is progressive enhancement; never let it take down
                // the already-rendered message.
                console.error('[Gemini Nexus] Math rendering failed', error);
            }
        }

        // enhanceLiveArtifacts only visits .code-block-wrapper nodes; a plain
        // prose message pays for a full subtree scan otherwise, every token.
        const hasCodeBlocks =
            contentDiv.matches?.('.code-block-wrapper') === true ||
            contentDiv.querySelector?.('.code-block-wrapper') !== null;
        if (hasCodeBlocks) {
            try {
                enhanceLiveArtifacts(contentDiv, {
                    deferMermaidErrors: options.isStreaming === true && options.isFinal !== true,
                    deferGraphvizErrors: options.isStreaming === true && options.isFinal !== true,
                });
            } catch (error) {
                // Artifact previews are additive; a bad fence must not blank the message.
                console.error('[Gemini Nexus] Artifact enhancement failed', error);
            }
        }
    } else {
        // User message OR fallback if marked not loaded yet
        contentDiv.innerText = text;
    }
}
