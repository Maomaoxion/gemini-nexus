import { BaseActionHandler } from './base.js';
import { ToolDispatcher } from '../dispatcher.js';
import { debugLog } from '../../../shared/logging/debug.js';
import { formatInlinePageSnapshot, hasInlinePageSnapshot } from '../snapshot/marker.js';

const MAX_STEPS = 8;

// Composite tool: runs a sequence of atomic browser-control tools in one
// dispatch, collapsing what would be N agent-loop turns (each costing an LLM
// round-trip plus the 2–4s inter-turn rate-limit delay) into a single tool
// call. Atomic actions are invoked on the shared BrowserActions instance, so
// every behavior (occlusion detection, JS fallback, navigation waiting) is
// identical to calling the tool standalone.
export class CompositeActions extends BaseActionHandler {
    constructor(connection, snapshotManager, waitHelper, actions) {
        super(connection, snapshotManager, waitHelper);
        this.actions = actions;
    }

    async runSteps(args = {}) {
        const { steps, includeSnapshot = true } = args;

        const validationError = this._validateSteps(steps);
        if (validationError) return validationError;

        const lines = [];
        let lastMeta = null;

        for (let index = 0; index < steps.length; index++) {
            const step = steps[index];
            const { tool, args: stepArgs } = step;
            const stepNumber = index + 1;

            // Strip includeSnapshot from each atomic call: run_steps takes a
            // single snapshot at the end (when requested) so intermediate steps
            // don't each drag in a full accessibility tree and blow up tokens.
            const atomicArgs = { ...(stepArgs || {}), includeSnapshot: false };

            let result;
            try {
                result = await this._invokeAtomic(tool, atomicArgs);
            } catch (error) {
                // Some atomic tools (click/hover) throw on stale UIDs instead of
                // returning an Error string. Normalize to the same "step N failed"
                // shape so isFailedToolOutput in the agent loop can flag it.
                lines.push(`Step ${stepNumber} (${tool}): Error: ${error.message}`);
                return await this._formatStepFailure(stepNumber, tool, lines);
            }

            // Atomic tools return either a string, a { text, image } screenshot
            // object, or a { output, _meta } navigation wrapper. Unwrap to the
            // displayable text and capture the trailing _meta for tab switches.
            const { text, meta } = this._unwrap(result);
            lastMeta = meta;

            if (isFailedOutput(text)) {
                lines.push(`Step ${stepNumber} (${tool}): ${text}`);
                return await this._formatStepFailure(stepNumber, tool, lines);
            }

            lines.push(`Step ${stepNumber} (${tool}): ${text}`);
        }

        let summary = `Completed ${steps.length} step${steps.length === 1 ? '' : 's'}.\n${lines.join('\n')}`;

        if (includeSnapshot) {
            const snapshotText = this.connection.getDialog?.()
                ? null
                : await this._takeSnapshotSafely();
            if (snapshotText) {
                summary += formatInlinePageSnapshot(snapshotText);
            }
        }

        // Surface only the final step's _meta so ControlManager._executeNow can
        // switch the locked tab to wherever the sequence landed. Intermediate
        // _meta (e.g. a mid-sequence new_page) are deliberately dropped — see
        // the plan: switching tabs mid-sequence would leave later steps running
        // against the old tab because ensureConnection is only called once.
        if (lastMeta) {
            return { output: summary, _meta: lastMeta };
        }
        return summary;
    }

    _validateSteps(steps) {
        if (!Array.isArray(steps) || steps.length === 0) {
            return "Error: 'steps' must be a non-empty array of { tool, args } objects.";
        }
        if (steps.length > MAX_STEPS) {
            return `Error: 'steps' supports at most ${MAX_STEPS} steps; received ${steps.length}.`;
        }
        for (let index = 0; index < steps.length; index++) {
            const step = steps[index];
            const position = index + 1;
            if (!step || typeof step !== 'object') {
                return `Error: step ${position} must be an object with 'tool' and 'args'.`;
            }
            const { tool, args } = step;
            if (typeof tool !== 'string' || !tool.trim()) {
                return `Error: step ${position} has a missing or non-string 'tool'.`;
            }
            if (tool === 'run_steps') {
                return `Error: step ${position} ('run_steps') cannot nest run_steps.`;
            }
            if (!ToolDispatcher.isLocalTool(tool)) {
                return `Error: step ${position} ('${tool}') is not a supported atomic tool.`;
            }
            if (
                args !== undefined &&
                args !== null &&
                (typeof args !== 'object' || Array.isArray(args))
            ) {
                return `Error: step ${position} ('${tool}') args must be an object.`;
            }
            // Tab-switching tools (new_page/close_page/select_page) only take
            // effect on the NEXT ensureConnection, which run_steps does not
            // re-invoke mid-sequence — so they must be the final step.
            if (ToolDispatcher.isTabSwitchingTool(tool) && position !== steps.length) {
                return `Error: step ${position} ('${tool}') switches the controlled tab and may only be the final step of run_steps.`;
            }
        }
        return null;
    }

    async _invokeAtomic(tool, atomicArgs) {
        const entry = ToolDispatcher.TOOL_METHOD_MAP[tool];
        if (!entry) {
            throw new Error(`Unknown tool '${tool}'.`);
        }
        if (entry.snapshot) {
            return await this.snapshotManager.takeSnapshot(atomicArgs);
        }
        const method = this.actions[entry.method];
        if (typeof method !== 'function') {
            throw new Error(`Tool '${tool}' is not available on the actions facade.`);
        }
        return await method.call(this.actions, atomicArgs);
    }

    _unwrap(result) {
        if (result && typeof result === 'object') {
            if (typeof result.text === 'string' && result.image) {
                return { text: result.text, meta: null };
            }
            if ('output' in result) {
                return { text: result.output, meta: result._meta || null };
            }
        }
        return { text: result, meta: null };
    }

    async _takeSnapshotSafely() {
        try {
            const snapshot = await this.snapshotManager.takeSnapshot();
            if (typeof snapshot === 'string' && !snapshot.startsWith('Error')) {
                return snapshot;
            }
        } catch (error) {
            // Best-effort: a snapshot failure should not mask the step results.
            debugLog?.('[CompositeActions] Snapshot after run_steps failed:', error);
        }
        return null;
    }

    /** Fail-fast summary; attach a recovery tree if the error has none yet. */
    async _formatStepFailure(stepNumber, tool, lines) {
        let summary = `Error: step ${stepNumber} (${tool}) failed.\n${lines.join('\n')}`;
        if (hasInlinePageSnapshot(summary)) {
            return summary;
        }
        const snapshotText = this.connection.getDialog?.()
            ? null
            : await this._takeSnapshotSafely();
        if (snapshotText) {
            summary += formatInlinePageSnapshot(snapshotText);
        }
        return summary;
    }
}

function isFailedOutput(text) {
    const value = typeof text === 'string' ? text.trim() : '';
    return /^(Error\b|Error executing\b|Timed out\b|Script Exception:)/i.test(value);
}
