import { ActionWaiter } from '../action_waiter.js';
import { cursorController } from '../cursor_controller.js';
import { SnapshotManager } from '../snapshot/index.js';
import { formatInlinePageSnapshot } from '../snapshot/marker.js';

const FOCUS_STEAL_CACHE_MS = 5000;
const FOCUS_STEAL_STORAGE_KEY = 'BACKGROUND_INTERACTION_ENABLED';
const MAX_LAYOUT_RETRIES = 3;
const LAYOUT_RETRY_DELAY_MS = 150;

function isTransientLayoutError(error) {
    const message = error?.message || '';
    return message.includes('layout object') || message.includes('Node is detached');
}

function delay(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class BaseActionHandler {
    constructor(connection, snapshotManager, waitHelper) {
        this.connection = connection;
        this.snapshotManager = snapshotManager;
        this.waitHelper = waitHelper || new ActionWaiter(connection);
        this._focusStealCache = null;
        this._focusStealCacheAt = 0;
    }

    cmd(method, params) {
        return this.connection.sendCommand(method, params);
    }

    /**
     * Resolve a snapshot UID to a CDP remote objectId.
     * On missing/stale UID: take one fresh snapshot and retry the same UID
     * (helps same-document stable UIDs). If still failing, rethrow with the
     * recovery snapshot attached so the agent can continue without an extra
     * take_snapshot turn.
     */
    async getObjectIdFromUid(uid) {
        try {
            return await this._resolveObjectIdFromUid(uid);
        } catch (error) {
            if (!SnapshotManager.isUidResolutionError(error)) {
                throw error;
            }

            let recoverySnapshot = null;
            try {
                recoverySnapshot = await this.snapshotManager.takeSnapshot();
            } catch {
                throw error;
            }

            try {
                return await this._resolveObjectIdFromUid(uid);
            } catch (retryError) {
                const snapText =
                    typeof recoverySnapshot === 'string' &&
                    recoverySnapshot &&
                    !recoverySnapshot.startsWith('Error')
                        ? formatInlinePageSnapshot(recoverySnapshot)
                        : '';
                throw new Error(`${retryError.message}${snapText}`);
            }
        }
    }

    async _resolveObjectIdFromUid(uid) {
        // This will throw "Stale Element Reference" if versions mismatch,
        // catching errors early before sending commands to browser.
        const backendNodeId = this.snapshotManager.getBackendNodeId(uid);

        if (!backendNodeId) {
            throw new Error(`Node with uid ${uid} has no backend ID. It might be a virtual node.`);
        }

        const resolveNode = async (backendId) => {
            try {
                const { object } = await this.cmd('DOM.resolveNode', { backendNodeId: backendId });
                return object ? object.objectId : null;
            } catch {
                // DOM.resolveNode fails if node is detached from document
                return null;
            }
        };

        const objectId = await resolveNode(backendNodeId);

        if (!objectId) {
            throw new Error(`Element ${uid} is detached from the DOM. Please take a new snapshot.`);
        }

        // Trigger highlight for visual feedback on interaction
        this._doHighlight({ objectId }).catch(() => {});

        return objectId;
    }

    async _doHighlight(params) {
        try {
            await this.cmd('Overlay.enable');
            await this.cmd('Overlay.highlightNode', {
                ...params,
                highlightConfig: {
                    showInfo: true,
                    showRulers: false,
                    showExtensionLines: false,
                    contentColor: { r: 11, g: 87, b: 208, a: 0.3 }, // Gemini Blue fill
                    paddingColor: { r: 11, g: 87, b: 208, a: 0.1 },
                    borderColor: { r: 11, g: 87, b: 208, a: 0.8 }, // Border
                },
            });

            // Auto-hide after 1.5 seconds
            setTimeout(() => {
                this.cmd('Overlay.hideHighlight').catch(() => {});
            }, 1500);
        } catch {
            // Ignore highlight errors
        }
    }

    async moveCursorToElement({ backendNodeId }) {
        if (!backendNodeId) return;
        try {
            const { model } = await this.cmd('DOM.getBoxModel', { backendNodeId });
            if (!model || !model.content) return;
            const centerX = (model.content[0] + model.content[4]) / 2;
            const centerY = (model.content[1] + model.content[5]) / 2;
            await this.moveCursorToPoint(centerX, centerY);
        } catch {
            // Cursor is best-effort visual feedback; never block the action.
        }
    }

    async moveCursorToPoint(x, y) {
        try {
            await cursorController.moveCursorTo(this.connection?.currentTabId, x, y);
        } catch {
            // Cursor is best-effort visual feedback; never block the action.
        }
    }

    // Mirror BCB's bringPageToFront: activates the target tab's renderer so
    // dispatched input reaches a focused document. Gated by the same
    // BACKGROUND_INTERACTION_ENABLED storage flag (default false = bring to front).
    async bringPageToFront() {
        if (await this._shouldSuppressFocusSteal()) return;
        try {
            await this.cmd('Page.bringToFront', {});
        } catch {
            // Best-effort: restricted tabs may reject this.
        }
    }

    async _shouldSuppressFocusSteal() {
        const now = Date.now();
        if (
            this._focusStealCache !== null &&
            now - this._focusStealCacheAt < FOCUS_STEAL_CACHE_MS
        ) {
            return this._focusStealCache;
        }
        let value = false;
        try {
            const items = await chrome.storage.local.get(FOCUS_STEAL_STORAGE_KEY);
            value = items[FOCUS_STEAL_STORAGE_KEY] === true;
        } catch {
            value = false;
        }
        this._focusStealCache = value;
        this._focusStealCacheAt = now;
        return value;
    }

    async _getViewportCenter() {
        const metrics = await this.cmd('Page.getLayoutMetrics');
        const viewport = metrics?.cssLayoutViewport || metrics?.cssVisualViewport;
        const width = Number(viewport?.clientWidth) || 0;
        const height = Number(viewport?.clientHeight) || 0;
        return { x: width / 2, y: height / 2 };
    }

    // Resolve the center of an element in viewport coordinates, scrolling it
    // into view first and retrying transient layout errors. Shared by click,
    // hover, drag, and scroll so every targeting action uses the same point.
    async _getElementCenter({ objectId, backendNodeId }) {
        for (let attempt = 0; attempt < MAX_LAYOUT_RETRIES; attempt++) {
            try {
                await this.cmd('DOM.scrollIntoViewIfNeeded', { objectId });

                const { model } = await this.cmd('DOM.getBoxModel', { backendNodeId });
                if (!model || !model.content) throw new Error('No box model');

                return {
                    x: (model.content[0] + model.content[4]) / 2,
                    y: (model.content[1] + model.content[5]) / 2,
                };
            } catch (error) {
                const hasRetryLeft = attempt < MAX_LAYOUT_RETRIES - 1;
                if (isTransientLayoutError(error) && hasRetryLeft) {
                    await delay(LAYOUT_RETRY_DELAY_MS);
                    continue;
                }
                throw error;
            }
        }
    }
}
