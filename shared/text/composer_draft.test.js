import { describe, expect, it } from 'vitest';

import {
    COMPOSER_DRAFT_MAX_BYTES,
    COMPOSER_DRAFT_MAX_FILES,
    getComposerDraftKey,
    isEmptyComposerDraft,
    normalizeComposerDraft,
    normalizeComposerDraftMap,
} from './composer_draft.js';

function dataUrl(bytes) {
    // 4 base64 chars per 3 bytes, rounded up to a 4-char boundary.
    const payload = 'A'.repeat(Math.ceil(bytes / 3) * 4);
    return `data:image/png;base64,${payload}`;
}

describe('composer draft normalization', () => {
    it('accepts a legacy bare string as text-only draft', () => {
        expect(normalizeComposerDraft('hello')).toEqual({ text: 'hello', files: [] });
    });

    it('drops values that are not draft-shaped', () => {
        expect(normalizeComposerDraft(null)).toEqual({ text: '', files: [] });
        expect(normalizeComposerDraft([1, 2])).toEqual({ text: '', files: [] });
        expect(normalizeComposerDraft(42)).toEqual({ text: '', files: [] });
    });

    it('keeps well-formed attachments and defaults missing metadata', () => {
        const draft = normalizeComposerDraft({
            text: 'look',
            files: [
                { base64: 'data:image/png;base64,AAAA' },
                { base64: 'data:image/png;base64,BBBB', type: 'image/png', name: 'a.png' },
            ],
        });

        expect(draft.text).toBe('look');
        expect(draft.files).toHaveLength(2);
        expect(draft.files[0]).toEqual({
            base64: 'data:image/png;base64,AAAA',
            type: 'application/octet-stream',
            name: 'attachment',
        });
        expect(draft.files[1].name).toBe('a.png');
    });

    it('drops attachments without a base64 payload', () => {
        const draft = normalizeComposerDraft({
            text: '',
            files: [{ type: 'image/png' }, { base64: '' }, { base64: 12 }, null, 'nope'],
        });

        expect(draft.files).toEqual([]);
        expect(isEmptyComposerDraft(draft)).toBe(true);
    });

    it('caps the attachment count', () => {
        const files = Array.from({ length: COMPOSER_DRAFT_MAX_FILES + 3 }, () => ({
            base64: 'data:image/png;base64,AAAA',
            type: 'image/png',
            name: 'a.png',
        }));

        expect(normalizeComposerDraft({ text: '', files }).files).toHaveLength(
            COMPOSER_DRAFT_MAX_FILES
        );
    });

    it('keeps text but skips attachments beyond the byte budget', () => {
        const draft = normalizeComposerDraft({
            text: 'still here',
            files: [
                { base64: dataUrl(1024), type: 'image/png', name: 'small.png' },
                { base64: dataUrl(COMPOSER_DRAFT_MAX_BYTES), type: 'image/png', name: 'huge.png' },
            ],
        });

        expect(draft.text).toBe('still here');
        expect(draft.files.map((file) => file.name)).toEqual(['small.png']);
    });

    it('treats whitespace-only text without attachments as empty', () => {
        expect(isEmptyComposerDraft({ text: '', files: [] })).toBe(true);
        expect(isEmptyComposerDraft({ text: ' ', files: [] })).toBe(false);
        expect(
            isEmptyComposerDraft({ text: '', files: [{ base64: 'data:image/png;base64,AAAA' }] })
        ).toBe(false);
    });

    it('keys drafts by tab and falls back to a single shared draft', () => {
        expect(getComposerDraftKey(42)).toBe('draft:42');
        expect(getComposerDraftKey(0)).toBe('draft');
        expect(getComposerDraftKey(-1)).toBe('draft');
        expect(getComposerDraftKey(null)).toBe('draft');
        expect(getComposerDraftKey('42')).toBe('draft');
    });

    it('normalizes a stored map and drops empty entries', () => {
        const drafts = normalizeComposerDraftMap({
            'draft:1': { text: 'one', files: [] },
            'draft:2': { text: '', files: [] },
            'draft:3': 'legacy text',
            bad: null,
        });

        expect(Object.keys(drafts).sort()).toEqual(['draft:1', 'draft:3']);
        expect(drafts['draft:3']).toEqual({ text: 'legacy text', files: [] });
    });

    it('returns an empty map for non-object storage values', () => {
        expect(normalizeComposerDraftMap(null)).toEqual({});
        expect(normalizeComposerDraftMap([])).toEqual({});
        expect(normalizeComposerDraftMap('nope')).toEqual({});
    });
});
