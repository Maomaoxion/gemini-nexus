// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { ChatTemplate } from './chat.js';

describe('chat template', () => {
    it('renders a lightweight empty state outside the scrollable message list', () => {
        document.body.innerHTML = ChatTemplate;

        expect(document.getElementById('chat-history')).toBeTruthy();
        const empty = document.getElementById('chat-empty');
        expect(empty).toBeTruthy();
        expect(empty.previousElementSibling.id).toBe('chat-history');
        expect(empty.querySelector('[data-i18n="chatEmptyTitle"]')).toBeTruthy();
        expect(empty.querySelector('[data-i18n="chatEmptyHint"]')).toBeTruthy();
        expect(empty.querySelector('.chat-empty-logo')).toBeTruthy();
        expect(empty.querySelectorAll('.chat-empty-tips li')).toHaveLength(3);
        expect(empty.querySelector('[data-i18n="chatEmptyTip1"]')).toBeTruthy();
    });

    it('exposes empty-state actions to assistive tech', () => {
        document.body.innerHTML = ChatTemplate;

        // Visibility is CSS-driven (the :empty sibling selector); an
        // aria-hidden wrapper would hide the interactive tips from screen
        // readers even while they are on screen.
        expect(document.getElementById('chat-empty')?.hasAttribute('aria-hidden')).toBe(false);
    });

    it('gives every empty-state tip an icon slot and structured text', () => {
        document.body.innerHTML = ChatTemplate;

        const tips = [...document.querySelectorAll('.chat-empty-tip')];
        expect(tips).toHaveLength(3);
        for (const tip of tips) {
            expect(tip.querySelector('.chat-empty-tip-icon')).toBeTruthy();
            expect(tip.querySelector('.chat-empty-tip-text')).toBeTruthy();
        }
    });

    it('renders the logo tile at its styled size', () => {
        document.body.innerHTML = ChatTemplate;

        const img = document.querySelector('.chat-empty-logo');
        expect(img?.getAttribute('width')).toBe('48');
        expect(img?.getAttribute('height')).toBe('48');
    });
});
