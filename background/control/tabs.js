const RESTRICTED_URL_PREFIXES = [
    'chrome://',
    'edge://',
    'about:',
    'chrome-extension://',
    'view-source:',
];

const RESTRICTED_URLS = ['https://chromewebstore.google.com', 'https://chrome.google.com/webstore'];

export function getTabUrl(tab) {
    return tab?.url || tab?.pendingUrl || '';
}

export function getTabControlAvailability(tab) {
    const urlRaw = getTabUrl(tab);
    if (!urlRaw) {
        return { controllable: false, reason: 'no_url' };
    }

    const url = urlRaw.toLowerCase();
    const isRestricted =
        RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix)) ||
        RESTRICTED_URLS.some((prefix) => url.startsWith(prefix));

    return {
        controllable: !isRestricted,
        reason: isRestricted ? 'restricted' : null,
    };
}

/**
 * Resolve which tab a UI request should act on: the side panel's bound tab,
 * then the sending content-script tab, then the window's active tab.
 */
export async function getRequestTab(context, request, sender) {
    const targetTabId = context.getTargetSidePanelTabId(request, sender);
    if (Number.isInteger(targetTabId) && targetTabId > 0) {
        try {
            return await chrome.tabs.get(targetTabId);
        } catch {
            // 静默降级:目标 tab 已关闭时回退到 sender.tab 或活动 tab
        }
    }

    if (sender.tab?.id) return sender.tab;

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
}

export function toControlTabSummary(tab) {
    if (!tab) return null;

    const availability = getTabControlAvailability(tab);
    return {
        id: tab.id,
        title: tab.title,
        url: getTabUrl(tab),
        favIconUrl: tab.favIconUrl,
        active: tab.active,
        controllable: availability.controllable,
        reason: availability.reason,
    };
}
