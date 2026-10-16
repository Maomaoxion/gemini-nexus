import { FrameManager } from './core/frame.js';
import { StateManager } from './core/state.js';
import { MessageBridge } from './core/bridge.js';

const frameManager = new FrameManager();

frameManager.init();

if (globalThis.chrome && chrome.runtime && chrome.storage && chrome.tabs) {
    const stateManager = new StateManager(frameManager);
    const messageBridge = new MessageBridge(frameManager, stateManager);

    stateManager.init();
    messageBridge.init();

    window.addEventListener('pagehide', (pageHideEvent) => {
        // Switching browser tabs moves the panel into the back/forward cache and
        // fires pagehide with persisted === true. The panel is coming back, so it
        // must NOT be reported as closed: the background aborts the in-flight
        // reply on that report, which would cut off a streaming answer.
        if (pageHideEvent?.persisted === true) return;

        const tabId = stateManager.getMessageTargetTabId?.();
        if (!Number.isInteger(tabId) || tabId <= 0) return;
        chrome.runtime.sendMessage({ action: 'SIDE_PANEL_CLOSED', tabId }).catch(() => {});
    });
} else {
    const iframe = document.getElementById('sandbox-frame');
    if (iframe) iframe.addEventListener('load', () => frameManager.reveal(), { once: true });
}
