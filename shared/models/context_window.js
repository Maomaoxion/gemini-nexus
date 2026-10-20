export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
export const CONTEXT_WINDOW_MIN_TOKENS = 4000;
export const CONTEXT_WINDOW_MAX_TOKENS = 10000000;
export const AUTOCOMPACT_INPUT_RATIO = 0.9;

const SYSTEM_TOKEN_RESERVE = 8000;
const MIN_OUTPUT_RESERVE = 8000;
const MAX_OUTPUT_RESERVE = 32000;
const IMAGE_ATTACHMENT_TOKENS = 1200;
const FILE_ATTACHMENT_TOKENS = 600;
const MESSAGE_OVERHEAD_TOKENS = 4;

// Conservative windows used when the provider API does not expose one.
const BUILTIN_CONTEXT_WINDOWS = Object.freeze([
    { pattern: /(?:^|[/:_-])gemini[-_ ]?(?:3|4)(?:[.\-_:]|$)/i, tokens: 1048576 },
    { pattern: /claude/i, tokens: 200000 },
    { pattern: /(?:^|[/:_-])gpt[-_ ]?(?:5|6)(?:[.\-_:]|$)/i, tokens: 400000 },
    { pattern: /(?:^|[/:_-])o[1-9](?:[.\-_:]|$)/i, tokens: 200000 },
    { pattern: /deepseek/i, tokens: 1048576 },
    { pattern: /(?:qwen|dashscope)/i, tokens: 131072 },
    { pattern: /glm/i, tokens: 200000 },
]);

export function normalizeContextWindowTokens(value, fallback = DEFAULT_CONTEXT_WINDOW_TOKENS) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(CONTEXT_WINDOW_MAX_TOKENS, Math.max(CONTEXT_WINDOW_MIN_TOKENS, parsed));
}

export function getBuiltinContextWindow(model, fallback = DEFAULT_CONTEXT_WINDOW_TOKENS) {
    const modelId = String(model || '').trim();
    for (const rule of BUILTIN_CONTEXT_WINDOWS) {
        if (rule.pattern.test(modelId)) return rule.tokens;
    }
    return fallback;
}

// Rough token estimate: CJK characters count as one token each, other text as
// one token per four characters.
export function estimateTextTokens(text) {
    const value = String(text || '');
    if (!value) return 0;

    const cjkMatches = value.match(/[⺀-鿿豈-﫿＀-￯　-〿぀-ヿ가-힯]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const otherCount = Math.max(0, value.length - cjkCount);
    return Math.ceil(cjkCount + otherCount / 4);
}

function estimateAttachmentTokens(message) {
    let tokens = 0;
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    for (const attachment of attachments) {
        const type = String(attachment?.type || '');
        tokens += type.startsWith('image/') ? IMAGE_ATTACHMENT_TOKENS : FILE_ATTACHMENT_TOKENS;
    }

    const legacyImages = Array.isArray(message?.image)
        ? message.image
        : typeof message?.image === 'string'
          ? [message.image]
          : [];
    tokens += legacyImages.length * IMAGE_ATTACHMENT_TOKENS;
    return tokens;
}

function extractOfficialContentText(message) {
    const parts = message?.officialContent?.parts;
    if (!Array.isArray(parts)) return '';

    return parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('');
}

export function estimateMessageTokens(message) {
    if (!message) return 0;

    return (
        estimateTextTokens(message.text) +
        estimateTextTokens(extractOfficialContentText(message)) +
        estimateAttachmentTokens(message) +
        MESSAGE_OVERHEAD_TOKENS
    );
}

export function estimateHistoryTokens(messages) {
    if (!Array.isArray(messages)) return 0;
    return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function getAutoCompactBudget(contextWindowTokens) {
    const contextWindow = normalizeContextWindowTokens(contextWindowTokens);
    const outputReserve = Math.min(
        MAX_OUTPUT_RESERVE,
        Math.max(MIN_OUTPUT_RESERVE, Math.round(contextWindow * 0.15))
    );
    const usableTokens = Math.max(
        CONTEXT_WINDOW_MIN_TOKENS,
        contextWindow - outputReserve - SYSTEM_TOKEN_RESERVE
    );

    return {
        contextWindow,
        outputReserve,
        usableTokens,
        triggerTokens: Math.floor(usableTokens * AUTOCOMPACT_INPUT_RATIO),
    };
}
