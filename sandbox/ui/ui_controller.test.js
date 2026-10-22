// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { UIController } from './ui_controller.js';

describe('UIController browser control visibility', () => {
    it('keeps the legacy switcher hidden with the hidden attribute', () => {
        const tabSwitcherBtn = document.createElement('button');
        const tabSelector = { setControlVisible: vi.fn() };
        const controller = Object.create(UIController.prototype);
        controller.tabSwitcherBtn = tabSwitcherBtn;
        controller.tabSelector = tabSelector;

        controller.setBrowserControlVisible(true);

        expect(tabSelector.setControlVisible).toHaveBeenCalledWith(true);
        expect(tabSwitcherBtn.hidden).toBe(true);
        expect(tabSwitcherBtn.style.display).toBe('');
    });
});

describe('UIController host context', () => {
    it('marks tab-hosted sidepanel pages so tab-only controls can be hidden', () => {
        const controller = Object.create(UIController.prototype);

        controller.setHostContext({ isTab: true });
        expect(document.body.classList.contains('host-tab')).toBe(true);

        controller.setHostContext({ isTab: false });
        expect(document.body.classList.contains('host-tab')).toBe(false);
    });

    it('marks whether the chat has a real webpage context', () => {
        const controller = Object.create(UIController.prototype);

        controller.setPageContextAvailable(true);
        expect(document.body.classList.contains('has-page-context')).toBe(true);

        controller.setPageContextAvailable(false);
        expect(document.body.classList.contains('has-page-context')).toBe(false);
    });

    it('marks the debug toggle state and availability', () => {
        const controller = Object.create(UIController.prototype);
        document.body.innerHTML = '<button id="debug-tools-btn" aria-pressed="false"></button>';
        const button = document.getElementById('debug-tools-btn');

        controller.setDebugToolsActive(true);
        expect(button.classList.contains('active')).toBe(true);
        expect(button.getAttribute('aria-pressed')).toBe('true');

        controller.setDebugToolsActive(false);
        expect(button.classList.contains('active')).toBe(false);
        expect(button.getAttribute('aria-pressed')).toBe('false');

        controller.setDebugToolsAvailable(false);
        expect(button.disabled).toBe(true);

        controller.setDebugToolsAvailable(true);
        expect(button.disabled).toBe(false);
    });
});

describe('UIController model and thinking controls', () => {
    it('cycles the active provider thinking level and persists it', () => {
        const controller = Object.create(UIController.prototype);
        controller.settings = {
            connectionData: { provider: 'openai', openaiThinkingLevel: 'low' },
        };
        controller.modelSelect = { value: 'gpt-6-astra' };
        controller.modelPicker = { setThinking: vi.fn() };
        const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});

        expect(controller.cycleThinkingLevel()).toBe('medium');

        expect(controller.settings.connectionData.openaiThinkingLevel).toBe('medium');
        expect(controller.modelPicker.setThinking).toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith(
            {
                action: 'SAVE_THINKING_LEVEL',
                payload: { provider: 'openai', level: 'medium' },
            },
            '*'
        );
        postMessage.mockRestore();
    });
});
