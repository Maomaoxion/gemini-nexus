import { hasDisplayableThoughts, hasDisplayableText } from '../core/displayable_content.js';

const TOOL_MESSAGE_KINDS = new Set(['tool-output', 'tool-status']);

export function isToolMessageKind(kind) {
    return TOOL_MESSAGE_KINDS.has(kind);
}

function isCompactSpacingPair(previousKind, currentKind) {
    if (!previousKind || !currentKind) return false;
    if (previousKind === 'tool' && currentKind === 'tool') return true;
    return (
        (previousKind === 'thinking' && currentKind === 'tool') ||
        (previousKind === 'tool' && currentKind === 'thinking')
    );
}

function isGroupedMessagePair(previousMessage, currentMessage, currentKind) {
    if (!previousMessage || !currentKind) return false;

    const currentRole = currentMessage.dataset?.messageRole || '';
    if (!currentRole) return false;

    // A tool card followed by the model's continuation belongs to the same
    // turn. Apply this before the thinking/normal branch: a continuation that
    // starts with thoughts only must not flash a second avatar while streaming.
    if (previousMessage.dataset?.messageSpacingKind === 'tool' && currentRole === 'model') {
        return true;
    }

    if (currentKind !== 'normal') return false;
    if (previousMessage.dataset?.messageSpacingKind !== 'normal') return false;

    const previousRole = previousMessage.dataset?.messageRole || '';
    return Boolean(previousRole && currentRole && previousRole === currentRole);
}

export function getMessageSpacingKind({ kind, role, thoughts, visibleText }) {
    if (isToolMessageKind(kind)) return 'tool';
    if (role === 'ai' && hasDisplayableThoughts(thoughts) && !hasDisplayableText(visibleText)) {
        return 'thinking';
    }
    return 'normal';
}

export function syncMessageSpacing(container, div, getSpacingKind, { skipNext = false } = {}) {
    if (!container.contains(div)) return;
    const spacingKind = getSpacingKind();
    div.dataset.messageSpacingKind = spacingKind;
    div.classList.toggle('msg-thinking-only', spacingKind === 'thinking');

    const previousKind = div.previousElementSibling?.dataset?.messageSpacingKind || '';
    div.classList.toggle('msg-compact-chain', isCompactSpacingPair(previousKind, spacingKind));
    div.classList.toggle(
        'msg-grouped',
        isGroupedMessagePair(div.previousElementSibling, div, spacingKind)
    );

    if (skipNext) return;
    const nextController = div.nextElementSibling?.__messageController;
    if (nextController && typeof nextController.syncCompactSpacing === 'function') {
        nextController.syncCompactSpacing({ skipNext: true });
    }
}
