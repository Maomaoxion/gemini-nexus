import { formatT, t } from '../../../core/i18n.js';
import { parseConfiguredModels } from '../../../../shared/settings/model_selection.js';

function getModelListUI(section, provider) {
    if (provider === 'official') {
        return {
            input: section.elements.officialModel,
            button: section.elements.officialRefreshModels,
            status: section.elements.officialModelListStatus,
            picker: section.elements.officialModelPicker,
        };
    }
    if (provider === 'openai') {
        return {
            input: section.elements.openaiModel,
            button: section.elements.openaiRefreshModels,
            status: section.elements.openaiModelListStatus,
            picker: section.elements.openaiModelPicker,
        };
    }
    return {
        input: section.elements.dedicatedApiModel,
        button: section.elements.dedicatedApiRefreshModels,
        status: section.elements.dedicatedApiModelListStatus,
        picker: section.elements.dedicatedApiModelPicker,
    };
}

export function setProviderModelListStatus(
    section,
    text,
    isError = false,
    provider = section.activeProvider
) {
    const { button, status } = getModelListUI(section, provider);
    if (button) button.disabled = false;
    if (!status) return;
    status.textContent = text || '';
    status.hidden = !text;
    status.classList.toggle('is-error', isError);
}

function mergeModelIds(existingRaw, addedModels) {
    const models = parseConfiguredModels(existingRaw);
    for (const modelId of addedModels) {
        if (!models.includes(modelId)) models.push(modelId);
    }
    return models.join(', ');
}

function createPickerButton(label, classNames = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = classNames;
    button.textContent = label;
    return button;
}

function renderModelPicker({ section, provider, picker, input, models }) {
    picker.replaceChildren();
    picker.hidden = false;

    const toolbar = document.createElement('div');
    toolbar.className = 'settings-model-picker-toolbar';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'settings-input settings-model-picker-search';
    search.placeholder = t('modelSearchPlaceholder');
    search.setAttribute('aria-label', t('modelSearchPlaceholder'));

    const selectAll = createPickerButton(
        t('modelListSelectAll'),
        'btn-secondary settings-small-button settings-model-picker-select-all'
    );
    const addSelected = createPickerButton(
        t('modelListAddSelected'),
        'btn-secondary settings-small-button settings-model-picker-add'
    );
    const close = createPickerButton('×', 'settings-model-picker-close');
    close.setAttribute('aria-label', t('close'));

    toolbar.append(search, selectAll, addSelected, close);

    const list = document.createElement('div');
    list.className = 'settings-model-picker-list';

    const rows = models.map((modelId) => {
        const row = document.createElement('label');
        row.className = 'settings-model-picker-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = modelId;
        const text = document.createElement('span');
        text.textContent = modelId;
        row.append(checkbox, text);
        list.appendChild(row);
        return row;
    });

    const applyFilter = (term) => {
        const normalized = term.trim().toLowerCase();
        rows.forEach((row) => {
            const checkbox = row.querySelector('input');
            row.hidden = normalized && !checkbox.value.toLowerCase().includes(normalized);
        });
    };

    search.addEventListener('input', () => applyFilter(search.value));

    selectAll.addEventListener('click', () => {
        const visible = rows.filter((row) => !row.hidden);
        const shouldCheck = visible.some((row) => !row.querySelector('input').checked);
        visible.forEach((row) => {
            row.querySelector('input').checked = shouldCheck;
        });
    });

    addSelected.addEventListener('click', () => {
        const checked = rows
            .map((row) => row.querySelector('input'))
            .filter((checkbox) => checkbox.checked)
            .map((checkbox) => checkbox.value);
        if (checked.length === 0) return;

        input.value = mergeModelIds(input.value, checked);
        picker.hidden = true;
        picker.replaceChildren();
        setProviderModelListStatus(
            section,
            formatT('modelListAdded', { count: checked.length }),
            false,
            provider
        );
    });

    close.addEventListener('click', () => {
        picker.hidden = true;
        picker.replaceChildren();
    });

    picker.append(toolbar, list);
}

export function setProviderModelList(section, provider, models) {
    const modelIds = [
        ...new Set(
            (Array.isArray(models) ? models : [])
                .map((model) => String(model || '').trim())
                .filter(Boolean)
        ),
    ];
    if (!provider || modelIds.length === 0) return;

    const { input, picker } = getModelListUI(section, provider);
    if (!input || !picker) return;

    const existing = new Set(parseConfiguredModels(input.value));
    const newModels = modelIds.filter((modelId) => !existing.has(modelId));
    if (newModels.length === 0) {
        setProviderModelListStatus(section, t('modelListAllAdded'), false, provider);
        return;
    }

    renderModelPicker({ section, provider, picker, input, models: newModels });
    setProviderModelListStatus(
        section,
        formatT('modelListSelectToAdd', { count: newModels.length }),
        false,
        provider
    );
}
