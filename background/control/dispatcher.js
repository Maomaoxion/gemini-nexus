/**
 * Maps string tool names to executable actions.
 * Decouples logic from the main ControlManager.
 */
import { formatInlinePageSnapshot } from './snapshot/marker.js';

export class ToolDispatcher {
    static DEBUGGER_OPTIONAL_TOOL_NAMES = new Set([
        'navigate_page',
        'new_page',
        'close_page',
        'list_pages',
        'select_page',
        // chrome.downloads — no page debugger required
        'list_downloads',
        'wait_for_download',
    ]);

    static LOCAL_TOOL_NAMES = new Set([
        // Navigation
        'navigate_page',
        'new_page',
        'close_page',
        'list_pages',
        'select_page',

        // Interaction
        'click',
        'hover',
        'fill',
        'fill_form',
        'press_key',
        'type_text',
        'attach_file',
        'drag',
        'scroll',

        // Observation & Logic
        'take_snapshot',
        'wait_for',
        'handle_dialog',
        'evaluate_script',
        'take_screenshot',
        'wait_for_url',
        'wait_for_load_state',
        'wait_for_timeout',
        'list_downloads',
        'wait_for_download',

        // Composite
        'run_steps',
    ]);

    static SNAPSHOT_OPTIONAL_TOOL_NAMES = new Set([
        'click',
        'hover',
        'fill',
        'fill_form',
        'press_key',
        'type_text',
        'attach_file',
        'drag',
        'scroll',
    ]);

    // Maps a local tool name to the BrowserActions method that implements it.
    // Shared by ToolDispatcher.dispatch and CompositeActions.runSteps so the two
    // paths can never drift apart on which method backs a given tool. The one
    // entry without a `method` (`take_snapshot`) is served by the snapshot
    // manager directly and is flagged `snapshot: true` so callers route it there.
    static TOOL_METHOD_MAP = {
        // Navigation
        navigate_page: { method: 'navigatePage' },
        new_page: { method: 'newPage' },
        close_page: { method: 'closePage' },
        list_pages: { method: 'listPages' },
        select_page: { method: 'selectPage' },

        // Interaction
        click: { method: 'clickElement' },
        hover: { method: 'hoverElement' },
        fill: { method: 'fillElement' },
        fill_form: { method: 'fillForm' },
        press_key: { method: 'pressKey' },
        type_text: { method: 'typeText' },
        attach_file: { method: 'attachFile' },
        drag: { method: 'dragElement' },
        scroll: { method: 'scrollElement' },

        // Observation & Logic
        take_snapshot: { snapshot: true },
        wait_for: { method: 'waitFor' },
        handle_dialog: { method: 'handleDialog' },
        evaluate_script: { method: 'evaluateScript' },
        take_screenshot: { method: 'takeScreenshot' },
        wait_for_url: { method: 'waitForUrl' },
        wait_for_load_state: { method: 'waitForLoadState' },
        wait_for_timeout: { method: 'waitForTimeout' },
        list_downloads: { method: 'listDownloads' },
        wait_for_download: { method: 'waitForDownload' },

        // Composite
        run_steps: { method: 'runSteps' },
    };

    static isLocalTool(name) {
        return ToolDispatcher.LOCAL_TOOL_NAMES.has(name);
    }

    static requiresDebugger(name) {
        return !ToolDispatcher.DEBUGGER_OPTIONAL_TOOL_NAMES.has(name);
    }

    // Tools that switch the locked tab (new_page/close_page/select_page) and so
    // can only be the FINAL step of a composite run — see CompositeActions.
    // Download tools are debugger-optional but do not switch tabs.
    static isTabSwitchingTool(name) {
        return name === 'new_page' || name === 'close_page' || name === 'select_page';
    }

    /**
     * @param {object} actions
     * @param {object} snapshotManager
     * @param {object|null} connection
     * @param {{ beforeAction?: Function, afterAction?: Function }} [hooks]
     *   Optional lifecycle hooks (used for new-tab follow after click).
     *   beforeAction(name, args) → pre state
     *   afterAction(name, args, result, pre) → result (string or {output,_meta})
     */
    constructor(actions, snapshotManager, connection = null, hooks = {}) {
        this.actions = actions;
        this.snapshotManager = snapshotManager;
        this.connection = connection;
        this.hooks = hooks && typeof hooks === 'object' ? hooks : {};
    }

    getOpenDialogText() {
        const dialog = this.connection?.getDialog?.();
        if (!dialog) return '';

        const defaultValue =
            dialog.type === 'prompt' && dialog.defaultPrompt
                ? ` (default value: "${dialog.defaultPrompt}")`
                : '';
        return `# Open dialog\n${dialog.type}: ${dialog.message}${defaultValue}.\nCall handle_dialog to handle it before continuing.`;
    }

    maybeAppendDialogHint(name, result) {
        if (name === 'handle_dialog' || typeof result !== 'string') return result;

        const dialogText = this.getOpenDialogText();
        if (!dialogText || result.includes('# Open dialog')) return result;

        return `${result}\n\n${dialogText}`;
    }

    async maybeAppendSnapshot(name, args, result) {
        if (
            !ToolDispatcher.SNAPSHOT_OPTIONAL_TOOL_NAMES.has(name) ||
            args?.includeSnapshot !== true ||
            typeof result !== 'string' ||
            result.startsWith('Error')
        ) {
            return result;
        }

        const dialogText = this.getOpenDialogText();
        if (dialogText) {
            return `${result}\n\n${dialogText}`;
        }

        const snapshot = await this.snapshotManager.takeSnapshot();
        return `${result}${formatInlinePageSnapshot(snapshot)}`;
    }

    async dispatch(name, args) {
        let result;
        const entry = ToolDispatcher.TOOL_METHOD_MAP[name];

        const pre =
            typeof this.hooks.beforeAction === 'function'
                ? await this.hooks.beforeAction(name, args)
                : null;

        if (entry?.snapshot) {
            result = await this.snapshotManager.takeSnapshot(args);
        } else if (entry?.method) {
            result = await this.actions[entry.method](args);
        } else {
            return `Error: Unknown tool '${name}'`;
        }

        // Follow new tabs / enrich notes BEFORE snapshot so includeSnapshot
        // reflects the tab we actually control after a target=_blank click.
        if (typeof this.hooks.afterAction === 'function') {
            result = await this.hooks.afterAction(name, args, result, pre);
        }

        result = await this.maybeAppendSnapshot(name, args, result);
        return this.maybeAppendDialogHint(name, result);
    }
}
