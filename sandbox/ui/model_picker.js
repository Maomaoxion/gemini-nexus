import { TemplateIcons } from './templates/icons.js';

const pickerControllers = new WeakMap();

export function abbreviateModelName(modelName) {
    return String(modelName || '')
        .replace(/^Gemini\s+/i, '')
        .replace(/\s+Preview\b/i, '')
        .replace(/\s+Latest\b/i, '')
        .trim();
}

function getPickerElements(select) {
    const wrapper = select?.closest?.('.model-select-wrapper');
    if (!wrapper) return null;

    const trigger = wrapper.querySelector('#model-picker-trigger');
    const current = wrapper.querySelector('.model-picker-current');
    const menu = wrapper.querySelector('#model-picker-menu');
    const listbox = wrapper.querySelector('#model-picker-listbox');

    if (!trigger || !current || !menu || !listbox) return null;

    return {
        wrapper,
        trigger,
        current,
        menu,
        listbox,
        effort: wrapper.querySelector('#model-picker-effort'),
        effortValue: wrapper.querySelector('#model-picker-effort-value'),
        effortSlider: wrapper.querySelector('#model-picker-effort-slider'),
        effortDots: wrapper.querySelector('#model-picker-effort-dots'),
        effortFill: wrapper.querySelector('.model-picker-effort-fill'),
    };
}

function getSelectedIndex(select) {
    if (!select) return -1;
    if (select.selectedIndex >= 0) return select.selectedIndex;
    if (select.options.length === 0) return -1;

    select.selectedIndex = 0;
    return 0;
}

function buildOptionRow(controller, option, index) {
    const { select, activeIndex } = controller;
    const isSelected = index === select.selectedIndex;
    const isActive = index === activeIndex;
    const row = document.createElement('button');
    row.type = 'button';
    row.id = `model-picker-option-${index}`;
    row.className = [
        'model-picker-option',
        isSelected ? 'is-selected' : '',
        isActive ? 'is-active' : '',
    ]
        .filter(Boolean)
        .join(' ');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    row.dataset.modelIndex = String(index);

    const copy = document.createElement('span');
    copy.className = 'model-picker-option-copy';

    const name = document.createElement('span');
    name.className = 'model-picker-option-name';
    name.textContent = option.text;
    name.title = option.text;

    const id = document.createElement('span');
    id.className = 'model-picker-option-id';
    id.textContent = option.value;
    id.title = option.value;

    copy.append(name, id);
    row.appendChild(copy);

    if (isSelected) {
        const check = document.createElement('span');
        check.className = 'model-picker-check';
        check.innerHTML = TemplateIcons.CHECK;
        row.appendChild(check);
    }

    row.addEventListener('click', () => controller.selectIndex(index));
    return row;
}

function createModelPickerController(select, elements) {
    const controller = {
        select,
        ...elements,
        isOpen: false,
        activeIndex: -1,
        thinkingOptions: [],
        thinkingValue: '',
        thinkingVisible: false,
        handlers: {},

        sync() {
            const selectedIndex = getSelectedIndex(select);
            const selectedOption = selectedIndex >= 0 ? select.options[selectedIndex] : null;
            const selectedLabel = selectedOption?.text || '';
            const levelLabel = this.getSelectedThinkingLabel();

            this.current.textContent =
                abbreviateModelName(selectedLabel) + (levelLabel ? ` · ${levelLabel}` : '');
            this.trigger.disabled = select.disabled || select.options.length === 0;

            if (this.activeIndex < 0 || this.activeIndex >= select.options.length) {
                this.activeIndex = selectedIndex;
            }

            this.renderOptions();
            this.renderEffort();
            this.updateAria();
        },

        getSelectedThinkingLabel() {
            if (!this.thinkingVisible) return '';
            const match = this.thinkingOptions.find(
                (option) => option.value === this.thinkingValue
            );
            return match?.label || '';
        },

        getThinkingIndex() {
            const index = this.thinkingOptions.findIndex(
                (option) => option.value === this.thinkingValue
            );
            return index >= 0 ? index : 0;
        },

        renderOptions() {
            const fragment = document.createDocumentFragment();
            [...select.options].forEach((option, index) => {
                fragment.appendChild(buildOptionRow(this, option, index));
            });
            this.listbox.replaceChildren(fragment);
        },

        renderEffort() {
            if (!this.effort || !this.effortSlider) return;

            const shouldShow = this.thinkingVisible && this.thinkingOptions.length > 0;
            this.effort.hidden = !shouldShow;
            if (!shouldShow) return;

            const index = this.getThinkingIndex();
            const option = this.thinkingOptions[index];
            const max = Math.max(0, this.thinkingOptions.length - 1);

            if (this.effortValue) this.effortValue.textContent = option?.label || '';
            this.effortSlider.min = '0';
            this.effortSlider.max = String(max);
            this.effortSlider.value = String(index);
            this.effortSlider.disabled = max === 0;
            this.renderEffortDots();
            this.updateEffortFill(index, max);
        },

        renderEffortDots() {
            if (!this.effortDots) return;

            const count = this.thinkingOptions.length;
            const currentDots = this.effortDots.children.length;
            if (currentDots !== count) {
                const fragment = document.createDocumentFragment();
                for (let index = 0; index < count; index++) {
                    fragment.appendChild(document.createElement('span'));
                }
                this.effortDots.replaceChildren(fragment);
            }

            const currentIndex = this.getThinkingIndex();
            const max = Math.max(1, count - 1);
            [...this.effortDots.children].forEach((dot, index) => {
                dot.style.setProperty('--effort-ratio', String(index / max));
                dot.classList.toggle('is-filled', index <= currentIndex);
            });
        },

        updateEffortFill(index = this.getThinkingIndex(), max = this.thinkingOptions.length - 1) {
            if (!this.effortFill) return;
            const ratio = max > 0 ? index / max : 1;
            this.effortFill.style.setProperty('--effort-ratio', String(ratio));
        },

        commitEffort(index) {
            const option = this.thinkingOptions[index];
            if (!option) return;
            this.thinkingValue = option.value;
            this.renderEffort();
            this.sync();
            this.handlers.onSelectThinking?.(option.value);
        },

        updateAria() {
            this.trigger.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
            if (this.isOpen && this.activeIndex >= 0) {
                this.trigger.setAttribute(
                    'aria-activedescendant',
                    `model-picker-option-${this.activeIndex}`
                );
            } else {
                this.trigger.removeAttribute('aria-activedescendant');
            }
            this.menu.hidden = !this.isOpen;
        },

        setOpen(isOpen) {
            this.isOpen = isOpen;
            if (isOpen) {
                this.activeIndex = getSelectedIndex(select);
            }
            this.sync();
        },

        toggle() {
            this.setOpen(!this.isOpen);
        },

        moveActive(step) {
            if (select.options.length === 0) {
                this.activeIndex = -1;
                return;
            }

            const startingIndex =
                this.activeIndex >= 0 ? this.activeIndex : getSelectedIndex(select);
            this.activeIndex =
                (startingIndex + step + select.options.length) % select.options.length;
            this.renderOptions();
            this.updateAria();
        },

        selectIndex(index) {
            if (index < 0 || index >= select.options.length) return;

            select.selectedIndex = index;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            this.setOpen(false);
        },

        setThinking({ options = [], value = '', visible = false } = {}) {
            this.thinkingOptions = Array.isArray(options) ? options : [];
            this.thinkingValue = value || '';
            this.thinkingVisible = visible === true;
            this.renderEffort();
            this.sync();
        },

        setHandlers(handlers = {}) {
            this.handlers = { ...this.handlers, ...handlers };
        },

        handleKeyDown(keyboardEvent) {
            if (keyboardEvent.defaultPrevented) return;
            if (keyboardEvent.target?.closest?.('.model-picker-effort')) return;

            if (keyboardEvent.key === 'ArrowDown') {
                keyboardEvent.preventDefault();
                if (!this.isOpen) {
                    this.setOpen(true);
                    return;
                }
                this.moveActive(1);
                return;
            }

            if (keyboardEvent.key === 'ArrowUp') {
                keyboardEvent.preventDefault();
                if (!this.isOpen) {
                    this.setOpen(true);
                    return;
                }
                this.moveActive(-1);
                return;
            }

            if (keyboardEvent.key === 'Home' && this.isOpen) {
                keyboardEvent.preventDefault();
                this.activeIndex = 0;
                this.renderOptions();
                this.updateAria();
                return;
            }

            if (keyboardEvent.key === 'End' && this.isOpen) {
                keyboardEvent.preventDefault();
                this.activeIndex = select.options.length - 1;
                this.renderOptions();
                this.updateAria();
                return;
            }

            if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                keyboardEvent.preventDefault();
                if (!this.isOpen) {
                    this.setOpen(true);
                    return;
                }
                this.selectIndex(this.activeIndex);
                return;
            }

            if (keyboardEvent.key === 'Escape' && this.isOpen) {
                keyboardEvent.preventDefault();
                keyboardEvent.stopPropagation();
                this.setOpen(false);
            }
        },
    };

    controller.trigger.addEventListener('click', () => controller.toggle());
    controller.wrapper.addEventListener('keydown', (keyboardEvent) => {
        controller.handleKeyDown(keyboardEvent);
    });
    select.addEventListener('change', () => controller.sync());
    controller.effortSlider?.addEventListener('input', () => {
        const index = Number(controller.effortSlider.value) || 0;
        const option = controller.thinkingOptions[index];
        if (!option) return;
        controller.thinkingValue = option.value;
        if (controller.effortValue) controller.effortValue.textContent = option.label;
        controller.renderEffortDots();
        controller.updateEffortFill(index, Math.max(0, controller.thinkingOptions.length - 1));
    });
    controller.effortSlider?.addEventListener('change', () => {
        controller.commitEffort(Number(controller.effortSlider.value) || 0);
    });
    document.addEventListener('click', (clickEvent) => {
        if (!controller.isOpen) return;
        if (controller.wrapper.contains(clickEvent.target)) return;
        controller.setOpen(false);
    });

    return controller;
}

export function initModelPicker(select) {
    if (!select) return null;

    const existingController = pickerControllers.get(select);
    if (existingController) {
        existingController.sync();
        return existingController;
    }

    const elements = getPickerElements(select);
    if (!elements) return null;

    const controller = createModelPickerController(select, elements);
    pickerControllers.set(select, controller);
    controller.sync();
    return controller;
}

export function syncModelPicker(select) {
    if (!select) return false;

    const controller = pickerControllers.get(select) || initModelPicker(select);
    if (!controller) return false;

    controller.sync();
    return true;
}
