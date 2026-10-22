// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { syncMessageSpacing } from './message_spacing.js';

function createMessage(role, spacingKind = null) {
    const element = document.createElement('div');
    element.className = `msg ${role === 'model' ? 'ai' : role}`;
    element.dataset.messageRole = role;
    if (spacingKind) element.dataset.messageSpacingKind = spacingKind;
    return element;
}

describe('syncMessageSpacing turn grouping', () => {
    it('groups the model continuation after a tool card', () => {
        const container = document.createElement('div');
        container.appendChild(createMessage('user', 'tool'));
        const continuation = createMessage('model');
        container.appendChild(continuation);

        syncMessageSpacing(container, continuation, () => 'normal');

        expect(continuation.classList.contains('msg-grouped')).toBe(true);
    });

    it('groups a thinking-only model continuation after a tool card', () => {
        const container = document.createElement('div');
        container.appendChild(createMessage('user', 'tool'));
        const continuation = createMessage('model');
        container.appendChild(continuation);

        syncMessageSpacing(container, continuation, () => 'thinking');

        expect(continuation.classList.contains('msg-grouped')).toBe(true);
        expect(continuation.classList.contains('msg-thinking-only')).toBe(true);
    });

    it('does not group a new user turn after a tool card', () => {
        const container = document.createElement('div');
        container.appendChild(createMessage('user', 'tool'));
        const nextUser = createMessage('user');
        container.appendChild(nextUser);

        syncMessageSpacing(container, nextUser, () => 'normal');

        expect(nextUser.classList.contains('msg-grouped')).toBe(false);
    });

    it('keeps grouping adjacent messages with the same role', () => {
        const container = document.createElement('div');
        container.appendChild(createMessage('model', 'normal'));
        const nextModel = createMessage('model');
        container.appendChild(nextModel);

        syncMessageSpacing(container, nextModel, () => 'normal');

        expect(nextModel.classList.contains('msg-grouped')).toBe(true);
    });
});
