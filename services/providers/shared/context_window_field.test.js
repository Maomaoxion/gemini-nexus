import { describe, expect, it } from 'vitest';
import { readContextWindow } from './context_window_field.js';

describe('provider context window field', () => {
    it('reads flat and nested context window fields', () => {
        expect(readContextWindow({ context_length: 131072 })).toBe(131072);
        expect(readContextWindow({ inputTokenLimit: 1048576 })).toBe(1048576);
        expect(readContextWindow({ top_provider: { context_length: 32768.4 } })).toBe(32768);
    });

    it('ignores missing and implausible values', () => {
        expect(readContextWindow({})).toBeNull();
        expect(readContextWindow({ context_length: 999 })).toBeNull();
        expect(readContextWindow({ context_length: 'unknown' })).toBeNull();
    });
});
