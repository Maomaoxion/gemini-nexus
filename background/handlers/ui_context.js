export function getTargetSidePanelTabId(request, sender) {
    const senderTabId = sender?.tab?.id;
    // A sender running inside a tab can only ever act for its own tab: a
    // sender-supplied sidePanelTabId pointing elsewhere is never legitimate
    // (no content flow sets the claim; the sidepanel attaches it with no
    // sender tab), so the authenticated sender tab wins over the claim.
    if (Number.isInteger(senderTabId) && senderTabId > 0) return senderTabId;

    const requestTabId = request?.sidePanelTabId;
    if (Number.isInteger(requestTabId) && requestTabId > 0) return requestTabId;

    return null;
}

function sendToRequestSource(sender, payload) {
    const result = sender.tab
        ? chrome.tabs.sendMessage(sender.tab.id, payload)
        : chrome.runtime.sendMessage(payload);

    return Promise.resolve(result).catch((error) => {
        console.warn('Could not send UI result to request source:', error);
        throw error;
    });
}

export function createUiMessageContext(handler) {
    return {
        imageHandler: handler.imageHandler,
        controlManager: handler.controlManager,
        sidePanelScopeManager: handler.sidePanelScopeManager,
        debugManager: handler.debugManager,
        getTargetSidePanelTabId,
        sendToRequestSource,
    };
}
