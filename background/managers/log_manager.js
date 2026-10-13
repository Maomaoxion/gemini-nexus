export class LogManager {
    constructor(sinks = []) {
        this.logs = [];
        // 5000 stringified console entries can occupy a large slice of MV3's
        // 10MB local-storage quota; 1000 is enough for debugging without
        // crowding out session history.
        this.MAX_LOGS = 1000;
        // Entry count alone does not bound the payload: a handful of long
        // error dumps can still fill the storage area that session history
        // shares. Cap the retained log text as well.
        this.MAX_LOG_BYTES = 256 * 1024;
        this.STORAGE_KEY = 'gemini_nexus_logs';
        this.sinks = Array.isArray(sinks) ? sinks : [];
        this._inAdd = false;
        this._saveTimer = null;
        this._approximateBytes = 0;
        this.init();
    }

    async init() {
        try {
            const result = await chrome.storage.local.get(this.STORAGE_KEY);
            if (result[this.STORAGE_KEY]) {
                this.logs = result[this.STORAGE_KEY];
                this._approximateBytes = this.logs.reduce(
                    (total, entry) => total + this._estimateEntryBytes(entry),
                    0
                );
            }
            // Avoid adding 'initialized' log here to prevent noise on every wake-up if not needed
        } catch (error) {
            console.error('Failed to load logs', error);
        }
    }

    add(entry) {
        // Re-entry guard: a sink must never be allowed to call add() again
        // (e.g. via console.* during native send) — that would recurse and blow the stack.
        if (this._inAdd) return;
        this._inAdd = true;
        try {
            if (!entry.timestamp) entry.timestamp = Date.now();

            this.logs.push(entry);
            this._approximateBytes += this._estimateEntryBytes(entry);

            // Prune while either budget (entry count / retained text bytes) is exceeded
            while (
                this.logs.length > this.MAX_LOGS ||
                (this._approximateBytes > this.MAX_LOG_BYTES && this.logs.length > 1)
            ) {
                const removed = this.logs.shift();
                this._approximateBytes -= this._estimateEntryBytes(removed);
            }
            if (this._approximateBytes < 0) this._approximateBytes = 0;

            this._save();

            for (const sink of this.sinks) {
                try {
                    sink.log(entry);
                } catch {
                    // a sink must never break logging
                }
            }
        } finally {
            this._inAdd = false;
        }
    }

    _estimateEntryBytes(entry) {
        if (!entry || typeof entry !== 'object') return 0;
        const message = typeof entry.message === 'string' ? entry.message : '';
        const context = typeof entry.context === 'string' ? entry.context : '';
        const level = typeof entry.level === 'string' ? entry.level : '';
        // Fixed field overhead (timestamps, JSON punctuation) plus the text payload.
        return message.length + context.length + level.length + 80;
    }

    _save() {
        // Debounce: console interception (setupConsoleInterception) can call
        // add() many times per second, and each call would rewrite the entire
        // log array. Coalesce a burst into one storage write so logging does
        // not dominate the local-storage quota.
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            chrome.storage.local.set({ [this.STORAGE_KEY]: this.logs }).catch(() => {});
        }, 1000);
    }

    getLogs() {
        return this.logs;
    }

    clear() {
        this.logs = [];
        this._approximateBytes = 0;
        this._save();
        this.add({
            level: 'INFO',
            context: 'Background',
            message: 'Logs cleared',
            timestamp: Date.now(),
        });
    }
}

// --- Console Interception Helper ---

function safeStringify(valueToStringify) {
    const cache = new Set();
    return JSON.stringify(valueToStringify, (key, value) => {
        if (isSensitiveKey(key)) return '[REDACTED]';
        if (typeof value === 'object' && value !== null) {
            if (cache.has(value)) return '[Circular]';
            cache.add(value);
        }
        return typeof value === 'string' ? redactSecrets(value) : value;
    });
}

function isSensitiveKey(key) {
    return /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|password)$/i.test(
        String(key || '')
    );
}

function redactSecrets(text) {
    return String(text || '')
        .replace(/\b(Bearer\s+)[^\s,"']+/gi, '$1[REDACTED]')
        .replace(
            /([?&](?:key|api_key|access_token|refresh_token|token|secret|password)=)[^&#\s]+/gi,
            '$1[REDACTED]'
        )
        .replace(
            /\b((?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|authorization|cookie|secret|password)\s*[:=]\s*)[^\s,"'{}]+/gi,
            '$1[REDACTED]'
        );
}

function formatConsoleArgs(args) {
    return args
        .map((arg) => {
            if (arg instanceof Error) {
                return `[Error: ${arg.message}]\n${arg.stack}`;
            }
            if (typeof arg === 'object') {
                try {
                    return safeStringify(arg);
                } catch {
                    return '[Object]';
                }
            }
            return redactSecrets(arg);
        })
        .join(' ');
}

export function setupConsoleInterception(logManager) {
    const originalConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
    };

    ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
        console[level] = (...args) => {
            originalConsole[level](...args); // Keep original behavior in DevTools

            // Map console level to LogManager level
            let mgrLevel = 'INFO';
            if (level === 'warn') mgrLevel = 'WARN';
            if (level === 'error') mgrLevel = 'ERROR';
            if (level === 'debug') mgrLevel = 'DEBUG';

            // Filter out overly verbose logs if needed, but for now capture everything
            logManager.add({
                level: mgrLevel,
                context: 'System',
                message: formatConsoleArgs(args),
                timestamp: Date.now(),
            });
        };
    });
}
