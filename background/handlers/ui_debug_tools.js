import { getRequestTab } from '../control/tabs.js';
import { respondWithUiTask } from './ui_async.js';

export function handleToggleDebugTools(context, request, sender, sendResponse) {
    respondWithUiTask(
        sendResponse,
        async () => {
            const debugManager = context.debugManager;
            if (!debugManager) {
                throw new Error('Debug tools are unavailable.');
            }

            if (request?.enabled !== true) {
                // Stop must work even when the tab lookup is unavailable: the
                // manager also tracks a persisted tab id for SW restarts.
                let tab = null;
                try {
                    tab = await getRequestTab(context, request, sender);
                } catch {
                    tab = null;
                }
                await debugManager.stop(tab?.id || null);
                return {
                    action: 'DEBUG_TOOLS_RESULT',
                    enabled: false,
                    tabId: null,
                    status: 'stopped',
                };
            }

            // Browser control and debug tools both need the single debugger
            // session Chrome allows per tab; release control before attaching.
            if (context.controlManager?.getTargetTabId?.()) {
                await context.controlManager.disableControl();
            }

            const tab = await getRequestTab(context, request, sender);
            if (!tab?.id) {
                throw new Error('No active browser tab to debug.');
            }

            const result = await debugManager.start(tab.id);
            if (result.status === 'error') {
                throw new Error(result.error || 'Debug tools could not be enabled.');
            }

            return {
                action: 'DEBUG_TOOLS_RESULT',
                enabled: true,
                tabId: tab.id,
                status: result.status,
            };
        },
        { errorLabel: 'Debug tools toggle error' }
    );
}
