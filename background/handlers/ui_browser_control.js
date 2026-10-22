import { handleToggleDebugTools } from './ui_debug_tools.js';

/**
 * Dispatches the composer tool toggles. Browser control and debug tools share
 * the tab's single debugger session, so their handlers coordinate exclusion.
 * @returns {boolean} true when the action was handled
 */
export function handleToolToggleAction(context, request, sender, sendResponse) {
    if (request.action === 'TOGGLE_BROWSER_CONTROL') {
        handleToggleBrowserControl(context, request, sender, sendResponse);
        return true;
    }

    if (request.action === 'TOGGLE_DEBUG_TOOLS') {
        handleToggleDebugTools(context, request, sender, sendResponse);
        return true;
    }

    return false;
}

export function handleToggleBrowserControl(context, request, sender, sendResponse) {
    if (request.enabled && context.debugManager?.isActive?.()) {
        // Debug tools hold the tab's single debugger session; release it first.
        context.debugManager
            .stop()
            .catch(() => {})
            .finally(() => runToggleBrowserControl(context, request, sender, sendResponse));
        return;
    }

    runToggleBrowserControl(context, request, sender, sendResponse);
}

function runToggleBrowserControl(context, request, sender, sendResponse) {
    const createDisabledErrorResponse = () => ({
        status: 'error',
        error: context.controlManager?.lastControlError || 'Browser control could not be enabled.',
    });

    try {
        let controlResult;
        let initialCreateForRetry = false;
        if (context.controlManager) {
            const targetSidePanelTabId = context.getTargetSidePanelTabId(request, sender);
            context.controlManager.setOwnerSidePanelTabId?.(targetSidePanelTabId);
            if (request.enabled) {
                const createDefaultTab = request.hostIsTab === true && !targetSidePanelTabId;
                initialCreateForRetry = createDefaultTab === true;
                controlResult = context.controlManager.enableControl({
                    createDefaultTab,
                });
            } else {
                controlResult = context.controlManager.disableControl();
            }
        }

        if (controlResult && typeof controlResult.then === 'function') {
            controlResult
                .then(async (result) => {
                    if (request.enabled && result === false && !initialCreateForRetry) {
                        try {
                            const retryResult = await context.controlManager.enableControl({
                                createDefaultTab: true,
                            });
                            if (retryResult) {
                                sendResponse({ status: 'processed' });
                                return;
                            }
                        } catch (retryError) {
                            console.warn(
                                '[ui_browser_control] retry with new tab failed',
                                retryError
                            );
                        }
                    }
                    if (request.enabled && result === false) {
                        sendResponse(createDisabledErrorResponse());
                        return;
                    }
                    sendResponse({ status: 'processed' });
                })
                .catch((error) => {
                    console.error('Browser control toggle failed', error);
                    sendResponse({ status: 'error', error: error?.message || String(error) });
                });
        } else if (request.enabled && controlResult === false) {
            sendResponse(createDisabledErrorResponse());
        } else {
            sendResponse({ status: 'processed' });
        }
    } catch (error) {
        console.error('Browser control toggle failed', error);
        sendResponse({ status: 'error', error: error?.message || String(error) });
    }
}
