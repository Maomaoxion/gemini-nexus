// Forwards log entries to the native logger host via chrome.runtime.connectNative.
// Lazy-connects on first send (or immediately via connect()), drops the port on
// disconnect, reconnects on the next send, and buffers a small backlog while
// disconnected so service-worker restarts and host hiccups don't drop entries.
//
// Bidirectional bridge: host can post {type:'request', id, method, params} on the
// same port; we dispatch registered handlers and reply with
// {type:'response', id, ok, result|error}. Never throws — logging / bridge must
// never break the caller.

const DEFAULT_HOST_NAME = 'com.gemini_nexus.logger';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const BUFFER_LIMIT = 200;

export class NativeLoggerSink {
    constructor({
        runtime,
        hostName = DEFAULT_HOST_NAME,
        minLevel = 'info',
        enabled = false,
        getVersion = null,
    } = {}) {
        this.runtime = runtime ?? (typeof chrome !== 'undefined' ? chrome.runtime : undefined);
        this.hostName = hostName;
        this.minLevel = LEVELS[minLevel] ?? LEVELS.info;
        this.enabled = !!enabled;
        this._port = null;
        this._buffer = [];
        this._handlers = new Map();
        this._getVersion =
            getVersion ||
            (() => {
                try {
                    return this.runtime?.getManifest?.()?.version ?? null;
                } catch {
                    return null;
                }
            });
        this._helloSent = false;
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (!this.enabled) {
            this._disconnect();
            return;
        }
        // Keep the native host (and its HTTP bridge) alive while enabled.
        this.connect();
    }

    setMinLevel(level) {
        if (LEVELS[level] != null) this.minLevel = LEVELS[level];
    }

    /**
     * Register an RPC handler invoked when the local HTTP bridge posts
     * {type:'request', method, params}. Handler may be sync or async and should
     * return a JSON-serializable result.
     */
    setRequestHandler(method, handler) {
        if (typeof method !== 'string' || !method) return;
        if (typeof handler !== 'function') {
            this._handlers.delete(method);
            return;
        }
        this._handlers.set(method, handler);
    }

    /** Eagerly open the native port (starts the host HTTP bridge). Safe to call often. */
    connect() {
        if (!this.enabled) return null;
        return this._getPort();
    }

    log(entry) {
        if (!this.enabled) return;
        if (!entry || !this._passesLevel(entry)) return;
        this._send(entry);
    }

    _passesLevel(entry) {
        const lvl = LEVELS[String(entry.level).toLowerCase()] ?? LEVELS.info;
        return lvl >= this.minLevel;
    }

    _serialize(entry) {
        const data = this._safeData(entry.data);
        return {
            timestamp: entry.timestamp ?? Date.now(),
            level: entry.level || 'INFO',
            context: entry.context || 'System',
            message: entry.message ?? '',
            ...(data !== undefined ? { data } : {}),
        };
    }

    // Coerce data into something chrome.runtime Port.postMessage can structure-clone:
    // drop functions/symbols, and fall back to a placeholder for circular/BigInt values
    // (JSON.stringify throws on those) so a bad entry never throws or sticks in the buffer.
    _safeData(data) {
        if (data == null) return undefined;
        try {
            return JSON.parse(
                JSON.stringify(data, (_key, value) => {
                    if (typeof value === 'function') return '[Function]';
                    if (typeof value === 'symbol') return '[Symbol]';
                    return value;
                })
            );
        } catch {
            return { _unserializable: true };
        }
    }

    _send(entry) {
        if (!this.runtime?.connectNative) return;
        const port = this._getPort();
        if (!port) {
            this._pushBuffer(entry);
            return;
        }
        try {
            port.postMessage(this._serialize(entry));
        } catch {
            this._port = null;
            this._helloSent = false;
            this._pushBuffer(entry);
        }
    }

    _getPort() {
        if (this._port) return this._port;
        if (!this.runtime?.connectNative) return null;
        try {
            const port = this.runtime.connectNative(this.hostName);
            port.onDisconnect?.addListener(() => {
                // Read lastError / port.error so Chrome marks it as checked and
                // does not report "Unchecked runtime.lastError" on missing native host.
                void (this.runtime?.lastError || port.error);
                this._port = null;
                this._helloSent = false;
            });
            port.onMessage?.addListener((msg) => {
                this._onHostMessage(msg);
            });
            this._port = port;
            this._sendHello();
            this._flushBuffer();
            return port;
        } catch {
            this._port = null;
            this._helloSent = false;
            return null;
        }
    }

    _sendHello() {
        if (!this._port || this._helloSent) return;
        try {
            this._port.postMessage({
                type: 'hello',
                version: this._getVersion(),
                timestamp: Date.now(),
            });
            this._helloSent = true;
        } catch {
            // ignore — next send will reconnect
        }
    }

    async _onHostMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type !== 'request' || !msg.id || !msg.method) return;
        const handler = this._handlers.get(msg.method);
        try {
            if (!handler) {
                this._reply(msg.id, false, null, `unknown method: ${msg.method}`);
                return;
            }
            const result = await handler(msg.params || {});
            this._reply(msg.id, true, result, null);
        } catch (error) {
            this._reply(msg.id, false, null, error?.message || String(error));
        }
    }

    _reply(id, ok, result, error) {
        if (!this._port) return;
        try {
            const payload = ok
                ? { type: 'response', id, ok: true, result }
                : { type: 'response', id, ok: false, error: error || 'error' };
            this._port.postMessage(payload);
        } catch {
            this._port = null;
            this._helloSent = false;
        }
    }

    _disconnect() {
        try {
            this._port?.disconnect();
        } catch {
            // ignore
        }
        this._port = null;
        this._helloSent = false;
        this._buffer = [];
    }

    _pushBuffer(entry) {
        this._buffer.push(entry);
        if (this._buffer.length > BUFFER_LIMIT) this._buffer.shift();
    }

    _flushBuffer() {
        if (!this._port || this._buffer.length === 0) return;
        const pending = this._buffer.splice(0);
        for (let i = 0; i < pending.length; i++) {
            try {
                this._port.postMessage(this._serialize(pending[i]));
            } catch {
                // Re-queue the failing entry AND everything after it, in order,
                // so a single bad entry doesn't drop the tail of the backlog.
                this._buffer.unshift(...pending.slice(i));
                break;
            }
        }
    }
}
