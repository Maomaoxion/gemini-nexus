// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { FooterTemplate } from './footer.js';

describe('FooterTemplate', () => {
    it('renders an AMC-style composer shell with textarea above the action row', () => {
        document.body.innerHTML = FooterTemplate;

        const inputWrapper = document.querySelector('.input-wrapper');
        const textareaShell = inputWrapper.querySelector('.composer-textarea-shell');
        const actions = inputWrapper.querySelector('.composer-actions');
        const leftActions = actions.querySelector('.composer-actions-left');
        const rightActions = actions.querySelector('.composer-actions-right');

        expect(inputWrapper.querySelector('#image-preview')).not.toBeNull();
        expect(inputWrapper.querySelector('#tab-reference-bar')).not.toBeNull();
        expect(inputWrapper.querySelector('#tab-mention-menu')).not.toBeNull();
        expect(textareaShell.querySelector('#prompt')).not.toBeNull();
        const uploadBtn = leftActions.querySelector('#upload-btn');
        expect(uploadBtn).not.toBeNull();
        expect(uploadBtn.getAttribute('tabindex')).toBe('0');
        expect(uploadBtn.getAttribute('role')).toBe('button');
        const newChatBtn = leftActions.querySelector('#new-chat-composer-btn');
        expect(newChatBtn).not.toBeNull();
        expect(newChatBtn.getAttribute('type')).toBe('button');
        expect(newChatBtn.getAttribute('data-i18n-title')).toBe('newChatTooltip');
        // AMC-style placement: new chat is the first icon in the composer action row.
        expect(
            newChatBtn.compareDocumentPosition(uploadBtn) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(leftActions.querySelector('.tools-container')).not.toBeNull();
        expect(leftActions.querySelector('#live-artifacts-btn')).not.toBeNull();
        expect(leftActions.querySelector('#youtube-summary-btn')).toBeNull();
        const sendBtn = rightActions.querySelector('#send');
        expect(sendBtn).not.toBeNull();
        // Empty-state uses aria/class (not disabled) so click can show feedback.
        expect(sendBtn.disabled).toBe(false);
        expect(sendBtn.classList.contains('is-empty')).toBe(true);
        expect(sendBtn.getAttribute('aria-disabled')).toBe('true');
        expect(sendBtn.getAttribute('type')).toBe('button');

        expect(inputWrapper.contains(document.querySelector('.tools-container'))).toBe(true);
        expect(document.querySelector('.input-row')).toBeNull();
        expect(
            textareaShell.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('keeps mode toggles primary and secondary actions under More / Capture', () => {
        document.body.innerHTML = FooterTemplate;

        const primary = document.querySelector('.tools-primary');
        expect(primary.querySelector('#page-context-btn')).toBeNull();
        expect(primary.querySelector('#browser-control-btn')).not.toBeNull();
        expect(primary.querySelector('#live-artifacts-btn')).not.toBeNull();

        // Mode toggles expose aria-pressed for unified on/off affordance.
        primary.querySelectorAll('.tool-toggle').forEach((btn) => {
            expect(btn.getAttribute('aria-pressed')).toBe('false');
        });

        // Secondary actions live in menus — not on the primary bar.
        expect(primary.querySelector('#quote-btn')).toBeNull();
        expect(primary.querySelector('#screen-capture-btn')).toBeNull();

        const moreMenu = document.getElementById('tools-more-menu');
        expect(moreMenu.querySelector('#quote-btn')).not.toBeNull();
        expect(moreMenu.querySelector('#screen-capture-btn')).not.toBeNull();
        expect(document.getElementById('quote-btn').classList.contains('context-aware')).toBe(true);

        // Capture tools stay in the capture dropdown.
        const captureMenu = document.getElementById('capture-menu');
        ['ocr-btn', 'screenshot-translate-btn', 'snip-btn'].forEach((buttonId) => {
            expect(captureMenu.querySelector(`#${buttonId}`)).not.toBeNull();
            expect(document.getElementById(buttonId).classList.contains('context-aware')).toBe(
                false
            );
        });
    });

    it('groups the three area-capture tools under a single dropdown', () => {
        document.body.innerHTML = FooterTemplate;

        const dropdown = document.querySelector('.capture-dropdown');
        expect(dropdown).not.toBeNull();
        expect(dropdown.querySelector('#capture-menu-btn')).not.toBeNull();
        const menu = dropdown.querySelector('#capture-menu');
        expect(menu).not.toBeNull();
        ['ocr-btn', 'screenshot-translate-btn', 'snip-btn'].forEach((buttonId) => {
            expect(menu.querySelector(`#${buttonId}`)).not.toBeNull();
        });
    });
});
