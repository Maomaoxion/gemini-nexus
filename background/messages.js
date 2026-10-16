import { SessionMessageHandler } from './handlers/session/index.js';
import { UIMessageHandler } from './handlers/ui.js';

/**
 * Sets up the global runtime message listener.
 * @param {GeminiSessionManager} sessionManager
 * @param {ImageManager} imageHandler
 * @param {BrowserControlManager} controlManager
 * @param {McpRemoteManager} mcpManager
 * @param {LogManager} logManager
 * @param {SidePanelScopeManager} sidePanelScopeManager
 */
export function setupMessageListener(
    sessionManager,
    imageHandler,
    controlManager,
    mcpManager,
    logManager,
    sidePanelScopeManager
) {
    const sessionHandler = new SessionMessageHandler(
        sessionManager,
        imageHandler,
        controlManager,
        mcpManager
    );
    const uiHandler = new UIMessageHandler(
        imageHandler,
        controlManager,
        mcpManager,
        sidePanelScopeManager,
        sessionHandler
    );

    // Abort any in-flight quick-ask when its content-script tab is closed,
    // so the upstream provider fetch does not keep streaming into a dead tab.
    chrome.tabs.onRemoved.addListener((tabId) => {
        sessionHandler.cancelQuickAskForTab(tabId);
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // Malformed requests must not reach the handlers: property access on
        // null/non-object throws inside the listener, the runtime swallows
        // the exception, and the sender hangs forever awaiting a response.
        if (!request || typeof request !== 'object' || typeof request.action !== 'string') {
            return false;
        }

        if (request.action === 'GET_LOGS') {
            sendResponse({ logs: logManager.getLogs() });
            return true;
        }

        // Delegate to Session Handler (Prompt, Context, Quick Ask, Browser Control)
        if (sessionHandler.handle(request, sender, sendResponse)) {
            return true;
        }

        // Delegate to UI Handler (Image, Capture, Sidepanel)
        if (uiHandler.handle(request, sender, sendResponse)) {
            return true;
        }

        return false;
    });
}
