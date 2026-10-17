import { estimateDataUrlBytes } from '../attachments/index.js';

// Composer drafts live in chrome.storage.session, which caps the whole area at
// 10 MB. A single pasted screenshot can be several MB as base64, so a draft
// keeps only the attachments that fit the budget; text is never dropped.
export const COMPOSER_DRAFT_MAX_FILES = 10;
export const COMPOSER_DRAFT_MAX_BYTES = 2 * 1024 * 1024;

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getComposerDraftKey(tabId) {
    return Number.isInteger(tabId) && tabId > 0 ? `draft:${tabId}` : 'draft';
}

export function normalizeComposerDraft(value, limits = {}) {
    const maxFiles = Number.isInteger(limits.maxFiles) ? limits.maxFiles : COMPOSER_DRAFT_MAX_FILES;
    const maxBytes = Number.isInteger(limits.maxBytes) ? limits.maxBytes : COMPOSER_DRAFT_MAX_BYTES;

    if (typeof value === 'string') {
        return { text: value, files: [] };
    }
    if (!isPlainObject(value)) {
        return { text: '', files: [] };
    }

    const files = [];
    let totalBytes = 0;
    for (const file of Array.isArray(value.files) ? value.files : []) {
        if (files.length >= maxFiles) break;
        if (!isPlainObject(file) || typeof file.base64 !== 'string' || !file.base64) continue;

        const bytes = estimateDataUrlBytes(file.base64);
        if (totalBytes + bytes > maxBytes) continue;

        totalBytes += bytes;
        files.push({
            base64: file.base64,
            type:
                typeof file.type === 'string' && file.type ? file.type : 'application/octet-stream',
            name: typeof file.name === 'string' && file.name ? file.name : 'attachment',
        });
    }

    return {
        text: typeof value.text === 'string' ? value.text : '',
        files,
    };
}

export function isEmptyComposerDraft(value) {
    const draft = normalizeComposerDraft(value);
    return !draft.text && draft.files.length === 0;
}

export function normalizeComposerDraftMap(value, limits = {}) {
    if (!isPlainObject(value)) return {};

    const drafts = {};
    for (const [key, draftValue] of Object.entries(value)) {
        if (typeof key !== 'string' || !key) continue;
        const draft = normalizeComposerDraft(draftValue, limits);
        if (!isEmptyComposerDraft(draft)) {
            drafts[key] = draft;
        }
    }
    return drafts;
}
