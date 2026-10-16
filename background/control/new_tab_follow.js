/**
 * Detect tabs opened as a side-effect of a click/press (target=_blank, window.open).
 * Used so browser control can follow the new page instead of remaining on the opener.
 */

export const NEW_TAB_FOLLOW_TOOL_NAMES = new Set(['click', 'press_key', 'run_steps']);

const POLL_MS = 300;
const MAX_POLLS = 7; // ~2.1s after the action settles

import { SNAPSHOT_MARKER, formatInlinePageSnapshot } from './snapshot/marker.js';

/**
 * @param {number|null|undefined} windowId
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function queryTabsInWindow(windowId) {
    if (Number.isInteger(windowId) && windowId > 0) {
        return await chrome.tabs.query({ windowId });
    }
    return await chrome.tabs.query({});
}

/**
 * Snapshot tab ids (and opener URL) before an action that may open a new tab.
 * @param {{ openerTabId?: number|null, windowId?: number|null }} opts
 */
export async function captureNewTabWatchState(opts = {}) {
    let openerTabId =
        Number.isInteger(opts.openerTabId) && opts.openerTabId > 0 ? opts.openerTabId : null;
    let windowId = Number.isInteger(opts.windowId) && opts.windowId > 0 ? opts.windowId : null;
    let openerUrl = '';

    if (openerTabId) {
        try {
            const tab = await chrome.tabs.get(openerTabId);
            openerUrl = typeof tab?.url === 'string' ? tab.url : '';
            if (windowId == null && Number.isInteger(tab?.windowId)) {
                windowId = tab.windowId;
            }
        } catch {
            // Opener may have closed; still watch the window.
        }
    }

    const tabs = await queryTabsInWindow(windowId);
    return {
        openerTabId,
        windowId,
        openerUrl,
        beforeIds: new Set(tabs.map((t) => t.id).filter((id) => Number.isInteger(id))),
    };
}

/**
 * Highest-id tab among candidates (most recently created in typical Chrome id order).
 * Used for notes only — not for auto-switch without an opener match.
 * @param {chrome.tabs.Tab[]} candidates
 * @returns {chrome.tabs.Tab|null}
 */
export function pickMostRecentTab(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    return candidates.reduce((best, tab) => (tab.id > (best?.id ?? -1) ? tab : best), null);
}

/**
 * Prefer a new tab that is opener-linked to the controlled tab.
 * Does NOT fall back to arbitrary new tabs (avoids stealing control from
 * unrelated user/extension tabs). Returns null when no trusted match.
 *
 * @param {chrome.tabs.Tab[]} candidates
 * @param {number|null} openerTabId
 * @returns {chrome.tabs.Tab|null}
 */
export function pickPreferredNewTab(candidates, openerTabId) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (!Number.isInteger(openerTabId) || openerTabId <= 0) return null;

    const withOpener = candidates.filter((t) => t.openerTabId === openerTabId);
    if (withOpener.length === 0) return null;
    return pickMostRecentTab(withOpener);
}

/**
 * Poll for tabs created after `beforeIds` that belong to the same window.
 * `preferred` is only set when openerTabId matches (safe to auto-switch).
 * `newTabs` lists all newly seen tabs (for notes when auto-switch is unsafe).
 *
 * @param {{ beforeIds: Set<number>, openerTabId?: number|null, windowId?: number|null }} watch
 * @param {{ maxPolls?: number, pollMs?: number, sleep?: (ms: number) => Promise<void> }} [options]
 */
export async function detectNewTabsFromWatch(watch, options = {}) {
    if (!watch?.beforeIds) {
        return { newTabs: [], preferred: null, openerNavigated: false };
    }

    const sleep =
        typeof options.sleep === 'function'
            ? options.sleep
            : (ms) => new Promise((r) => setTimeout(r, ms));
    const maxPolls = options.maxPolls ?? MAX_POLLS;
    const pollMs = options.pollMs ?? POLL_MS;

    let openerNavigated = false;
    let preferred = null;
    let newTabs = [];

    for (let i = 0; i < maxPolls; i++) {
        if (i > 0) await sleep(pollMs);

        if (Number.isInteger(watch.openerTabId) && watch.openerTabId > 0) {
            try {
                const opener = await chrome.tabs.get(watch.openerTabId);
                const url = typeof opener?.url === 'string' ? opener.url : '';
                if (watch.openerUrl && url && url !== watch.openerUrl) {
                    openerNavigated = true;
                }
            } catch {
                // ignore
            }
        }

        const tabs = await queryTabsInWindow(watch.windowId);
        newTabs = tabs.filter(
            (t) => Number.isInteger(t.id) && t.id > 0 && !watch.beforeIds.has(t.id)
        );
        preferred = pickPreferredNewTab(newTabs, watch.openerTabId);

        // Opener-linked new tab is a strong signal — stop early.
        if (preferred) break;
        // If the opener itself navigated, same-tab navigation is enough.
        if (openerNavigated) break;
        // Untrusted new tabs (no opener match): stop after a few polls so we
        // can note them without auto-switching.
        if (newTabs.length > 0 && i >= 2) break;
    }

    return { newTabs, preferred, openerNavigated };
}

/**
 * Build a human-readable note for the tool output.
 * @param {chrome.tabs.Tab} tab
 * @param {{ autoSwitched?: boolean, attachFailed?: boolean }} opts
 */
export function formatNewTabFollowNote(tab, opts = {}) {
    const title = tab?.title || 'Untitled';
    const url = tab?.url || tab?.pendingUrl || '(loading)';
    const auto = opts.autoSwitched === true;
    const attachFailed = opts.attachFailed === true;
    const lines = ['## New tab detected', `Opened: ${title} (${url})`];
    if (attachFailed) {
        lines.push(
            'Tried to auto-switch but the new tab was not controllable yet (or debugger attach failed). Control remains on the previous tab. Call list_pages then select_page when the page is ready.'
        );
    } else if (auto) {
        lines.push(
            'Browser control auto-switched to this tab. Use the latest snapshot (or includeSnapshot) before interacting; UIDs from the previous page are invalid.'
        );
    } else {
        lines.push(
            'A new tab was detected but was not opener-linked to the controlled page, so control was not auto-switched. Call list_pages then select_page to control it before interacting.'
        );
    }
    return `\n\n${lines.join('\n')}`;
}

/**
 * When the opener URL did not change and no new tab was found, remind the model
 * that SERP links often open elsewhere.
 */
export function formatPossibleNewTabHint() {
    return (
        '\n\n## Note\n' +
        'Page URL was unchanged after this action. If a link opened in a new tab, ' +
        'call list_pages then select_page before continuing (or re-click after list_pages).'
    );
}

/**
 * Replace or append an inline page snapshot block in tool output text.
 * @param {string} text
 * @param {string} snapshot
 * @returns {string}
 */
export function replaceInlinePageSnapshot(text, snapshot) {
    if (typeof text !== 'string' || typeof snapshot !== 'string' || !snapshot) return text;
    const block = formatInlinePageSnapshot(snapshot);
    const idx = text.indexOf(SNAPSHOT_MARKER);
    if (idx < 0) {
        return `${text.trimEnd()}${block}`;
    }
    return `${text.slice(0, idx).trimEnd()}${block}`;
}
