import { describe, expect, it } from 'vitest';
import { splitStreamingArtifact } from './stream_artifact.js';

describe('splitStreamingArtifact', () => {
    it('detects a bare live artifact before its root closes', () => {
        const result = splitStreamingArtifact(
            '<div style="display:block;width:100%;"><h2>Draft title'
        );

        expect(result).not.toBeNull();
        expect(result.prose).toBe('');
        expect(result.artifactHtml).toContain('Draft title');
    });

    it('keeps prose that precedes the artifact', () => {
        const result = splitStreamingArtifact(
            'Here is the page:\n\n<div style="display:block;width:100%;"><h2>Draft'
        );

        expect(result.prose).toContain('Here is the page');
        expect(result.artifactHtml.startsWith('<div')).toBe(true);
    });

    it('detects an unclosed fenced live artifact', () => {
        const result = splitStreamingArtifact(
            '```amc-live-artifact-html\n<div style="display:block;width:100%;"><h2>Draft'
        );

        expect(result).not.toBeNull();
        expect(result.artifactHtml).toContain('display:block');
    });

    it('keeps prose that follows a fenced artifact', () => {
        const result = splitStreamingArtifact(
            '```amc-live-artifact-html\n<div style="display:block;width:100%;">X</div>\n```\nAfter'
        );

        expect(result).not.toBeNull();
        expect(result.artifactHtml).toContain('X');
        expect(result.suffix.trim()).toBe('After');
    });

    it('leaves ordinary html code samples as code', () => {
        expect(splitStreamingArtifact('```html\n<div>Hello</div>\n```')).toBeNull();
    });

    it('ignores block tags that are inside a code fence', () => {
        expect(splitStreamingArtifact('```js\nconst x = "<div>";\n```')).toBeNull();
    });

    it('returns null for plain markdown', () => {
        expect(splitStreamingArtifact('Hello **world**')).toBeNull();
    });
});
