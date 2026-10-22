import { respondWithUiTask } from './ui_async.js';
import { getRequestTab } from '../control/tabs.js';

export function handleGetActiveSelection(context, request, sender, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            const tab = await getRequestTab(context, request, sender);
            if (tab) {
                await sendSelectionResult(context, request, sender, tab.id);
                return;
            }
            await sendSelectionMessage(context, request, sender, '');
        },
        { errorLabel: 'Active selection lookup error' }
    );
}

async function sendSelectionResult(context, request, sender, tabId) {
    let selection = '';
    try {
        const response = await chrome.tabs.sendMessage(tabId, {
            action: 'GET_SELECTION',
        });
        selection = response ? response.selection : '';
    } catch {
        selection = '';
    }

    await sendSelectionMessage(
        context,
        request,
        sender,
        typeof selection === 'string' ? selection : ''
    );
}

async function sendSelectionMessage(context, request, sender, text) {
    await chrome.runtime.sendMessage({
        action: 'SELECTION_RESULT',
        tabId: context.getTargetSidePanelTabId(request, sender),
        text,
    });
}
