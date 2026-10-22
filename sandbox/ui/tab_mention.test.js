// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabMentionController } from './tab_mention.js';

function setup({ onRequestTabs = vi.fn(), onChange = vi.fn() } = {}) {
    document.body.innerHTML = `
        <div class="input-wrapper">
            <div id="tab-reference-bar" hidden></div>
            <textarea id="prompt"></textarea>
            <div id="tab-mention-menu" hidden></div>
        </div>
    `;

    const inputFn = document.getElementById('prompt');
    const referenceBar = document.getElementById('tab-reference-bar');
    const menu = document.getElementById('tab-mention-menu');
    const controller = new TabMentionController({
        inputFn,
        referenceBar,
        menu,
        onRequestTabs,
        onChange,
    });

    return { controller, inputFn, referenceBar, menu, onRequestTabs, onChange };
}

function typeInto(input, value) {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function candidate(id, title, url = `https://tab${id}.test/`) {
    return { id, title, url, favIconUrl: '', active: id === 1, controllable: true };
}

describe('TabMentionController', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('opens the candidate menu when @ is typed at a word boundary', () => {
        const { inputFn, menu, onRequestTabs } = setup();

        typeInto(inputFn, 'summarize @');

        expect(onRequestTabs).toHaveBeenCalledTimes(1);
        expect(menu.hidden).toBe(false);
        expect(menu.querySelector('.tab-mention-empty').textContent).toBe('Loading tabs...');
    });

    it('does not treat an email address as a mention trigger', () => {
        const { inputFn, menu, onRequestTabs } = setup();

        typeInto(inputFn, 'mail me at foo@bar');

        expect(onRequestTabs).not.toHaveBeenCalled();
        expect(menu.hidden).toBe(true);
    });

    it('renders candidates with a marker for the current tab', () => {
        const { controller, inputFn, menu } = setup();

        typeInto(inputFn, '@');
        controller.setCandidates([candidate(1, 'GitHub'), candidate(2, 'Docs')], 1);

        const items = menu.querySelectorAll('.tab-mention-item');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('GitHub');
        expect(items[0].querySelector('.tab-mention-current').textContent).toBe(' · Current tab');
        expect(items[1].querySelector('.tab-mention-current')).toBeNull();
    });

    it('filters candidates by title and url', () => {
        const { controller, inputFn, menu } = setup();

        typeInto(inputFn, '@');
        controller.setCandidates(
            [candidate(1, 'GitHub'), candidate(2, 'Docs', 'https://docs.test/guide')],
            null
        );

        typeInto(inputFn, '@guide');

        const items = menu.querySelectorAll('.tab-mention-item');
        expect(items).toHaveLength(1);
        expect(items[0].textContent).toContain('Docs');
    });

    it('selects a candidate with Enter and removes the typed @query', () => {
        const { controller, inputFn, referenceBar, menu, onChange } = setup();

        typeInto(inputFn, 'read @git');
        controller.setCandidates([candidate(1, 'GitHub')], null);
        inputFn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(inputFn.value).toBe('read ');
        expect(menu.hidden).toBe(true);
        expect(controller.getReferences()).toEqual([
            { id: 1, title: 'GitHub', url: 'https://tab1.test/', favIconUrl: '' },
        ]);
        expect(referenceBar.hidden).toBe(false);
        expect(referenceBar.textContent).toContain('Sharing "GitHub" tab');
        expect(onChange).toHaveBeenCalled();
    });

    it('adds a clicked candidate and ignores duplicate references', () => {
        const { controller, inputFn, menu } = setup();

        typeInto(inputFn, '@');
        controller.setCandidates([candidate(1, 'GitHub')], null);
        menu.querySelector('.tab-mention-item').click();

        typeInto(inputFn, '@');
        controller.setCandidates([candidate(1, 'GitHub')], null);
        menu.querySelector('.tab-mention-item').click();

        expect(controller.getReferences()).toHaveLength(1);
    });

    it('moves the active candidate with arrow keys', () => {
        const { controller, inputFn, menu } = setup();

        typeInto(inputFn, '@');
        controller.setCandidates([candidate(1, 'GitHub'), candidate(2, 'Docs')], null);

        inputFn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(menu.querySelectorAll('.tab-mention-item')[1].classList.contains('is-active')).toBe(
            true
        );

        inputFn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(controller.getReferences().map((tab) => tab.id)).toEqual([2]);
    });

    it('closes the menu with Escape without clearing references', () => {
        const { controller, inputFn, menu } = setup();
        controller.setReferences([candidate(1, 'GitHub')], { silent: true });

        typeInto(inputFn, '@');
        inputFn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(menu.hidden).toBe(true);
        expect(controller.getReferences()).toHaveLength(1);
    });

    it('consumes Enter for the picker when no candidate matches', () => {
        const { controller, inputFn, menu } = setup();
        const sendLikeHandler = vi.fn();
        inputFn.addEventListener('keydown', sendLikeHandler);

        typeInto(inputFn, 'hello @missing');
        controller.setCandidates([candidate(1, 'GitHub')], null);

        inputFn.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );

        expect(sendLikeHandler).not.toHaveBeenCalled();
        expect(menu.hidden).toBe(true);
        expect(controller.getReferences()).toEqual([]);
    });

    it('does not open the menu while an IME composition is active', () => {
        const { inputFn, menu, onRequestTabs } = setup();

        inputFn.dispatchEvent(new Event('compositionstart'));
        typeInto(inputFn, '@');

        expect(onRequestTabs).not.toHaveBeenCalled();
        expect(menu.hidden).toBe(true);
    });

    it('renders the collapsed multi-reference header and expands it on demand', () => {
        const { controller, referenceBar } = setup();

        controller.setReferences([candidate(1, 'GitHub'), candidate(2, 'Docs')], { silent: true });

        const header = referenceBar.querySelector('.tab-reference-multi');
        expect(header).not.toBeNull();
        expect(referenceBar.textContent).toContain('Sharing 2 tabs');

        const list = referenceBar.querySelector('.tab-reference-list');
        expect(list.hidden).toBe(true);

        referenceBar.querySelector('.tab-reference-toggle').click();

        expect(referenceBar.querySelector('.tab-reference-list').hidden).toBe(false);
        expect(
            referenceBar.querySelector('.tab-reference-toggle').getAttribute('aria-expanded')
        ).toBe('true');
        expect(referenceBar.querySelectorAll('.tab-reference-row')).toHaveLength(2);
    });

    it('removes references from the expanded list', () => {
        const { controller, referenceBar } = setup();
        controller.setReferences([candidate(1, 'GitHub'), candidate(2, 'Docs')], { silent: true });
        referenceBar.querySelector('.tab-reference-toggle').click();

        referenceBar.querySelector('[data-remove-tab-id="1"]').click();

        expect(controller.getReferences().map((tab) => tab.id)).toEqual([2]);
        expect(referenceBar.textContent).toContain('Sharing "Docs" tab');
    });

    it('normalizes restored references and can skip the change notification', () => {
        const { controller, onChange } = setup();

        controller.setReferences([{ id: 1 }, { id: 1 }, { id: 0 }, null], { silent: true });

        expect(controller.getReferences()).toEqual([{ id: 1, title: '', url: '', favIconUrl: '' }]);
        expect(onChange).not.toHaveBeenCalled();
    });
});
