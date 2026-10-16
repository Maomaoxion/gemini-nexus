import { debugLog } from '../../../shared/logging/debug.js';
import { getTabControlAvailability } from '../../control/tabs.js';

export async function getActiveTabContent(specificTabId = null) {
    try {
        let tab;
        if (specificTabId) {
            try {
                tab = await chrome.tabs.get(specificTabId);
            } catch {
                return null;
            }
        } else {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            tab = tabs[0];
        }

        if (!tab || !tab.id) return null;

        // Same restricted-URL table the browser-control path already owns; the
        // hand-maintained copy here had drifted from it.
        if (!getTabControlAvailability(tab).controllable) return null;

        try {
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_CONTENT' });
            return response ? response.content : null;
        } catch {
            debugLog('Content script unavailable, attempting fallback injection...');
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => (document.body ? document.body.innerText : ''),
                });
                return results?.[0]?.result || null;
            } catch (injectionError) {
                console.error('Fallback injection failed:', injectionError);
                return null;
            }
        }
    } catch (error) {
        console.error('Failed to get page context:', error);
        return null;
    }
}
