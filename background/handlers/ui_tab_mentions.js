import { getRequestTab, toControlTabSummary } from '../control/tabs.js';
import { respondWithUiTask } from './ui_async.js';

export function handleGetMentionTabs(context, request, sender, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            const tab = await getRequestTab(context, request, sender);
            const tabs = Number.isInteger(tab?.windowId)
                ? await chrome.tabs.query({ windowId: tab.windowId })
                : await chrome.tabs.query({ lastFocusedWindow: true });

            const summaries = tabs
                .map((item) => toControlTabSummary(item))
                .filter((item) => item && item.controllable !== false);

            return {
                action: 'MENTION_TABS_RESULT',
                currentTabId: Number.isInteger(tab?.id) ? tab.id : null,
                tabs: summaries,
            };
        },
        { errorLabel: 'Mention tabs lookup error' }
    );
}
