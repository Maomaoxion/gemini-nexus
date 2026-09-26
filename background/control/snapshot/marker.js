/**
 * Wire format for the accessibility snapshot the control layer inlines into a
 * tool result. The model is told this exact heading, so every producer and
 * consumer must build or detect the block from here rather than re-typing it.
 */
export const SNAPSHOT_MARKER = '## Latest page snapshot';

/**
 * @param {string} snapshot
 * @returns {string} the snapshot block, including the leading blank line
 */
export function formatInlinePageSnapshot(snapshot) {
    return `\n\n${SNAPSHOT_MARKER}\n${snapshot}`;
}

/**
 * @param {unknown} text
 * @returns {boolean} true when a tool result already carries a snapshot
 */
export function hasInlinePageSnapshot(text) {
    return typeof text === 'string' && text.includes(SNAPSHOT_MARKER);
}
