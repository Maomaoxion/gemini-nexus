import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupConsoleInterception, LogManager } from './log_manager.js';

describe('console log redaction', () => {
    let originalConsole;

    beforeEach(() => {
        originalConsole = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
        };
    });

    afterEach(() => {
        Object.assign(console, originalConsole);
    });

    it('redacts secrets before persisted console messages are stored', () => {
        const logManager = { add: vi.fn() };
        console.warn = vi.fn();
        setupConsoleInterception(logManager);

        console.warn('request failed', {
            Authorization: 'Bearer secret-token',
            apiKey: 'sk-secret',
            url: 'https://api.example.test/v1/models?key=query-secret&access_token=query-token',
            nested: {
                cookie: 'session=private-cookie',
                refreshToken: 'refresh-secret',
            },
        });

        const entry = logManager.add.mock.calls[0][0];

        expect(entry.message).toContain('[REDACTED]');
        expect(entry.message).not.toContain('secret-token');
        expect(entry.message).not.toContain('sk-secret');
        expect(entry.message).not.toContain('query-secret');
        expect(entry.message).not.toContain('query-token');
        expect(entry.message).not.toContain('private-cookie');
        expect(entry.message).not.toContain('refresh-secret');
    });
});

describe('LogManager sinks', () => {
    it('notifies registered sinks on add()', () => {
        const sink = { log: vi.fn() };
        const manager = new LogManager([sink]);
        // avoid hitting real chrome.storage in unit test
        manager._save = () => {};
        manager.add({ level: 'INFO', context: 'X', message: 'm' });
        expect(sink.log).toHaveBeenCalledTimes(1);
        expect(sink.log.mock.calls[0][0]).toMatchObject({
            level: 'INFO',
            context: 'X',
            message: 'm',
        });
    });

    it('works with no sinks (backward compatible)', () => {
        const manager = new LogManager();
        manager._save = () => {};
        expect(() => manager.add({ level: 'INFO', message: 'm' })).not.toThrow();
    });

    it('keeps working if a sink throws', () => {
        const broken = {
            log: () => {
                throw new Error('boom');
            },
        };
        const ok = { log: vi.fn() };
        const manager = new LogManager([broken, ok]);
        manager._save = () => {};
        manager.add({ level: 'INFO', message: 'm' });
        expect(ok.log).toHaveBeenCalledTimes(1);
    });

    it('guards against re-entry from a sink (no infinite recursion)', () => {
        const manager = new LogManager();
        manager._save = () => {};
        let reentryCount = 0;
        manager.sinks.push({
            log: () => {
                reentryCount++;
                if (reentryCount < 5) manager.add({ level: 'INFO', message: 'reentry' });
            },
        });
        expect(() => manager.add({ level: 'INFO', message: 'init' })).not.toThrow();
        expect(reentryCount).toBe(1); // re-entrant add was dropped by the guard
    });

    it('drops the oldest entries once the retained log text exceeds its budget', () => {
        const manager = new LogManager();
        manager._save = () => {};
        manager.MAX_LOG_BYTES = 4096;

        for (let index = 0; index < 40; index++) {
            manager.add({
                level: 'ERROR',
                context: 'System',
                message: `entry-${index} ${'x'.repeat(400)}`,
            });
        }

        const logs = manager.getLogs();
        const retainedBytes = logs.reduce(
            (total, entry) => total + manager._estimateEntryBytes(entry),
            0
        );

        expect(logs.length).toBeLessThan(40);
        expect(retainedBytes).toBeLessThanOrEqual(4096);
        expect(logs.at(-1).message).toContain('entry-39');
    });

    it('keeps the newest entry even when it alone exceeds the log budget', () => {
        const manager = new LogManager();
        manager._save = () => {};
        manager.MAX_LOG_BYTES = 128;

        manager.add({ level: 'ERROR', message: 'x'.repeat(4096) });

        expect(manager.getLogs()).toHaveLength(1);
    });
});
