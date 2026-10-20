import {
    createWebModelOptionMarkup,
    createWebModelOptions,
} from '../../../shared/models/web_models.js';
import { TemplateIcons } from './icons.js';

const defaultModelLabel = createWebModelOptions()[0]?.label || '';

export const HeaderTemplate = `
    <!-- HEADER -->
    <div class="header">
        <div class="header-left">
            <button id="history-toggle" class="icon-btn" data-i18n-title="toggleHistory" title="Chat History (Alt+H)" aria-label="Chat History (Alt+H)">
                ${TemplateIcons.SIDEBAR_TOGGLE}
            </button>

            <div class="model-select-wrapper">
                <select id="model-select" class="model-native-select" data-i18n-title="modelSelectTooltip" title="Select Model (Ctrl+M to cycle)" aria-hidden="true" tabindex="-1">
                    ${createWebModelOptionMarkup()}
                </select>
                <button id="model-picker-trigger" class="model-picker-trigger" type="button" data-i18n-title="modelSelectTooltip" title="Select Model (Ctrl+M to cycle)" aria-haspopup="listbox" aria-expanded="false" aria-controls="model-picker-listbox">
                    <span class="model-picker-trigger-icon" aria-hidden="true">${TemplateIcons.MODEL}</span>
                    <span class="model-picker-current">${defaultModelLabel}</span>
                </button>
                <div id="model-picker-menu" class="model-picker-menu" hidden>
                    <div id="model-picker-listbox" class="model-picker-listbox" role="listbox"></div>
                    <div id="model-picker-effort" class="model-picker-effort" hidden>
                        <div class="model-picker-effort-header">
                            <span class="model-picker-effort-icon" aria-hidden="true">${TemplateIcons.EFFORT}</span>
                            <span class="model-picker-effort-label">
                                <span id="model-picker-effort-label" data-i18n="effortLabel">Effort</span>
                                (<span id="model-picker-effort-value"></span>)
                            </span>
                        </div>
                        <div class="model-picker-effort-control">
                            <div class="model-picker-effort-track" aria-hidden="true"></div>
                            <div class="model-picker-effort-fill" aria-hidden="true"></div>
                            <div id="model-picker-effort-dots" class="model-picker-effort-dots" aria-hidden="true"></div>
                            <input id="model-picker-effort-slider" class="model-picker-effort-slider" type="range" min="0" max="0" step="1" value="0" aria-labelledby="model-picker-effort-label" />
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="header-right">
            <button id="tab-switcher-btn" class="icon-btn" hidden data-i18n-title="selectTabTooltip" title="Select a tab to control" aria-label="Select a tab to control">
                ${TemplateIcons.ACTIVE_TAB}
            </button>
            <button id="open-full-page-btn" class="icon-btn" data-i18n-title="openFullPageTooltip" title="Open in Full Page" aria-label="Open in Full Page">
                ${TemplateIcons.EXTERNAL_OPEN}
            </button>
        </div>
    </div>
`;
