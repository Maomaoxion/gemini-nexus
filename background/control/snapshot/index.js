import { SnapshotFormatter } from './formatter.js';

/**
 * Host elements owned by this extension that pollute page a11y trees
 * (toolbar, capture overlay, cursor, YouTube summary). Hidden via aria-hidden
 * only for the duration of Accessibility.getFullAXTree.
 */
export const EXTENSION_UI_HIDE_SELECTOR = [
    '#gemini-nexus-toolbar-host',
    '#gemini-nexus-overlay',
    '#gemini-nexus-cursor-root',
    '#gemini-nexus-youtube-summary-btn',
    '#gemini-nexus-youtube-summary-panel',
    '[data-gemini-nexus-ui]',
].join(',');

const HIDE_EXTENSION_UI_SCRIPT = `(() => {
  const SEL = ${JSON.stringify(EXTENSION_UI_HIDE_SELECTOR)};
  const ATTR_ARIA = 'data-gnx-snapshot-prev-aria';
  const ATTR_INERT = 'data-gnx-snapshot-prev-inert';
  let count = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!el.hasAttribute(ATTR_ARIA)) {
      el.setAttribute(ATTR_ARIA, el.hasAttribute('aria-hidden') ? el.getAttribute('aria-hidden') : '');
      el.setAttribute(ATTR_INERT, el.inert ? '1' : '0');
    }
    el.setAttribute('aria-hidden', 'true');
    try { el.inert = true; } catch (_) {}
    count += 1;
  }
  return count;
})()`;

const RESTORE_EXTENSION_UI_SCRIPT = `(() => {
  const ATTR_ARIA = 'data-gnx-snapshot-prev-aria';
  const ATTR_INERT = 'data-gnx-snapshot-prev-inert';
  let count = 0;
  for (const el of document.querySelectorAll('[' + ATTR_ARIA + ']')) {
    const prev = el.getAttribute(ATTR_ARIA);
    if (prev === null || prev === '') el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', prev);
    try { el.inert = el.getAttribute(ATTR_INERT) === '1'; } catch (_) {}
    el.removeAttribute(ATTR_ARIA);
    el.removeAttribute(ATTR_INERT);
    count += 1;
  }
  return count;
})()`;

/**
 * Handles Accessibility Tree generation and UID mapping.
 * Converts complex DOM structures into an LLM-friendly, token-efficient text tree.
 */
export class SnapshotManager {
    constructor(connection) {
        this.connection = connection;
        this.snapshotMap = new Map(); // Maps uid -> backendNodeId
        this.uidToAxNode = new Map(); // Maps uid -> AXNode (raw)
        this.uidToNodeId = new Map(); // Maps uid -> AX nodeId
        this.nodeIdToUid = new Map(); // Maps AX nodeId -> uid
        this.axNodeByNodeId = new Map(); // Maps AX nodeId -> AXNode (raw)
        this.backendNodeIdToUid = new Map(); // Keeps stable UIDs for DOM nodes while the page is stable
        this.snapshotIdCount = 0;

        // Listen to connection detach to clear state
        this.connection.onDetach(() => this.reset());
        this.connection.addListener?.((method, params) => {
            if (this._shouldResetStableIdsForEvent(method, params)) {
                this.reset();
            }
        });
    }

    clear() {
        this.snapshotMap.clear();
        this.uidToAxNode.clear();
        this.uidToNodeId.clear();
        this.nodeIdToUid.clear();
        this.axNodeByNodeId.clear();
    }

    reset() {
        this.clear();
        this.backendNodeIdToUid.clear();
        // Cross-document navigation empties the UID maps. Bump the version so
        // subsequent lookups of pre-navigation UIDs throw "Stale Element
        // Reference" (version mismatch) instead of the misleading
        // "Element not found" (version still matches an empty map).
        this.snapshotIdCount += 1;
    }

    _shouldResetStableIdsForEvent(method, params = {}) {
        if (method === 'Page.navigatedWithinDocument') return false;
        if (method === 'Page.frameStartedNavigating') {
            return !['sameDocument', 'historySameDocument'].includes(params?.navigationType);
        }
        if (method === 'Page.frameNavigated') {
            return !params?.frame?.parentId;
        }
        return false;
    }

    getBackendNodeId(uid) {
        const id = this.snapshotMap.get(uid);
        if (id) return id;

        // UIDs are formatted as "{snapshotId}_{nodeIndex}"
        if (uid && uid.includes('_')) {
            const parts = uid.split('_');
            const snapshotVersion = parseInt(parts[0], 10);

            if (!isNaN(snapshotVersion) && snapshotVersion !== this.snapshotIdCount) {
                throw new Error(
                    `Stale Element Reference: UID '${uid}' belongs to an older snapshot (v${snapshotVersion}). The current page state is v${this.snapshotIdCount}. You MUST call 'take_snapshot' to get fresh UIDs.`
                );
            }
        }

        // If ID matches current version but not found in map, it's likely invalid or ephemeral
        throw new Error(
            `Element '${uid}' not found in current snapshot. Please verify the UID or take a new snapshot.`
        );
    }

    /** True when an error indicates the model/action should re-snapshot. */
    static isUidResolutionError(errorOrMessage) {
        const message =
            typeof errorOrMessage === 'string'
                ? errorOrMessage
                : errorOrMessage?.message || String(errorOrMessage || '');
        return (
            message.includes('not found in current snapshot') ||
            message.includes('Stale Element Reference') ||
            message.includes('is detached from the DOM') ||
            message.includes('has no backend ID')
        );
    }

    getAXNode(uid) {
        return this.uidToAxNode.get(uid);
    }

    /**
     * Traverses descendants of a node using the raw AX tree structure.
     */
    findDescendant(rootUid, predicate) {
        const rootNodeId = this.uidToNodeId.get(rootUid);
        if (!rootNodeId) return null;

        const visit = (nodeId) => {
            const node = this.axNodeByNodeId.get(nodeId);
            if (!node || !Array.isArray(node.childIds)) return null;

            for (const childId of node.childIds) {
                const childNode = this.axNodeByNodeId.get(childId);
                const childUid = this.nodeIdToUid.get(childId);
                if (childNode && childUid && predicate(childNode, childUid)) {
                    return childUid;
                }

                const descendantUid = visit(childId);
                if (descendantUid) return descendantUid;
            }

            return null;
        };

        return visit(rootNodeId);
    }

    async _evaluatePageExpression(expression) {
        try {
            await this.connection.sendCommand('Runtime.enable');
            await this.connection.sendCommand('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: false,
            });
        } catch {
            // Page may be restricted / detached — snapshot still proceeds.
        }
    }

    async _hideExtensionUiForSnapshot() {
        await this._evaluatePageExpression(HIDE_EXTENSION_UI_SCRIPT);
    }

    async _restoreExtensionUiAfterSnapshot() {
        await this._evaluatePageExpression(RESTORE_EXTENSION_UI_SCRIPT);
    }

    async takeSnapshot(args = {}) {
        // Ensure domains are enabled
        await this.connection.sendCommand('DOM.enable');
        await this.connection.sendCommand('Accessibility.enable');

        // Keep extension chrome (toolbar / cursor / overlays) out of the tree
        // the agent reads, so it does not click "询问 Gemini" by mistake.
        await this._hideExtensionUiForSnapshot();

        let nodes;
        try {
            const result = await this.connection.sendCommand('Accessibility.getFullAXTree');
            nodes = result?.nodes;
        } finally {
            await this._restoreExtensionUiAfterSnapshot();
        }

        if (!Array.isArray(nodes)) {
            return 'Error: Could not read accessibility tree.';
        }

        this.snapshotIdCount++;

        this.clear();
        const seenBackendNodeIds = new Set();
        nodes.forEach((node) => {
            if (node.nodeId) this.axNodeByNodeId.set(node.nodeId, node);
        });

        const formatter = new SnapshotFormatter({
            verbose: args.verbose === true,
            snapshotPrefix: this.snapshotIdCount,
            resolveUid: (node, fallbackUid) => {
                const backendNodeId = node.backendDOMNodeId;
                if (!backendNodeId) return fallbackUid;

                const existingUid = this.backendNodeIdToUid.get(backendNodeId);
                if (existingUid) return existingUid;

                this.backendNodeIdToUid.set(backendNodeId, fallbackUid);
                return fallbackUid;
            },
            onNode: (node, uid) => {
                if (node.backendDOMNodeId) {
                    this.snapshotMap.set(uid, node.backendDOMNodeId);
                    seenBackendNodeIds.add(node.backendDOMNodeId);
                }
                this.uidToAxNode.set(uid, node);
                if (node.nodeId) {
                    this.uidToNodeId.set(uid, node.nodeId);
                    this.nodeIdToUid.set(node.nodeId, uid);
                }
            },
        });

        const snapshot = formatter.format(nodes);

        for (const backendNodeId of this.backendNodeIdToUid.keys()) {
            if (!seenBackendNodeIds.has(backendNodeId)) {
                this.backendNodeIdToUid.delete(backendNodeId);
            }
        }

        return snapshot;
    }
}
