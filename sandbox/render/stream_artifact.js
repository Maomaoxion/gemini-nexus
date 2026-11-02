import { getArtifactKind } from './artifact_sanitize.js';

// A Live Artifact can arrive either as bare inline HTML or as a fenced block.
// While streaming it is usually still unclosed, so detection works on the
// partial text instead of waiting for the final document.
const FENCED_BLOCK_PATTERN = /```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)(?:\r?\n[ \t]*```|$)/g;
const BLOCK_HTML_START_PATTERN =
    /<(?:article|aside|div|h[1-6]|header|main|p|section|table|ul|ol)\b/i;

/**
 * Splits streaming text into surrounding Markdown and a live HTML artifact.
 * @param {string} text - cumulative assistant text
 * @returns {{ prose: string, artifactHtml: string, suffix: string } | null}
 */
export function splitStreamingArtifact(text) {
    const source = typeof text === 'string' ? text : '';
    if (!source.trim()) return null;

    FENCED_BLOCK_PATTERN.lastIndex = 0;
    let match;
    while ((match = FENCED_BLOCK_PATTERN.exec(source)) !== null) {
        const language = match[1] || '';
        const body = match[2];
        if (getArtifactKind(language, body) === 'html') {
            return {
                prose: source.slice(0, match.index),
                artifactHtml: body,
                suffix: source.slice(match.index + match[0].length),
            };
        }
    }

    const start = source.search(BLOCK_HTML_START_PATTERN);
    if (start === -1) return null;

    // Ignore block tags that are already inside a Markdown code fence.
    const fenceCount = (source.slice(0, start).match(/```/g) || []).length;
    if (fenceCount % 2 === 1) return null;

    const artifactHtml = source.slice(start);
    if (getArtifactKind('', artifactHtml) !== 'html') return null;

    return { prose: source.slice(0, start), artifactHtml, suffix: '' };
}
