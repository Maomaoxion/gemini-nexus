// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abbreviateModelName, initModelPicker, syncModelPicker } from './model_picker.js';

function installPickerDom() {
    document.body.innerHTML = `
        <div class="model-select-wrapper">
            <select id="model-select" class="model-native-select">
                <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                <option value="gemini-3-pro-latest">Gemini 3 Pro Latest</option>
            </select>
            <button id="model-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="model-picker-listbox">
                <span class="model-picker-current"></span>
            </button>
            <div id="model-picker-menu" hidden>
                <div id="model-picker-listbox" role="listbox"></div>
                <div id="model-picker-effort" class="model-picker-effort" hidden>
                    <div class="model-picker-effort-header">
                        <span class="model-picker-effort-icon"></span>
                        <span class="model-picker-effort-label">
                            <span id="model-picker-effort-label">Effort</span>
                            (<span id="model-picker-effort-value"></span>)
                        </span>
                    </div>
                    <div class="model-picker-effort-control">
                        <div class="model-picker-effort-track"></div>
                        <div class="model-picker-effort-fill"></div>
                        <div id="model-picker-effort-dots" class="model-picker-effort-dots"></div>
                        <input id="model-picker-effort-slider" class="model-picker-effort-slider" type="range" min="0" max="0" step="1" value="0" />
                    </div>
                </div>
            </div>
        </div>
    `;
}

describe('model picker', () => {
    beforeEach(() => {
        installPickerDom();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('abbreviates model names like AMC header selectors', () => {
        expect(abbreviateModelName('Gemini 3 Flash Preview')).toBe('3 Flash');
        expect(abbreviateModelName('Gemini 3 Pro Latest')).toBe('3 Pro');
    });

    it('syncs the trigger label and listbox rows from the native select', () => {
        const select = document.getElementById('model-select');

        initModelPicker(select);

        expect(document.querySelector('.model-picker-current').textContent).toBe('3 Flash');
        const rows = [...document.querySelectorAll('.model-picker-option')];
        expect(rows).toHaveLength(2);
        expect(rows[0].getAttribute('role')).toBe('option');
        expect(rows[0].getAttribute('aria-selected')).toBe('true');
        expect(rows[0].querySelector('.model-picker-option-name').textContent).toBe(
            'Gemini 3 Flash Preview'
        );
        expect(rows[0].querySelector('.model-picker-option-id').textContent).toBe(
            'gemini-3-flash-preview'
        );
    });

    it('selects a model through the custom listbox and dispatches native change', () => {
        const select = document.getElementById('model-select');
        const onChange = vi.fn();
        select.addEventListener('change', onChange);

        initModelPicker(select);
        document.getElementById('model-picker-trigger').click();
        document.querySelectorAll('.model-picker-option')[1].click();

        expect(select.value).toBe('gemini-3-pro-latest');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(document.getElementById('model-picker-menu').hidden).toBe(true);
        expect(document.querySelector('.model-picker-current').textContent).toBe('3 Pro');
    });

    it('supports keyboard navigation and Escape close', () => {
        const select = document.getElementById('model-select');
        initModelPicker(select);
        const wrapper = document.querySelector('.model-select-wrapper');

        wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.getElementById('model-picker-menu').hidden).toBe(false);
        expect(document.getElementById('model-picker-trigger').getAttribute('aria-expanded')).toBe(
            'true'
        );
        expect(document.querySelectorAll('.model-picker-option')[0].className).toContain(
            'is-active'
        );

        wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(select.value).toBe('gemini-3-pro-latest');

        document.getElementById('model-picker-trigger').click();
        wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById('model-picker-menu').hidden).toBe(true);
    });

    it('does not steal keyboard activation from the effort slider', () => {
        const select = document.getElementById('model-select');
        const controller = initModelPicker(select);
        controller.setThinking({
            options: [
                { value: 'low', label: 'low' },
                { value: 'high', label: 'high' },
            ],
            value: 'low',
            visible: true,
        });
        const slider = document.getElementById('model-picker-effort-slider');

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

        expect(document.getElementById('model-picker-menu').hidden).toBe(true);
        expect(document.getElementById('model-picker-trigger').getAttribute('aria-expanded')).toBe(
            'false'
        );
    });

    it('shows the selected effort in the trigger and slider', () => {
        const select = document.getElementById('model-select');
        const onSelect = vi.fn();
        const controller = initModelPicker(select);
        controller.setHandlers({ onSelectThinking: onSelect });
        const options = ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({
            value,
            label: value,
        }));
        controller.setThinking({ options, value: 'max', visible: true });

        const slider = document.getElementById('model-picker-effort-slider');
        const valueLabel = document.getElementById('model-picker-effort-value');

        expect(document.querySelector('.model-picker-current').textContent).toBe('3 Flash · max');
        expect(slider.max).toBe('4');
        expect(slider.value).toBe('4');
        expect(valueLabel.textContent).toBe('max');
        const dots = [...document.querySelectorAll('.model-picker-effort-dots span')];
        expect(dots).toHaveLength(5);
        expect(dots[0].style.getPropertyValue('--effort-ratio')).toBe('0');
        expect(dots[4].style.getPropertyValue('--effort-ratio')).toBe('1');
        expect(
            document
                .querySelector('.model-picker-effort-fill')
                .style.getPropertyValue('--effort-ratio')
        ).toBe('1');

        slider.value = '1';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        expect(valueLabel.textContent).toBe('medium');
        expect(
            document
                .querySelector('.model-picker-effort-fill')
                .style.getPropertyValue('--effort-ratio')
        ).toBe('0.25');

        slider.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onSelect).toHaveBeenCalledWith('medium');
        expect(document.querySelector('.model-picker-current').textContent).toBe(
            '3 Flash · medium'
        );
    });

    it('resyncs when the native select options are replaced', () => {
        const select = document.getElementById('model-select');
        initModelPicker(select);
        select.innerHTML = '<option value="gpt-5">GPT-5</option>';
        select.value = 'gpt-5';

        syncModelPicker(select);

        expect(document.querySelector('.model-picker-current').textContent).toBe('GPT-5');
        expect(document.querySelectorAll('.model-picker-option')).toHaveLength(1);
    });
});
