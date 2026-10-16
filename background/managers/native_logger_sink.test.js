import { describe, expect, it, vi } from 'vitest';
import { NativeLoggerSink } from './native_logger_sink.js';

function makeMockRuntime({ connectThrows = false, version = '5.0.18' } = {}) {
    const listeners = { disconnect: null, message: null };
    const port = {
        postMessage: vi.fn(),
        disconnect: vi.fn(() => listeners.disconnect?.()),
        onDisconnect: { addListener: (fn) => (listeners.disconnect = fn) },
        onMessage: { addListener: (fn) => (listeners.message = fn) },
    };
    const connectNative = vi.fn(() => {
        if (connectThrows) throw new Error('no host');
        return port;
    });
    return {
        runtime: {
            connectNative,
            getManifest: () => ({ version }),
        },
        port,
        listeners,
    };
}

describe('NativeLoggerSink', () => {
    it('does nothing when disabled', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: false });
        sink.log({ level: 'info', message: 'x' });
        expect(runtime.connectNative).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('connects lazily and posts when enabled', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', context: 'C', message: 'hi' });
        expect(runtime.connectNative).toHaveBeenCalledWith('com.gemini_nexus.logger');
        // hello + log entry
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        const hello = port.postMessage.mock.calls[0][0];
        expect(hello.type).toBe('hello');
        expect(hello.version).toBe('5.0.18');
        const sent = port.postMessage.mock.calls[1][0];
        expect(sent.message).toBe('hi');
        expect(sent.context).toBe('C');
        expect(typeof sent.timestamp).toBe('number');
    });

    it('reuses a single port across entries', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'a' });
        sink.log({ level: 'info', message: 'b' });
        expect(runtime.connectNative).toHaveBeenCalledTimes(1);
        // hello + a + b
        expect(port.postMessage).toHaveBeenCalledTimes(3);
    });

    it('connect() eagerly opens the port and sends hello', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.connect();
        expect(runtime.connectNative).toHaveBeenCalledTimes(1);
        expect(port.postMessage.mock.calls[0][0].type).toBe('hello');
    });

    it('setEnabled(true) connects immediately so the HTTP bridge stays up', () => {
        const { runtime } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: false });
        sink.setEnabled(true);
        expect(runtime.connectNative).toHaveBeenCalledTimes(1);
    });

    it('handles host RPC request and replies with response', async () => {
        const { runtime, port, listeners } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.setRequestHandler('ping', async () => ({ pong: true }));
        sink.connect();
        await listeners.message({ type: 'request', id: 'r1', method: 'ping', params: {} });
        // wait microtasks for async handler
        await Promise.resolve();
        await Promise.resolve();
        const replies = port.postMessage.mock.calls
            .map((c) => c[0])
            .filter((m) => m.type === 'response');
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({ id: 'r1', ok: true, result: { pong: true } });
    });

    it('replies unknown method with ok:false', async () => {
        const { runtime, port, listeners } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.connect();
        await listeners.message({ type: 'request', id: 'r2', method: 'nope' });
        await Promise.resolve();
        await Promise.resolve();
        const replies = port.postMessage.mock.calls
            .map((c) => c[0])
            .filter((m) => m.type === 'response');
        expect(replies[0]).toMatchObject({ id: 'r2', ok: false });
        expect(replies[0].error).toMatch(/unknown method/);
    });

    it('filters below minLevel', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true, minLevel: 'warn' });
        sink.log({ level: 'debug', message: 'skip' });
        sink.log({ level: 'info', message: 'skip' });
        sink.log({ level: 'warn', message: 'keep' });
        // hello + warn log
        const logs = port.postMessage.mock.calls.map((c) => c[0]).filter((m) => m.level);
        expect(logs).toHaveLength(1);
        expect(logs[0].level).toBe('warn');
    });

    it('buffers while disconnected and flushes on reconnect', () => {
        const listeners = { disconnect: null };
        let connectFails = true;
        const port = {
            postMessage: vi.fn(),
            disconnect: vi.fn(),
            onDisconnect: { addListener: (fn) => (listeners.disconnect = fn) },
            onMessage: { addListener: () => {} },
        };
        const runtime = {
            connectNative: vi.fn(() => {
                if (connectFails) throw new Error('down');
                return port;
            }),
            getManifest: () => ({ version: '5.0.18' }),
        };
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'queued' }); // connect fails → buffered
        expect(port.postMessage).not.toHaveBeenCalled();

        connectFails = false;
        sink.log({ level: 'info', message: 'live' }); // connects → hello + flush buffered + this
        const msgs = port.postMessage.mock.calls
            .map((c) => c[0])
            .filter((m) => m.message != null)
            .map((m) => m.message);
        expect(msgs).toEqual(['queued', 'live']);
    });

    it('drops internal port on disconnect, reconnects next log', () => {
        const { runtime, port, listeners } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'one' });
        listeners.disconnect(); // simulate host disconnect
        sink.log({ level: 'info', message: 'two' });
        expect(runtime.connectNative).toHaveBeenCalledTimes(2);
        // each connect: hello + log
        const logMsgs = port.postMessage.mock.calls
            .map((c) => c[0])
            .filter((m) => m.message != null)
            .map((m) => m.message);
        expect(logMsgs).toEqual(['one', 'two']);
    });

    it('setEnabled(false) disconnects and stops sending', () => {
        const { runtime, port } = makeMockRuntime();
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'x' });
        const callsBeforeDisable = port.postMessage.mock.calls.length;
        sink.setEnabled(false);
        expect(port.disconnect).toHaveBeenCalled();
        sink.log({ level: 'info', message: 'y' });
        expect(port.postMessage).toHaveBeenCalledTimes(callsBeforeDisable); // no more after disable
    });

    it('_serialize cleans circular/unclonable data so postMessage never throws', () => {
        const sink = new NativeLoggerSink({ runtime: { connectNative: () => {} }, enabled: true });
        const circular = { a: 1 };
        circular.self = circular;
        const fn = () => {};
        const serialized = sink._serialize({ level: 'info', message: 'm', data: { circular, fn } });
        // 模拟 postMessage 的结构化克隆:能 JSON round-trip 即可克隆
        expect(() => JSON.parse(JSON.stringify(serialized))).not.toThrow();
        expect(serialized.message).toBe('m');
    });

    it('flush re-queues the failing entry AND all later entries (none lost, order kept)', () => {
        let connectOk = false;
        const goodPort = {
            postMessage: vi.fn((e) => {
                if (e.message === 'fail') throw new Error('clone err');
            }),
            disconnect: vi.fn(),
            onDisconnect: { addListener: () => {} },
            onMessage: { addListener: () => {} },
        };
        const runtime = {
            connectNative: vi.fn(() => {
                if (!connectOk) throw new Error('down');
                return goodPort;
            }),
        };
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.log({ level: 'info', message: 'a' }); // buffer (connect down)
        sink.log({ level: 'info', message: 'fail' }); // buffer
        sink.log({ level: 'info', message: 'b' }); // buffer
        connectOk = true;
        sink.log({ level: 'info', message: 'c' }); // connect ok → flush then send c

        // first message may be hello; filter log messages only
        const sent = goodPort.postMessage.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.message != null && m.type !== 'hello')
            .map((m) => m.message);
        expect(sent).toEqual(['a', 'fail', 'c']); // a flushed ok; fail attempted but threw; c sent via _send
        expect(sent).not.toContain('b'); // b never attempted — re-queued after the failing entry
        expect(sink._buffer.map((e) => e.message)).toEqual(['fail', 'b']); // both re-queued in order
    });

    it('handles port onDisconnect and consumes runtime.lastError without uncaught errors', () => {
        const { runtime, port, listeners } = makeMockRuntime();
        let lastErrorRead = false;
        Object.defineProperty(runtime, 'lastError', {
            get() {
                lastErrorRead = true;
                return { message: 'Specified native messaging host not found.' };
            },
        });
        const sink = new NativeLoggerSink({ runtime, enabled: true });
        sink.connect();
        expect(sink._port).toBe(port);

        // Simulate host disconnect
        listeners.disconnect(port);
        expect(lastErrorRead).toBe(true);
        expect(sink._port).toBeNull();
    });
});
