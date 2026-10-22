import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DebugCaptureManager } from './debug_capture_manager.js';

function createChromeMock({ attachError = null, tabUrl = 'https://app.test/' } = {}) {
    let eventHandler = null;
    let detachHandler = null;
    let tabRemovedHandler = null;
    let evaluateResult = [];

    const sendCommand = vi.fn((_target, method, _params, callback) => {
        if (method === 'Runtime.evaluate') {
            callback({ result: { value: evaluateResult } });
            return;
        }
        if (method === 'Network.getCookies') {
            callback({
                cookies: [
                    {
                        name: 'sid',
                        value: 'cookie-secret',
                        domain: 'app.test',
                        path: '/',
                        expires: 123,
                    },
                ],
            });
            return;
        }
        if (method === 'Network.getResponseBody') {
            callback({ body: '{"ok":true}', base64Encoded: false });
            return;
        }
        callback({});
    });

    globalThis.chrome = {
        runtime: {
            lastError: null,
            sendMessage: vi.fn(() => Promise.resolve()),
        },
        storage: {
            session: {
                get: vi.fn(() => Promise.resolve({})),
                set: vi.fn(() => Promise.resolve()),
                remove: vi.fn(() => Promise.resolve()),
            },
        },
        tabs: {
            get: vi.fn((tabId) =>
                Promise.resolve({ id: tabId, url: tabUrl, windowId: 1, title: 'App' })
            ),
            onRemoved: {
                addListener: vi.fn((handler) => {
                    tabRemovedHandler = handler;
                }),
            },
        },
        debugger: {
            attach: vi.fn((_target, _version, callback) => {
                if (attachError) {
                    chrome.runtime.lastError = { message: attachError };
                    callback();
                    chrome.runtime.lastError = null;
                    return;
                }
                setTimeout(callback, 0);
            }),
            detach: vi.fn((_target, callback) => setTimeout(callback, 0)),
            sendCommand,
            onEvent: {
                addListener: vi.fn((handler) => {
                    eventHandler = handler;
                }),
            },
            onDetach: {
                addListener: vi.fn((handler) => {
                    detachHandler = handler;
                }),
            },
        },
    };

    return {
        sendCommand,
        setEvaluateResult: (value) => {
            evaluateResult = value;
        },
        emit: (source, method, params) => eventHandler(source, method, params),
        detach: (source, reason) => detachHandler(source, reason),
        removeTab: (tabId) => tabRemovedHandler(tabId),
    };
}

async function startManager(tabId = 7) {
    const manager = new DebugCaptureManager();
    const result = await manager.start(tabId);
    expect(result.status).toBe('started');
    return manager;
}

describe('DebugCaptureManager', () => {
    let mock;

    beforeEach(() => {
        mock = createChromeMock();
    });

    afterEach(() => {
        delete globalThis.chrome;
        vi.restoreAllMocks();
    });

    it('attaches and enables the required CDP domains', async () => {
        const manager = await startManager(7);

        expect(chrome.debugger.attach).toHaveBeenCalledWith(
            { tabId: 7 },
            '1.3',
            expect.any(Function)
        );
        expect(mock.sendCommand).toHaveBeenCalledWith(
            { tabId: 7 },
            'Runtime.enable',
            {},
            expect.any(Function)
        );
        expect(mock.sendCommand).toHaveBeenCalledWith(
            { tabId: 7 },
            'Log.enable',
            {},
            expect.any(Function)
        );
        expect(mock.sendCommand).toHaveBeenCalledWith(
            { tabId: 7 },
            'Network.enable',
            expect.objectContaining({ maxTotalBufferSize: expect.any(Number) }),
            expect.any(Function)
        );
        expect(mock.sendCommand).toHaveBeenCalledWith(
            { tabId: 7 },
            'Page.enable',
            {},
            expect.any(Function)
        );
        expect(manager.isActive(7)).toBe(true);
    });

    it('rejects restricted pages instead of attaching', async () => {
        mock = createChromeMock({ tabUrl: 'chrome://settings/' });
        const manager = new DebugCaptureManager();

        const result = await manager.start(7);

        expect(result.status).toBe('error');
        expect(result.error).toContain('cannot be debugged');
        expect(chrome.debugger.attach).not.toHaveBeenCalled();
    });

    it('surfaces attach errors', async () => {
        mock = createChromeMock({ attachError: 'Another debugger is already attached' });
        const manager = new DebugCaptureManager();

        const result = await manager.start(7);

        expect(result.status).toBe('error');
        expect(result.error).toContain('Another debugger');
    });

    it('captures console entries and filters by level', async () => {
        const manager = await startManager(7);

        mock.emit({ tabId: 7 }, 'Runtime.consoleAPICalled', {
            type: 'error',
            args: [{ value: 'boom' }],
            timestamp: 1700000000000,
            stackTrace: { callFrames: [{ url: 'https://app.test/a.js', lineNumber: 12 }] },
        });
        mock.emit({ tabId: 7 }, 'Runtime.consoleAPICalled', {
            type: 'log',
            args: [{ value: 'hello' }],
            timestamp: 1700000001000,
        });

        const all = await manager.execute('get_console_logs');
        expect(all).toContain('boom');
        expect(all).toContain('hello');
        expect(all).toContain('a.js:12');

        const errors = await manager.execute('get_console_logs', { level: 'error' });
        expect(errors).toContain('boom');
        expect(errors).not.toContain('hello');
    });

    it('captures uncaught exceptions as page errors', async () => {
        const manager = await startManager(7);

        mock.emit({ tabId: 7 }, 'Runtime.exceptionThrown', {
            timestamp: 1700000000000,
            exceptionDetails: {
                text: 'Uncaught',
                url: 'https://app.test/a.js',
                lineNumber: 3,
                exception: { description: 'TypeError: x is undefined' },
            },
        });

        const output = await manager.execute('get_page_errors');

        expect(output).toContain('TypeError: x is undefined');
        expect(output).toContain('a.js:3');
    });

    it('tracks network request lifecycle and filters failures', async () => {
        const manager = await startManager(7);

        mock.emit({ tabId: 7 }, 'Network.requestWillBeSent', {
            requestId: 'r1',
            request: {
                method: 'GET',
                url: 'https://api.test/items',
                headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
            },
            type: 'XHR',
            timestamp: 10,
            wallTime: 1700000000,
        });
        mock.emit({ tabId: 7 }, 'Network.responseReceived', {
            requestId: 'r1',
            response: {
                status: 500,
                statusText: 'Server Error',
                mimeType: 'application/json',
                headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'a=b' },
            },
            timestamp: 10.25,
        });

        const all = await manager.execute('get_network_requests');
        expect(all).toContain('GET https://api.test/items');
        expect(all).toContain('500 Server Error');
        expect(all).toContain('250ms');
        expect(all).toContain('requestId=r1');

        const failed = await manager.execute('get_network_requests', { failedOnly: true });
        expect(failed).toContain('No network requests matched');
    });

    it('marks failed requests and exposes request details with redacted headers', async () => {
        const manager = await startManager(7);

        mock.emit({ tabId: 7 }, 'Network.requestWillBeSent', {
            requestId: 'r2',
            request: {
                method: 'POST',
                url: 'https://api.test/login',
                headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
            },
            type: 'Fetch',
            timestamp: 10,
            wallTime: 1700000000,
        });
        mock.emit({ tabId: 7 }, 'Network.loadingFailed', {
            requestId: 'r2',
            errorText: 'net::ERR_FAILED',
            timestamp: 10.3,
        });

        const failed = await manager.execute('get_network_requests', { failedOnly: true });
        expect(failed).toContain('FAILED (net::ERR_FAILED)');

        const detail = await manager.execute('get_network_detail', { requestId: 'r2' });
        expect(detail).toContain('POST https://api.test/login');
        expect(detail).toContain('Content-Type: application/json');
        expect(detail).not.toContain('Bearer secret');
        expect(detail).toContain('body unavailable: the request failed');
    });

    it('caps console and network buffers', async () => {
        const manager = await startManager(7);

        for (let index = 0; index < 510; index++) {
            mock.emit({ tabId: 7 }, 'Runtime.consoleAPICalled', {
                type: 'log',
                args: [{ value: `entry-${index}` }],
                timestamp: 1700000000000 + index,
            });
        }
        expect(manager.session.consoleEntries).toHaveLength(500);
        expect(manager.session.consoleEntries[0].text).toBe('entry-10');

        for (let index = 0; index < 310; index++) {
            mock.emit({ tabId: 7 }, 'Network.requestWillBeSent', {
                requestId: `r${index}`,
                request: { method: 'GET', url: `https://api.test/${index}`, headers: {} },
                type: 'XHR',
                timestamp: 10 + index,
                wallTime: 1700000000 + index,
            });
        }
        expect(manager.session.networkEntries.size).toBe(300);
        expect(manager.session.networkEntries.has('r0')).toBe(false);
        expect(manager.session.networkEntries.has('r10')).toBe(true);
    });

    it('clears buffers when the main frame navigates', async () => {
        const manager = await startManager(7);

        mock.emit({ tabId: 7 }, 'Runtime.consoleAPICalled', {
            type: 'log',
            args: [{ value: 'before navigation' }],
            timestamp: 1700000000000,
        });
        mock.emit({ tabId: 7 }, 'Page.frameNavigated', { frame: { id: 'main' } });

        expect(manager.session.consoleEntries).toHaveLength(0);
    });

    it('reads localStorage with sensitive value redaction', async () => {
        const manager = await startManager(7);
        mock.setEvaluateResult([
            ['token', 'super-secret'],
            ['theme', 'dark'],
        ]);

        const output = await manager.execute('get_storage', { type: 'local' });

        expect(output).toContain('token: [redacted]');
        expect(output).toContain('theme: dark');
        expect(output).not.toContain('super-secret');
    });

    it('lists cookies without exposing values', async () => {
        const manager = await startManager(7);

        const output = await manager.execute('get_storage', { type: 'cookie' });

        expect(output).toContain('sid: <redacted>');
        expect(output).not.toContain('cookie-secret');
    });

    it('clears debug logs without detaching', async () => {
        const manager = await startManager(7);
        mock.emit({ tabId: 7 }, 'Runtime.consoleAPICalled', {
            type: 'log',
            args: [{ value: 'first' }],
            timestamp: 1700000000000,
        });

        await manager.execute('clear_debug_logs');

        expect(manager.session.consoleEntries).toHaveLength(0);
        expect(manager.isActive(7)).toBe(true);
    });

    it('filters entries captured before the last clear', async () => {
        const manager = await startManager(7);
        manager.session.consoleEntries.push({
            level: 'error',
            text: 'old error',
            url: '',
            lineNumber: null,
            timestamp: 1000,
            source: 'console',
            logSource: '',
        });
        manager.session.resetAt = 2000;

        expect(await manager.execute('get_console_logs', { level: 'error' })).toContain(
            'No console logs captured'
        );
        expect(await manager.execute('get_page_errors')).toContain('No uncaught exceptions');
    });

    it('stamps network requests with wall-clock time when wallTime is missing', async () => {
        const manager = await startManager(7);
        manager.session.resetAt = Date.now();

        mock.emit({ tabId: 7 }, 'Network.requestWillBeSent', {
            requestId: 'r-no-wall',
            request: { method: 'GET', url: 'https://api.test/no-wall-time', headers: {} },
            type: 'Fetch',
            timestamp: 12.5,
        });

        const entry = manager.session.networkEntries.get('r-no-wall');
        expect(entry.monotonicTimestamp).toBe(12.5);
        expect(entry.timestamp).toBeGreaterThanOrEqual(manager.session.resetAt);

        expect(await manager.execute('get_network_requests')).toContain('requestId=r-no-wall');
    });

    it('returns the body for a successful request', async () => {
        const manager = await startManager(7);
        mock.emit({ tabId: 7 }, 'Network.requestWillBeSent', {
            requestId: 'r3',
            request: { method: 'GET', url: 'https://api.test/ok', headers: {} },
            type: 'Fetch',
            timestamp: 10,
            wallTime: 1700000000,
        });
        mock.emit({ tabId: 7 }, 'Network.responseReceived', {
            requestId: 'r3',
            response: {
                status: 200,
                statusText: 'OK',
                mimeType: 'application/json',
                headers: { 'Content-Type': 'application/json' },
            },
            timestamp: 10.2,
        });

        const detail = await manager.execute('get_network_detail', { requestId: 'r3' });

        expect(detail).toContain('Status: 200');
        expect(detail).toContain('{"ok":true}');
    });

    it('detaches and clears state on stop', async () => {
        const manager = await startManager(7);

        await manager.stop();

        expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 7 }, expect.any(Function));
        expect(manager.isActive()).toBe(false);
        expect(manager.getActiveTabId()).toBeNull();
    });

    it('does not reset captured buffers when the same tab is enabled again', async () => {
        const manager = await startManager(7);
        mock.emit({ tabId: 7 }, 'Runtime.consoleAPICalled', {
            type: 'log',
            args: [{ value: 'keep me' }],
            timestamp: 1700000000000,
        });

        const result = await manager.start(7);

        expect(result.status).toBe('already');
        expect(manager.session.consoleEntries).toHaveLength(1);
        expect(manager.session.consoleEntries[0].text).toBe('keep me');
    });

    it('stops and migrates capture when a different tab is enabled', async () => {
        const manager = await startManager(7);
        mock.emit({ tabId: 7 }, 'Runtime.consoleAPICalled', {
            type: 'log',
            args: [{ value: 'old tab' }],
            timestamp: 1700000000000,
        });

        const result = await manager.start(8);

        expect(result.status).toBe('started');
        expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 7 }, expect.any(Function));
        expect(manager.getActiveTabId()).toBe(8);
        expect(manager.session.consoleEntries).toHaveLength(0);
    });

    it('returns a clear error when tools are used without an active session', async () => {
        const manager = new DebugCaptureManager();

        const output = await manager.execute('get_console_logs');

        expect(output).toContain('Debug tools are not enabled');
    });

    it('persists the active tab id and clears it on stop', async () => {
        const manager = await startManager(7);

        expect(chrome.storage.session.set).toHaveBeenCalledWith({ geminiDebugTabId: 7 });

        await manager.stop();

        expect(chrome.storage.session.remove).toHaveBeenCalledWith('geminiDebugTabId');
    });

    it('detaches a persisted session after the worker restarted', async () => {
        chrome.storage.session.get.mockResolvedValue({ geminiDebugTabId: 42 });
        const manager = new DebugCaptureManager();

        await manager.stop(7);

        expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
    });

    it('times out a debugger command that never calls back', async () => {
        const manager = await startManager(7);
        chrome.debugger.sendCommand.mockImplementation(() => {});

        await expect(
            manager.sendCommand('Network.getResponseBody', {}, { timeoutMs: 10 })
        ).rejects.toThrow('timed out');
    });

    it('enables the debugger domain for source inspection', async () => {
        await startManager(7);

        expect(mock.sendCommand).toHaveBeenCalledWith(
            { tabId: 7 },
            'Debugger.enable',
            {},
            expect.any(Function)
        );
    });

    it('returns page info and detected frameworks', async () => {
        const manager = await startManager(7);
        mock.sendCommand.mockImplementation((_target, method, _params, callback) => {
            if (method === 'Runtime.evaluate') {
                callback({
                    result: {
                        value: {
                            url: 'https://app.test/',
                            title: 'App',
                            readyState: 'complete',
                            viewport: { width: 800, height: 600, devicePixelRatio: 1 },
                            frameworks: ['React'],
                        },
                    },
                });
                return;
            }
            callback({});
        });

        const output = await manager.execute('get_page_info');

        expect(output).toContain('https://app.test/');
        expect(output).toContain('React');
    });

    it('reads DOM HTML for a selector', async () => {
        const manager = await startManager(7);
        mock.sendCommand.mockImplementation((_target, method, _params, callback) => {
            if (method === 'Runtime.evaluate') {
                callback({ result: { value: '<div id="app">Hi</div>' } });
                return;
            }
            callback({});
        });

        const output = await manager.execute('get_dom_html', { selector: '#app' });

        expect(output).toContain('<div id="app">Hi</div>');
    });

    it('reports a missing DOM selector', async () => {
        const manager = await startManager(7);
        mock.sendCommand.mockImplementation((_target, method, _params, callback) => {
            if (method === 'Runtime.evaluate') {
                callback({ result: { value: null } });
                return;
            }
            callback({});
        });

        const output = await manager.execute('get_dom_html', { selector: '#missing' });

        expect(output).toContain('No element matches');
    });

    it('reads computed element styles', async () => {
        const manager = await startManager(7);
        mock.sendCommand.mockImplementation((_target, method, _params, callback) => {
            if (method === 'Runtime.evaluate') {
                callback({ result: { value: { display: 'flex', color: 'rgb(0, 0, 0)' } } });
                return;
            }
            callback({});
        });

        const output = await manager.execute('get_element_styles', {
            selector: '.card',
            properties: ['display'],
        });

        expect(output).toContain('display');
        expect(output).toContain('flex');
    });

    it('lists script metadata and reads script sources', async () => {
        const manager = await startManager(7);
        mock.emit({ tabId: 7 }, 'Debugger.scriptParsed', {
            scriptId: '42',
            url: 'https://app.test/main.js',
            startLine: 0,
            endLine: 100,
            length: 4096,
            isModule: true,
        });

        const list = await manager.execute('get_script_sources');
        expect(list).toContain('scriptId=42');
        expect(list).toContain('https://app.test/main.js');

        mock.sendCommand.mockImplementation((_target, method, _params, callback) => {
            if (method === 'Debugger.getScriptSource') {
                callback({ scriptSource: 'console.log(1)' });
                return;
            }
            callback({});
        });
        const source = await manager.execute('get_script_sources', { scriptId: '42' });

        expect(source).toContain('console.log(1)');
    });

    it('clears script metadata on navigation', async () => {
        const manager = await startManager(7);
        mock.emit({ tabId: 7 }, 'Debugger.scriptParsed', {
            scriptId: '42',
            url: 'https://app.test/main.js',
        });
        mock.emit({ tabId: 7 }, 'Page.frameNavigated', { frame: { id: 'main' } });

        const list = await manager.execute('get_script_sources');

        expect(list).toContain('No external scripts parsed');
    });

    it('evaluates a script expression', async () => {
        const manager = await startManager(7);
        mock.sendCommand.mockImplementation((_target, method, _params, callback) => {
            if (method === 'Runtime.evaluate') {
                callback({ result: { value: { ok: true } } });
                return;
            }
            callback({});
        });

        const output = await manager.execute('evaluate_script', { script: 'window.__STATE__' });

        expect(output).toContain('"ok": true');
    });

    it('allows long-running async scripts in evaluate_script', async () => {
        const manager = await startManager(7);
        const sendCommand = vi
            .spyOn(manager, 'sendCommand')
            .mockResolvedValue({ result: { value: 'ok' } });

        await manager.execute('evaluate_script', {
            script: 'await new Promise((resolve) => setTimeout(resolve, 5000))',
        });

        expect(sendCommand).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({ awaitPromise: true }),
            { timeoutMs: 30000 }
        );
    });
});
