const FORWARDED_RESPONSE_ACTIONS = new Set([
    'FETCH_IMAGE',
    'FETCH_GENERATED_IMAGE',
    'GET_LOGS',
    'GET_ACTIVE_RUN_STATE',
    'CHECK_PAGE_CONTEXT',
    'MCP_TEST_CONNECTION',
    'MCP_LIST_TOOLS',
    'GET_PROVIDER_MODELS',
]);

const HOST_ROUTED_ACTIONS = new Set(['GET_OPEN_TABS', 'SWITCH_TAB']);

function getErrorMessage(error, fallback = 'Background request failed') {
    return error?.message || error || fallback;
}

function getMessageTargetTabId(state) {
    return typeof state.getMessageTargetTabId === 'function'
        ? state.getMessageTargetTabId()
        : state.getCurrentTabId();
}

function shouldRouteToHostTab(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (HOST_ROUTED_ACTIONS.has(payload.action)) return true;
    return payload.action === 'SEND_PROMPT' && payload.enableBrowserControl === true;
}

function shouldRequirePageContextRoute(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.action === 'TOGGLE_BROWSER_CONTROL') return true;
    return payload.action === 'SEND_PROMPT' && payload.enableBrowserControl === true;
}

function attachCurrentTabContext(state, payload) {
    if (!payload || typeof payload !== 'object' || payload.sidePanelTabId != null) {
        return payload;
    }

    const tabId =
        shouldRouteToHostTab(payload) && !shouldRequirePageContextRoute(payload)
            ? getMessageTargetTabId(state)
            : state.getCurrentTabId();
    if (!Number.isInteger(tabId) || tabId <= 0) {
        return payload;
    }

    return {
        ...payload,
        sidePanelTabId: tabId,
    };
}

function postBackgroundRequestError(bridge, payload, error) {
    bridge.postBackgroundMessage({
        action: 'BACKGROUND_REQUEST_ERROR',
        requestAction: payload?.action || null,
        error: getErrorMessage(error),
    });
}

function postBrowserControlToggleResult(bridge, payload, response = {}) {
    bridge.postBackgroundMessage({
        action: 'BROWSER_CONTROL_TOGGLE_RESULT',
        enabled: payload.enabled === true,
        status: response.status || 'processed',
        error: response.error || null,
    });
}

export function isMessageForCurrentTab(state, message) {
    if (!message || !Object.prototype.hasOwnProperty.call(message, 'tabId')) {
        return true;
    }

    const messageTargetTabId = getMessageTargetTabId(state);
    return message.tabId == null || message.tabId === messageTargetTabId;
}

export function forwardToBackground(bridge, payload) {
    const scopedPayload = attachCurrentTabContext(bridge.state, payload);
    if (scopedPayload?.action === 'SEND_PROMPT') {
        console.info('[Gemini Nexus] Forwarding SEND_PROMPT to background', {
            sessionId: scopedPayload.sessionId || null,
            model: scopedPayload.model || null,
            enableBrowserControl: scopedPayload.enableBrowserControl === true,
            sidePanelTabId: scopedPayload.sidePanelTabId ?? null,
            textLen: typeof scopedPayload.text === 'string' ? scopedPayload.text.length : 0,
        });
    }
    chrome.runtime
        .sendMessage(scopedPayload)
        .then((response) => {
            if (response && scopedPayload.action === 'TOGGLE_BROWSER_CONTROL') {
                postBrowserControlToggleResult(bridge, scopedPayload, response);
                return;
            }
            if (response?.status === 'error') {
                postBackgroundRequestError(bridge, scopedPayload, response.error);
                return;
            }
            if (response && FORWARDED_RESPONSE_ACTIONS.has(scopedPayload.action)) {
                bridge.postBackgroundMessage(response);
            }
        })
        .catch((error) => {
            console.error(
                '[Gemini Nexus] chrome.runtime.sendMessage failed:',
                scopedPayload?.action,
                error
            );
            if (scopedPayload?.action === 'TOGGLE_BROWSER_CONTROL') {
                postBrowserControlToggleResult(bridge, scopedPayload, {
                    status: 'error',
                    error: error?.message || String(error),
                });
                return;
            }
            if (scopedPayload?.action === 'GET_ACTIVE_RUN_STATE') {
                // An unreachable worker cannot own a live run; resolve the probe
                // so the panel unsticks instead of surfacing a transport error.
                bridge.postBackgroundMessage({ action: 'ACTIVE_RUN_STATE', active: false });
                return;
            }
            postBackgroundRequestError(bridge, scopedPayload, error);
        });
}
