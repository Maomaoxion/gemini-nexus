import { appendAiMessageIfDisplayable } from '../../../managers/history_manager.js';
import {
    buildDebugNarrationNudgePrompt,
    buildNarrationNudgePrompt,
    createNarrationIntermediateAiResult,
    looksLikeUnexecutedBrowserActionPlan,
    looksLikeUnexecutedDebugPlan,
} from './tool_loop.js';

/**
 * Picks the narration nudge that applies to a reply without a tool call.
 * Native tool mode never nudges; browser control is checked before debug,
 * matching the tool-loop order when both toggles are on.
 *
 * @param {{ nativeTools?: boolean, enableBrowserControl?: boolean, enableDebugTools?: boolean }} request
 * @param {unknown} text
 * @returns {'browser'|'debug'|null}
 */
export function detectNarrationNudgeKind(request, text) {
    if (request?.nativeTools === true) return null;
    if (request?.enableBrowserControl === true && looksLikeUnexecutedBrowserActionPlan(text)) {
        return 'browser';
    }
    if (request?.enableDebugTools === true && looksLikeUnexecutedDebugPlan(text)) {
        return 'debug';
    }
    return null;
}

/**
 * Persists and broadcasts a narration-only reply, waits before the next model
 * turn, and returns the nudge prompt to send.
 *
 * @param {object} params
 * @param {'browser'|'debug'} params.kind
 * @param {string} params.runId
 * @param {number} params.loop 1-based loop number for logging
 * @param {object} params.request
 * @param {object} params.result model result for the narration-only turn
 * @param {'zh'|'default'} params.language
 * @param {() => Promise<void>} [params.wait] cancellable delay owned by the caller
 * @returns {Promise<{ promptText: string, historyText: string }>}
 */
export async function runNarrationNudge({ kind, runId, loop, request, result, language, wait }) {
    const intermediate = createNarrationIntermediateAiResult(result);

    console.info('[Gemini Nexus] Narration nudge', { runId, loop, kind });

    if (request.sessionId) {
        await appendAiMessageIfDisplayable(request.sessionId, intermediate);
    }

    chrome.runtime
        .sendMessage({
            action: 'AGENT_INTERMEDIATE_MESSAGE',
            sessionId: request.sessionId || null,
            text: intermediate.text || '',
            thoughts: intermediate.thoughts || null,
            suppressCopy: true,
        })
        .catch(() => {});

    if (typeof wait === 'function') {
        await wait();
    }

    return {
        promptText:
            kind === 'debug'
                ? buildDebugNarrationNudgePrompt(language)
                : buildNarrationNudgePrompt(language),
        historyText: intermediate.text || result?.text || '',
    };
}
