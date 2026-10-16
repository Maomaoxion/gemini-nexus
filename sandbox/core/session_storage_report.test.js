import { describe, expect, it } from 'vitest';
import {
    buildSessionStorageReport,
    formatStorageBytes,
    measureSessionStorage,
    selectSessionsOlderThan,
} from './session_storage_report.js';

const IMAGE_DATA_URL = `data:image/png;base64,${'A'.repeat(400)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

describe('session storage measurement', () => {
    it('measures message text and embedded image payloads separately', () => {
        const storage = measureSessionStorage({
            id: 'session-1',
            title: 'Hello',
            messages: [
                { role: 'user', text: 'Hi' },
                { role: 'user', text: 'Look at this', image: [IMAGE_DATA_URL] },
            ],
        });

        expect(storage.messageCount).toBe(2);
        expect(storage.bytes).toBeGreaterThan(IMAGE_DATA_URL.length);
        expect(storage.imageBytes).toBe(IMAGE_DATA_URL.length);
    });

    it('counts attachment and generated-image payloads too', () => {
        const storage = measureSessionStorage({
            id: 'session-1',
            messages: [
                {
                    role: 'user',
                    text: 'x',
                    attachments: [{ base64: IMAGE_DATA_URL, type: 'image/png' }],
                },
                { role: 'ai', text: 'y', generatedImages: [IMAGE_DATA_URL] },
            ],
        });

        expect(storage.imageBytes).toBe(IMAGE_DATA_URL.length * 2);
    });
});

describe('session storage report', () => {
    it('sorts chats by size and totals the report', () => {
        const report = buildSessionStorageReport([
            { id: 'small', title: 'Small', messages: [{ role: 'user', text: 'hi' }] },
            { id: 'big', title: 'Big', messages: [{ role: 'user', text: 'x'.repeat(2000) }] },
        ]);

        expect(report.sessions.map((entry) => entry.id)).toEqual(['big', 'small']);
        expect(report.totals.sessionCount).toBe(2);
        expect(report.totals.messageCount).toBe(2);
        expect(report.totals.totalBytes).toBe(report.sessions[0].bytes + report.sessions[1].bytes);
    });

    it('ignores non-session entries', () => {
        const report = buildSessionStorageReport([
            null,
            undefined,
            'text',
            { id: 'a', messages: [] },
        ]);

        expect(report.sessions.map((entry) => entry.id)).toEqual(['a']);
    });

    it('selects only chats older than the cutoff', () => {
        const now = Date.UTC(2026, 9, 16);
        const report = buildSessionStorageReport(
            [
                {
                    id: 'fresh',
                    messages: [{ role: 'user', text: 'a' }],
                    timestamp: now - DAY_MS,
                },
                {
                    id: 'stale',
                    messages: [{ role: 'user', text: 'b' }],
                    timestamp: now - 120 * DAY_MS,
                },
                { id: 'undated', messages: [{ role: 'user', text: 'c' }] },
            ],
            { now }
        );

        expect(selectSessionsOlderThan(report, 90, { now })).toEqual(['stale']);
    });

    it('formats byte sizes for the summary line', () => {
        expect(formatStorageBytes(0)).toBe('0 B');
        expect(formatStorageBytes(512)).toBe('512 B');
        expect(formatStorageBytes(2048)).toBe('2 KB');
        expect(formatStorageBytes(5 * 1024 * 1024)).toBe('5 MB');
    });
});
