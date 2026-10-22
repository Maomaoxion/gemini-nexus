import { ChatController } from './chat.js';
import { SidebarController } from './sidebar.js';
import { SettingsController } from './settings/index.js';
import { ViewerController } from './viewer.js';
import { TabSelectorController } from './tab_selector.js';
import { TabMentionController } from './tab_mention.js';
import { createModelOptions, getPreferredModel } from './model_options.js';
import { resizeSelectToSelectedOption } from './model_select_width.js';
import { initModelPicker, syncModelPicker } from './model_picker.js';
import {
    getProviderThinkingLevel,
    getProviderThinkingLevels,
    normalizeThinkingLevelForProvider,
    setProviderThinkingLevel,
} from '../../shared/models/thinking_levels.js';
import { DEFAULT_PROVIDER } from '../../shared/config/constants.js';
import { t } from '../core/i18n.js';

export class UIController {
    constructor(elements) {
        this.layoutResizeFrame = null;
        this.checkLayout();

        this.chat = new ChatController(elements);

        this.tabMention = new TabMentionController({
            inputFn: this.chat.inputFn,
            referenceBar: document.getElementById('tab-reference-bar'),
            menu: document.getElementById('tab-mention-menu'),
        });

        this.sidebar = new SidebarController(elements, {
            onOverlayClick: () => this.settings.close(),
        });

        this.settings = new SettingsController({
            onOpen: () => this.sidebar.close(),
            onSettingsChanged: (connectionSettings, meta = {}) => {
                this.updateModelList(connectionSettings);
                if (meta.providerChanged) {
                    document.dispatchEvent(new CustomEvent('gemini-provider-changed'));
                }
            },
        });

        this.viewer = new ViewerController();

        this.tabSelector = new TabSelectorController();

        this.inputFn = this.chat.inputFn;
        this.historyDiv = this.chat.historyDiv;
        this.sendBtn = this.chat.sendBtn;
        this.modelSelect = elements.modelSelect;
        this.modelPicker = initModelPicker(this.modelSelect);
        this.modelPicker?.setHandlers({
            onSelectThinking: (level) => this.setThinkingLevel(level),
        });
        this.tabSwitcherBtn = document.getElementById('tab-switcher-btn');
        window.addEventListener('resize', () => this.scheduleLayoutCheck());
        document.addEventListener('gemini-language-changed', () =>
            this.updateThinkingControls(this.settings.connectionData)
        );
        this.updateThinkingControls(this.settings.connectionData);
    }

    setSessionStorageHooks(hooks = {}) {
        this.settings.setSessionStorageHooks(hooks);
    }

    setContextWindowHooks(hooks = {}) {
        this.settings.setContextWindowHooks(hooks);
    }

    handleBackgroundRequestFailure(action, error) {
        return this.settings.handleBackgroundRequestFailure(action, error);
    }

    checkLayout() {
        // Threshold for Wide Mode (e.g. Full Page Tab or large side panel)
        const isWide = window.innerWidth > 800;
        const wasWide = document.body.classList.contains('layout-wide');
        if (isWide) {
            document.body.classList.add('layout-wide');
        } else {
            document.body.classList.remove('layout-wide');
        }

        if (this.sidebar && wasWide !== isWide) {
            this.sidebar.handleLayoutModeChange(isWide);
        }
    }

    setHostContext(context = {}) {
        document.body.classList.toggle('host-tab', context.isTab === true);
    }

    setPageContextAvailable(isAvailable) {
        document.body.classList.toggle('has-page-context', isAvailable === true);
    }

    setDebugToolsActive(isActive) {
        const button = document.getElementById('debug-tools-btn');
        if (!button) return;
        button.classList.toggle('active', isActive === true);
        button.setAttribute('aria-pressed', isActive === true ? 'true' : 'false');
    }

    setDebugToolsAvailable(isAvailable) {
        const button = document.getElementById('debug-tools-btn');
        if (!button) return;
        const available = isAvailable === true;
        button.disabled = !available;
        button.dataset.i18nTitle = available ? 'debugToolsTooltip' : 'debugToolsUnavailable';
        button.title = available ? t('debugToolsTooltip') : t('debugToolsUnavailable');
    }

    setTabMentionCallbacks(callbacks) {
        if (this.tabMention) this.tabMention.setCallbacks(callbacks);
    }

    setReferencedTabs(tabs, options) {
        if (this.tabMention) this.tabMention.setReferences(tabs, options);
    }

    getReferencedTabs() {
        return this.tabMention ? this.tabMention.getReferences() : [];
    }

    scheduleLayoutCheck() {
        if (this.layoutResizeFrame !== null) return;

        this.layoutResizeFrame = window.requestAnimationFrame(() => {
            this.layoutResizeFrame = null;
            this.checkLayout();
        });
    }

    updateModelList(settings) {
        if (!this.modelSelect) return;

        const preferred = getPreferredModel(settings, this.modelSelect.value);
        this.modelSelect.innerHTML = '';
        const options = createModelOptions(settings);

        options.forEach((option) => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            this.modelSelect.appendChild(optionElement);
        });

        // Restore selection if valid, else default
        const match = options.find((option) => option.value === preferred);
        if (match) {
            this.modelSelect.value = preferred;
        } else {
            if (options.length > 0) {
                this.modelSelect.value = options[0].value;
            }
            this.modelSelect.dispatchEvent(new Event('change'));
        }

        this.resizeModelSelect();
        this.updateThinkingControls(settings);
    }

    resizeModelSelect() {
        resizeSelectToSelectedOption(this.modelSelect);
        syncModelPicker(this.modelSelect);
    }

    getConnectionProvider(settings = this.settings?.connectionData || {}) {
        return (
            settings.provider || (settings.useOfficialApi === true ? 'official' : DEFAULT_PROVIDER)
        );
    }

    getProviderThinkingState(settings = this.settings?.connectionData || {}) {
        const provider = this.getConnectionProvider(settings);
        const model = this.modelSelect?.value || '';
        const levels = getProviderThinkingLevels(provider, model);
        const rawLevel = getProviderThinkingLevel(settings, provider);
        const value = normalizeThinkingLevelForProvider(provider, model, rawLevel) || rawLevel;
        return { provider, model, levels, value };
    }

    updateThinkingControls(settings = this.settings?.connectionData || {}) {
        const { levels, value } = this.getProviderThinkingState(settings);
        this.modelPicker?.setThinking({
            options: levels.map((level) => ({ value: level, label: level })),
            value,
            visible: levels.length > 0,
        });
    }

    syncThinkingForModel(model = this.modelSelect?.value || '', { saveIfChanged = false } = {}) {
        const settings = this.settings?.connectionData;
        if (!settings) return null;

        const provider = this.getConnectionProvider(settings);
        const levels = getProviderThinkingLevels(provider, model);
        if (levels.length === 0) {
            this.updateThinkingControls(settings);
            return null;
        }

        const previousLevel = getProviderThinkingLevel(settings, provider);
        const nextLevel = normalizeThinkingLevelForProvider(provider, model, previousLevel);
        if (!nextLevel) return null;

        setProviderThinkingLevel(settings, provider, nextLevel);
        this.updateThinkingControls(settings);

        if (saveIfChanged && previousLevel !== nextLevel) {
            this.saveThinkingLevel(provider, nextLevel);
        }

        return nextLevel;
    }

    saveThinkingLevel(provider, level) {
        window.parent.postMessage(
            {
                action: 'SAVE_THINKING_LEVEL',
                payload: { provider, level },
            },
            '*'
        );
    }

    setThinkingLevel(level) {
        const settings = this.settings?.connectionData;
        if (!settings) return null;

        const { provider, model } = this.getProviderThinkingState(settings);
        const nextLevel = normalizeThinkingLevelForProvider(provider, model, level);
        if (!nextLevel) return null;

        setProviderThinkingLevel(settings, provider, nextLevel);
        this.saveThinkingLevel(provider, nextLevel);
        this.updateThinkingControls(settings);
        return nextLevel;
    }

    cycleThinkingLevel() {
        const settings = this.settings?.connectionData;
        if (!settings) return null;

        const { levels, value } = this.getProviderThinkingState(settings);
        if (levels.length === 0) return null;

        const index = Math.max(0, levels.indexOf(value));
        return this.setThinkingLevel(levels[(index + 1) % levels.length]);
    }

    updateStatus(text) {
        this.chat.updateStatus(text);
    }
    beginTurn(options) {
        return this.chat.beginTurn(options);
    }
    getTurnView() {
        return this.chat.getTurnView();
    }
    setTurnView(view) {
        this.chat.setTurnView(view);
    }
    getTurnContainer() {
        return this.chat.getTurnContainer();
    }
    clearChatHistory() {
        this.chat.clear();
    }
    getChatScrollState() {
        return this.chat.getScrollState();
    }
    restoreChatScrollState(state) {
        this.chat.restoreScrollState(state);
    }
    scrollToBottom(options) {
        this.chat.scrollToBottom(options);
    }
    followBottom(options) {
        this.chat.followBottom(options);
    }
    followStreamingContent() {
        this.chat.followStreamingContent();
    }
    resetInput() {
        this.chat.resetInput();
    }
    setLoading(isLoading) {
        this.chat.setLoading(isLoading);
    }

    renderHistoryList(sessions, groups, currentId, callbacks, renderState) {
        this.sidebar.renderList(sessions, groups, currentId, callbacks, renderState);
    }

    updateShortcuts(payload) {
        this.settings.updateShortcuts(payload);
    }
    updateTheme(theme) {
        this.settings.updateTheme(theme);
    }
    updateLanguage(lang) {
        this.settings.updateLanguage(lang);
    }

    openTabSelector(tabs, onSelect, lockedTabId) {
        this.tabSelector.open(tabs, onSelect, lockedTabId);
    }

    setBrowserControlVisible(show) {
        if (this.tabSelector) {
            this.tabSelector.setControlVisible(show);
        }
        if (this.tabSwitcherBtn) {
            this.tabSwitcherBtn.hidden = true;
        }
    }

    updateBrowserControlState(state) {
        if (this.tabSelector) this.tabSelector.updateControlState(state);
    }

    setBrowserControlCallbacks(callbacks) {
        if (this.tabSelector) this.tabSelector.setControlCallbacks(callbacks);
    }
}
