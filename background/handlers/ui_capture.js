import { getRequestTab } from '../control/tabs.js';
import { respondWithUiTask, runUiTask } from './ui_async.js';

const DEFAULT_CAPTURE_ERROR = 'Capture failed';

function getCaptureError(result) {
    return result?.error || result?.message || DEFAULT_CAPTURE_ERROR;
}

function isSidePanelCapture(request) {
    return request?.source === 'sidepanel';
}

function notifyCaptureStartFailure(context, request, sender, tab, error) {
    const message = error || DEFAULT_CAPTURE_ERROR;

    if (isSidePanelCapture(request)) {
        chrome.runtime
            .sendMessage({
                action: 'SCREEN_CAPTURE_ERROR',
                error: message,
                tabId: context.getTargetSidePanelTabId(request, sender),
            })
            .catch(() => {});
        return;
    }

    if (tab?.id) {
        chrome.tabs
            .sendMessage(tab.id, {
                action: 'SHOW_EXTENSION_ERROR',
                message,
            })
            .catch(() => {});
    }
}

function notifyAreaCaptureFailure(sender, error) {
    if (!sender.tab) return;
    chrome.tabs
        .sendMessage(sender.tab.id, {
            action: 'CROP_SCREENSHOT_FAILED',
            error: getCaptureError(error),
        })
        .catch(() => {});
}

export function handleInitiateCapture(context, request, sender) {
    runUiTask(async () => {
        const tab = await getRequestTab(context, request, sender);
        if (!tab) return;

        // Hide floating toolbar before capturing so it doesn't appear in the screenshot.
        try {
            await chrome.tabs.sendMessage(tab.id, {
                action: 'HIDE_FOR_CAPTURE',
                source: request.source,
            });
        } catch {
            // Non-critical: content script may not be ready; START_SELECTION also hides.
        }

        let capture = null;
        try {
            capture = await context.imageHandler.captureScreenshot(tab.windowId);
        } catch (error) {
            notifyCaptureStartFailure(context, request, sender, tab, getCaptureError(error));
            return;
        }

        if (!capture?.base64 || capture.error) {
            notifyCaptureStartFailure(context, request, sender, tab, getCaptureError(capture));
            return;
        }

        try {
            await chrome.tabs.sendMessage(tab.id, {
                action: 'START_SELECTION',
                image: capture.base64,
                mode: request.mode,
                source: request.source,
                targetSidePanelTabId: context.getTargetSidePanelTabId(request, sender),
            });
        } catch (error) {
            notifyCaptureStartFailure(context, request, sender, tab, getCaptureError(error));
        }
    }, 'Capture initiation error');
}

export function handleAreaSelected(context, request, sender, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            const windowId = sender.tab ? sender.tab.windowId : null;
            const result = await context.imageHandler.captureArea(request.area, windowId);
            if (result && sender.tab) {
                await chrome.tabs.sendMessage(sender.tab.id, result);
                return;
            }

            notifyAreaCaptureFailure(sender, null);
        },
        {
            errorLabel: 'Area capture error',
            onError: (error) => notifyAreaCaptureFailure(sender, error),
        }
    );
}

export function handleProcessCropInSidePanel(context, request, sender, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            // Never rebroadcast the sender-supplied object: spreading
            // request.payload would let any message sender re-emit an
            // arbitrary action under the background's identity. The action is
            // fixed and only the crop fields are forwarded.
            const payload = request.payload || {};
            await chrome.runtime.sendMessage({
                action: 'CROP_SCREENSHOT',
                area: payload.area,
                image: payload.image,
                mode: payload.mode,
                imageType: payload.imageType,
                tabId: payload.tabId || context.getTargetSidePanelTabId(request, sender),
            });

            return { status: 'forwarded' };
        },
        {
            errorLabel: 'Crop forwarding error',
        }
    );
}
