import { debugLog } from '../../shared/logging/debug.js';
import { getTabControlAvailability, getTabUrl } from '../control/tabs.js';
import { isDebugTool } from './debug_tools.js';

const MAX_CONSOLE_ENTRIES = 500;
const MAX_NETWORK_ENTRIES = 300;
const MAX_TEXT_LENGTH = 2000;
const MAX_VALUE_LENGTH = 200;
const MAX_TOOL_OUTPUT_LENGTH = 20000;
const MAX_NETWORK_BODY_LENGTH = 20000;
const MAX_STORAGE_ITEMS = 100;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEBUG_COMMAND_TIMEOUT_MS = 5000;
const DEBUG_EVALUATE_TIMEOUT_MS = 30000;
const DEBUG_TAB_STORAGE_KEY = 'geminiDebugTabId';

const SENSITIVE_KEY_PATTERN =
    /(token|password|passwd|secret|authorization|auth|cookie|session|api[_-]?key)/i;
const SENSITIVE_HEADER_PATTERN = /(cookie|authorization|auth|token|secret|session|set-cookie)/i;
const ALLOWED_HEADERS = new Set([
    'content-type',
    'content-length',
    'cache-control',
    'location',
    'etag',
    'last-modified',
]);

function truncate(text, maxLength = MAX_TEXT_LENGTH) {
    const value = typeof text === 'string' ? text : String(text ?? '');
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function normalizeLimit(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(number), MAX_LIMIT);
}

function formatTimestamp(timestamp) {
    if (!Number.isFinite(timestamp)) return '--:--:--';
    const date = new Date(timestamp);
    return date.toTimeString().slice(0, 8);
}

function formatRemoteObject(arg) {
    if (arg == null) return String(arg);
    if (typeof arg !== 'object') return String(arg);
    if (Object.prototype.hasOwnProperty.call(arg, 'value')) {
        return typeof arg.value === 'object' ? JSON.stringify(arg.value) : String(arg.value);
    }
    if (arg.unserializableValue) return String(arg.unserializableValue);
    if (arg.description) return String(arg.description);
    return arg.type || '';
}

function formatRemoteObjects(args) {
    return (Array.isArray(args) ? args : []).map(formatRemoteObject).join(' ');
}

function shouldRedactKey(key) {
    return SENSITIVE_KEY_PATTERN.test(String(key || ''));
}

function sanitizeHeaders(headers) {
    if (!headers || typeof headers !== 'object') return {};
    const result = {};
    for (const [key, value] of Object.entries(headers)) {
        const lower = String(key).toLowerCase();
        if (!ALLOWED_HEADERS.has(lower) || SENSITIVE_HEADER_PATTERN.test(lower)) continue;
        result[key] = truncate(value);
    }
    return result;
}

function formatHeaders(headers) {
    const entries = Object.entries(headers || {});
    if (entries.length === 0) return '';
    return entries.map(([key, value]) => `  ${key}: ${value}`).join('\n');
}

function sanitizeStorageEntry(key, value) {
    if (shouldRedactKey(key)) return '[redacted]';
    return truncate(value, MAX_VALUE_LENGTH);
}

export class DebugCaptureManager {
    constructor() {
        this.session = null;
        this.lastAttachError = '';
        this.persistedTabId = null;

        chrome.debugger.onEvent.addListener(this.handleEvent.bind(this));
        chrome.debugger.onDetach.addListener(this.handleDetach.bind(this));
        chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
        this.readPersistedTabId().then((tabId) => {
            if (Number.isInteger(tabId) && tabId > 0 && !this.session) {
                this.persistedTabId = tabId;
            }
        });
    }

    /**
     * @param {number|null} tabId restrict the check to one tab; null checks any tab
     * @returns {boolean}
     */
    isActive(tabId = null) {
        if (!this.session?.attached) return false;
        if (tabId == null) return true;
        return this.session.tabId === tabId;
    }

    /**
     * @returns {number|null}
     */
    getActiveTabId() {
        return this.session?.attached ? this.session.tabId : null;
    }

    /**
     * Attaches the debugger to a tab and starts Console/Network capture.
     * @param {unknown} tabId
     * @returns {Promise<{ status: 'started'|'already'|'error', error?: string }>}
     */
    async start(tabId) {
        const normalizedTabId = Number(tabId);
        if (!Number.isInteger(normalizedTabId) || normalizedTabId <= 0) {
            return { status: 'error', error: 'No active browser tab to debug.' };
        }

        let tab;
        try {
            tab = await chrome.tabs.get(normalizedTabId);
        } catch {
            return { status: 'error', error: 'The tab is no longer available.' };
        }

        if (!getTabControlAvailability(tab).controllable) {
            return {
                status: 'error',
                error: `This page cannot be debugged (${getTabUrl(tab) || 'unknown URL'}).`,
            };
        }

        if (this.session?.attached && this.session.tabId === normalizedTabId) {
            // Duplicate enable messages (title updates, repeated context posts)
            // must not wipe the buffers the user is inspecting.
            return { status: 'already' };
        }

        if (this.session) {
            await this.stop();
        }

        const attached = await this.attach(normalizedTabId);
        if (!attached) {
            return {
                status: 'error',
                error: this.lastAttachError || 'Chrome refused the debugger attachment.',
            };
        }

        this.session = {
            tabId: normalizedTabId,
            tabUrl: getTabUrl(tab),
            attached: true,
            startedAt: Date.now(),
            resetAt: 0,
            consoleEntries: [],
            networkEntries: new Map(),
            scripts: new Map(),
        };

        try {
            await this.sendCommand('Runtime.enable');
            await this.sendCommand('Log.enable');
            await this.sendCommand('Network.enable', {
                maxTotalBufferSize: 20 * 1024 * 1024,
                maxResourceBufferSize: 5 * 1024 * 1024,
            });
            await this.sendCommand('Page.enable');
        } catch (error) {
            await this.stop();
            return { status: 'error', error: error?.message || String(error) };
        }

        try {
            await this.sendCommand('Debugger.enable');
        } catch (error) {
            // Source inspection is optional; the capture itself still works.
            debugLog('[DebugCaptureManager] Debugger.enable failed:', error);
        }

        console.info('[Gemini Nexus] Debug tools started', { tabId: normalizedTabId });
        this.persistTabId(normalizedTabId);
        return { status: 'started' };
    }

    /**
     * Detaches the debugger and clears the captured buffers. Falls back to the
     * tab id persisted in session storage when the in-memory session is gone.
     * @param {unknown} tabId
     * @returns {Promise<void>}
     */
    async stop(tabId = null) {
        const sessionTabId = this.session?.tabId ?? null;
        const persistedTabId = this.persistedTabId ?? (await this.readPersistedTabId());
        const fallbackTabId =
            Number.isInteger(Number(tabId)) && Number(tabId) > 0 ? Number(tabId) : null;
        const targetTabId = sessionTabId ?? persistedTabId ?? fallbackTabId;

        this.session = null;
        this.clearPersistedTabId();
        if (!targetTabId) return;

        await this.detachTab(targetTabId);
        console.info('[Gemini Nexus] Debug tools stopped', { tabId: targetTabId });
    }

    async detachTab(tabId) {
        await new Promise((resolve) => {
            chrome.debugger.detach({ tabId }, () => {
                if (chrome.runtime.lastError) {
                    console.warn(
                        '[Gemini Nexus] Debugger detach failed:',
                        chrome.runtime.lastError.message
                    );
                }
                resolve();
            });
        });
    }

    async readPersistedTabId() {
        try {
            const stored = await chrome.storage?.session?.get?.(DEBUG_TAB_STORAGE_KEY);
            const tabId = stored?.[DEBUG_TAB_STORAGE_KEY];
            return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
        } catch {
            return null;
        }
    }

    persistTabId(tabId) {
        this.persistedTabId = tabId;
        try {
            chrome.storage?.session?.set?.({ [DEBUG_TAB_STORAGE_KEY]: tabId })?.catch?.(() => {});
        } catch {
            // Storage is unavailable in some test/embedding contexts.
        }
    }

    clearPersistedTabId() {
        this.persistedTabId = null;
        try {
            chrome.storage?.session?.remove?.(DEBUG_TAB_STORAGE_KEY)?.catch?.(() => {});
        } catch {
            // Storage is unavailable in some test/embedding contexts.
        }
    }

    attach(tabId) {
        return new Promise((resolve) => {
            chrome.debugger.attach({ tabId }, '1.3', () => {
                if (chrome.runtime.lastError) {
                    this.lastAttachError = chrome.runtime.lastError.message || '';
                    resolve(false);
                    return;
                }
                this.lastAttachError = '';
                resolve(true);
            });
        });
    }

    /**
     * Sends a CDP command to the active debug session with a timeout guard.
     * @param {string} method
     * @param {object} params
     * @param {{ timeoutMs?: number }} options
     * @returns {Promise<unknown>}
     */
    sendCommand(method, params = {}, { timeoutMs = DEBUG_COMMAND_TIMEOUT_MS } = {}) {
        if (!this.session?.attached) {
            return Promise.reject(new Error('No active debug session.'));
        }

        const tabId = this.session.tabId;
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error(`Debugger command timed out: ${method}`));
            }, timeoutMs);

            chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (chrome.runtime.lastError) {
                    reject(
                        new Error(chrome.runtime.lastError.message || 'Debugger command failed.')
                    );
                    return;
                }
                resolve(result);
            });
        });
    }

    handleDetach(source, reason) {
        const matchesSession = this.session && source?.tabId === this.session.tabId;
        const matchesPersisted = !this.session && source?.tabId === this.persistedTabId;
        if (!matchesSession && !matchesPersisted) return;

        debugLog('[DebugCaptureManager] Debugger detached:', reason);
        const tabId = source.tabId;
        this.session = null;
        this.clearPersistedTabId();
        chrome.runtime.sendMessage({ action: 'DEBUG_TOOLS_STOPPED', tabId }).catch(() => {});
    }

    handleTabRemoved(tabId) {
        if (this.session?.tabId === tabId || this.persistedTabId === tabId) {
            this.session = null;
            this.clearPersistedTabId();
        }
    }

    handleEvent(source, method, params = {}) {
        const session = this.session;
        if (!session?.attached || source?.tabId !== session.tabId) return;

        try {
            if (method === 'Runtime.consoleAPICalled') {
                this.recordConsoleEntry({
                    level: params.type || 'log',
                    text: formatRemoteObjects(params.args),
                    url: params.stackTrace?.callFrames?.[0]?.url || '',
                    lineNumber: params.stackTrace?.callFrames?.[0]?.lineNumber,
                    timestamp: params.timestamp,
                });
                return;
            }

            if (method === 'Runtime.exceptionThrown') {
                const details = params.exceptionDetails || {};
                this.recordConsoleEntry({
                    level: 'error',
                    text: details.exception?.description || details.text || 'Uncaught exception',
                    url: details.url || '',
                    lineNumber: details.lineNumber,
                    timestamp: params.timestamp,
                    source: 'exception',
                });
                return;
            }

            if (method === 'Log.entryAdded') {
                const entry = params.entry || {};
                const level =
                    entry.level === 'warning'
                        ? 'warning'
                        : entry.level === 'error'
                          ? 'error'
                          : 'log';
                this.recordConsoleEntry({
                    level,
                    text: entry.text || '',
                    url: entry.url || '',
                    lineNumber: entry.lineNumber,
                    timestamp: entry.timestamp,
                    source: 'log',
                    logSource: entry.source || '',
                });
                return;
            }

            if (method === 'Network.requestWillBeSent') {
                this.recordNetworkRequest(params);
                return;
            }

            if (method === 'Network.responseReceived') {
                this.recordNetworkResponse(params);
                return;
            }

            if (method === 'Network.loadingFailed') {
                this.recordNetworkFailure(params);
                return;
            }

            if (method === 'Debugger.scriptParsed') {
                this.recordScript(params);
                return;
            }

            if (method === 'Page.frameNavigated' && !params.frame?.parentId) {
                if (typeof params.frame?.url === 'string' && params.frame.url) {
                    session.tabUrl = params.frame.url;
                }
                session.scripts.clear();
                this.resetBuffers();
            }
        } catch (error) {
            debugLog('[DebugCaptureManager] Event handling failed:', error);
        }
    }

    recordConsoleEntry(entry) {
        const session = this.session;
        if (!session) return;

        session.consoleEntries.push({
            level: entry.level || 'log',
            text: truncate(entry.text),
            url: entry.url || '',
            lineNumber: Number.isFinite(entry.lineNumber) ? entry.lineNumber : null,
            timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
            source: entry.source || 'console',
            logSource: entry.logSource || '',
        });

        if (session.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
            session.consoleEntries.splice(0, session.consoleEntries.length - MAX_CONSOLE_ENTRIES);
        }
    }

    recordNetworkRequest(params) {
        const session = this.session;
        const request = params.request || {};
        if (!session || !params.requestId) return;

        session.networkEntries.set(params.requestId, {
            requestId: params.requestId,
            method: request.method || 'GET',
            url: truncate(request.url || '', 1000),
            resourceType: params.type || 'Other',
            status: null,
            statusText: '',
            mimeType: '',
            failed: false,
            errorText: '',
            requestHeaders: sanitizeHeaders(request.headers),
            responseHeaders: {},
            // wallTime is epoch seconds; timestamp is monotonic and must not be
            // treated as epoch time, otherwise resetAt filtering drops entries.
            timestamp: Number.isFinite(params.wallTime) ? params.wallTime * 1000 : Date.now(),
            monotonicTimestamp: Number.isFinite(params.timestamp) ? params.timestamp : null,
            durationMs: null,
        });

        while (session.networkEntries.size > MAX_NETWORK_ENTRIES) {
            const oldestKey = session.networkEntries.keys().next().value;
            session.networkEntries.delete(oldestKey);
        }
    }

    recordNetworkResponse(params) {
        const session = this.session;
        const entry = session?.networkEntries.get(params.requestId);
        if (!entry) return;

        const response = params.response || {};
        entry.status = Number.isFinite(response.status) ? response.status : null;
        entry.statusText = response.statusText || '';
        entry.mimeType = response.mimeType || '';
        entry.responseHeaders = sanitizeHeaders(response.headers);
        if (Number.isFinite(params.timestamp) && Number.isFinite(entry.monotonicTimestamp)) {
            entry.durationMs = Math.max(
                0,
                Math.round((params.timestamp - entry.monotonicTimestamp) * 1000)
            );
        }
    }

    recordNetworkFailure(params) {
        const session = this.session;
        const entry = session?.networkEntries.get(params.requestId);
        if (!entry) return;

        entry.failed = true;
        entry.errorText = params.errorText || params.blockedReason || 'Request failed';
        if (Number.isFinite(params.timestamp) && Number.isFinite(entry.monotonicTimestamp)) {
            entry.durationMs = Math.max(
                0,
                Math.round((params.timestamp - entry.monotonicTimestamp) * 1000)
            );
        }
    }

    recordScript(params) {
        const session = this.session;
        if (!session || !params?.scriptId) return;

        session.scripts.set(params.scriptId, {
            scriptId: params.scriptId,
            url: params.url || '',
            startLine: Number.isFinite(params.startLine) ? params.startLine : null,
            endLine: Number.isFinite(params.endLine) ? params.endLine : null,
            length: Number.isFinite(params.length) ? params.length : null,
            isModule: params.isModule === true,
        });

        while (session.scripts.size > 500) {
            const oldestKey = session.scripts.keys().next().value;
            session.scripts.delete(oldestKey);
        }
    }

    resetBuffers() {
        if (!this.session) return;
        this.session.startedAt = Date.now();
        this.session.resetAt = Date.now();
        this.session.consoleEntries.length = 0;
        this.session.networkEntries.clear();
    }

    /**
     * Runs one debug tool against the active session.
     * @param {string} toolName
     * @param {object} args tool arguments from the model
     * @returns {Promise<string>} compact text result (or an error message)
     */
    async execute(toolName, args = {}) {
        if (!this.session?.attached) {
            return 'Error: Debug tools are not enabled for this tab. Turn on Debug in the composer first.';
        }

        // The schema list is the source of truth for which names are debug
        // tools; the switch below only maps them to implementations.
        if (!isDebugTool(toolName)) {
            return `Error: Unknown debug tool '${toolName}'.`;
        }

        try {
            switch (toolName) {
                case 'get_console_logs':
                    return this.getConsoleLogs(args);
                case 'get_page_errors':
                    return this.getPageErrors();
                case 'get_network_requests':
                    return this.getNetworkRequests(args);
                case 'get_network_detail':
                    return await this.getNetworkDetail(args);
                case 'get_storage':
                    return await this.getStorage(args);
                case 'get_page_info':
                    return await this.getPageInfo();
                case 'get_dom_html':
                    return await this.getDomHtml(args);
                case 'get_element_styles':
                    return await this.getElementStyles(args);
                case 'get_script_sources':
                    return await this.getScriptSources(args);
                case 'evaluate_script':
                    return await this.evaluateScript(args);
                case 'clear_debug_logs':
                    this.resetBuffers();
                    return 'Debug logs cleared.';
                default:
                    return `Error: Unknown debug tool '${toolName}'.`;
            }
        } catch (error) {
            return `Error: ${error?.message || String(error)}`;
        }
    }

    getConsoleLogs({ level = 'all', limit, sinceMs = 0 } = {}) {
        const since =
            Number.isFinite(Number(sinceMs)) && Number(sinceMs) > 0
                ? Date.now() - Number(sinceMs)
                : 0;
        const normalizedLevel = String(level || 'all').toLowerCase();
        const resetAt = Number(this.session.resetAt) || 0;
        const entries = this.session.consoleEntries.filter((entry) => {
            if (entry.timestamp < resetAt) return false;
            if (normalizedLevel !== 'all' && entry.level !== normalizedLevel) return false;
            return since === 0 || entry.timestamp >= since;
        });

        if (entries.length === 0) {
            return `No console logs captured${normalizedLevel === 'all' ? '' : ` at level ${normalizedLevel}`} yet.`;
        }

        const selected = entries.slice(-normalizeLimit(limit));
        return this.truncateOutput(
            selected
                .map((entry) => {
                    const location = entry.url
                        ? ` (${entry.url}${entry.lineNumber != null ? `:${entry.lineNumber}` : ''})`
                        : '';
                    return `[${formatTimestamp(entry.timestamp)}] [${entry.level}] ${entry.text}${location}`;
                })
                .join('\n')
        );
    }

    getPageErrors() {
        const resetAt = Number(this.session.resetAt) || 0;
        const errors = this.session.consoleEntries.filter((entry) => {
            if (entry.timestamp < resetAt) return false;
            // Chrome reports failed resource loads as Log entries; they belong
            // to get_network_requests, not page errors.
            if (entry.source === 'exception') return true;
            return entry.source === 'console' && entry.level === 'error';
        });

        if (errors.length === 0) {
            return 'No uncaught exceptions or console errors captured yet.';
        }

        const selected = errors.slice(-DEFAULT_LIMIT);
        const formatEntry = (entry) => {
            const location = entry.url
                ? ` (${entry.url}${entry.lineNumber != null ? `:${entry.lineNumber}` : ''})`
                : '';
            return `[${formatTimestamp(entry.timestamp)}] ${entry.text}${location}`;
        };
        const exceptions = selected.filter((entry) => entry.source === 'exception');
        const consoleErrors = selected.filter((entry) => entry.source === 'console');
        const sections = [];

        if (exceptions.length > 0) {
            sections.push(
                `Uncaught exceptions (${exceptions.length}):\n${exceptions.map(formatEntry).join('\n')}`
            );
        }
        if (consoleErrors.length > 0) {
            sections.push(
                `Console errors (${consoleErrors.length}):\n${consoleErrors.map(formatEntry).join('\n')}`
            );
        }

        return this.truncateOutput(sections.join('\n\n'));
    }

    getNetworkRequests({ urlContains, method, status, failedOnly = false, limit } = {}) {
        const urlFilter = String(urlContains || '').toLowerCase();
        const methodFilter = String(method || '').toUpperCase();
        const statusFilter = Number.isFinite(Number(status)) ? Number(status) : null;

        const entries = Array.from(this.session.networkEntries.values()).filter((entry) => {
            if (entry.timestamp < (Number(this.session.resetAt) || 0)) return false;
            if (urlFilter && !entry.url.toLowerCase().includes(urlFilter)) return false;
            if (methodFilter && entry.method.toUpperCase() !== methodFilter) return false;
            if (statusFilter != null && entry.status !== statusFilter) return false;
            if (failedOnly && !entry.failed) return false;
            return true;
        });

        if (entries.length === 0) {
            return 'No network requests matched. Only requests made after Debug was enabled are captured.';
        }

        const selected = entries.slice(-normalizeLimit(limit));
        return this.truncateOutput(
            selected
                .map((entry) => {
                    const statusText = entry.failed
                        ? `FAILED (${entry.errorText})`
                        : entry.status != null
                          ? `${entry.status}${entry.statusText ? ` ${entry.statusText}` : ''}`
                          : 'pending';
                    const duration = entry.durationMs != null ? ` ${entry.durationMs}ms` : '';
                    return `${entry.method} ${entry.url} → ${statusText}${duration} [${entry.resourceType}] requestId=${entry.requestId}`;
                })
                .join('\n')
        );
    }

    async getNetworkDetail({ requestId, includeBody = true } = {}) {
        const entry = this.session.networkEntries.get(String(requestId || ''));
        if (!entry) {
            return `Error: Unknown requestId '${requestId}'. Call get_network_requests first.`;
        }

        const lines = [
            `${entry.method} ${entry.url}`,
            `Status: ${entry.failed ? `FAILED (${entry.errorText})` : (entry.status ?? 'pending')}`,
            `Type: ${entry.resourceType}${entry.mimeType ? ` (${entry.mimeType})` : ''}`,
            entry.durationMs != null ? `Duration: ${entry.durationMs}ms` : '',
            `Timestamp: ${formatTimestamp(entry.timestamp)}`,
        ].filter(Boolean);

        const requestHeaders = formatHeaders(entry.requestHeaders);
        if (requestHeaders) lines.push('Request headers:', requestHeaders);

        const responseHeaders = formatHeaders(entry.responseHeaders);
        if (responseHeaders) lines.push('Response headers:', responseHeaders);

        if (includeBody !== false) {
            lines.push(
                'Response body:',
                entry.failed
                    ? '[body unavailable: the request failed]'
                    : await this.getResponseBody(requestId)
            );
        }

        return this.truncateOutput(lines.join('\n'));
    }

    async getResponseBody(requestId) {
        try {
            const result = await this.sendCommand('Network.getResponseBody', {
                requestId: String(requestId),
            });
            if (!result) return '[body unavailable]';
            if (result.base64Encoded) {
                return `[base64 body, ${result.body?.length || 0} chars]`;
            }
            return truncate(result.body || '', MAX_NETWORK_BODY_LENGTH);
        } catch (error) {
            const message = String(error?.message || error || '');
            if (/no data found/i.test(message)) {
                return '[body unavailable: the browser has no stored body for this request]';
            }
            return `[body unavailable: ${message}]`;
        }
    }

    async getStorage({ type = 'local', keyContains = '' } = {}) {
        const normalizedType = String(type || 'local').toLowerCase();
        const keyFilter = String(keyContains || '').toLowerCase();

        if (normalizedType === 'cookie') {
            return this.getCookies(keyFilter);
        }

        if (normalizedType !== 'local' && normalizedType !== 'session') {
            return "Error: 'type' must be one of local, session, cookie.";
        }

        const storageName = normalizedType === 'local' ? 'localStorage' : 'sessionStorage';
        const expression = `(() => {
            const out = [];
            for (let i = 0; i < ${storageName}.length; i++) {
                const key = ${storageName}.key(i);
                out.push([key, ${storageName}.getItem(key)]);
            }
            return out;
        })()`;

        const response = await this.sendCommand('Runtime.evaluate', {
            expression,
            returnByValue: true,
        });

        if (response?.exceptionDetails) {
            return `Error reading ${storageName}: ${response.exceptionDetails.text || 'evaluation failed'}`;
        }

        const entries = Array.isArray(response?.result?.value) ? response.result.value : [];
        const filtered = entries.filter(([key]) => {
            if (!keyFilter) return true;
            return String(key).toLowerCase().includes(keyFilter);
        });

        if (filtered.length === 0) return `${storageName} is empty.`;

        const selected = filtered.slice(0, MAX_STORAGE_ITEMS);
        const lines = selected.map(([key, value]) => `${key}: ${sanitizeStorageEntry(key, value)}`);
        if (filtered.length > selected.length) {
            lines.push(`[truncated: ${filtered.length - selected.length} more items]`);
        }
        return this.truncateOutput(
            `${storageName} (${filtered.length} items):\n${lines.join('\n')}`
        );
    }

    async getCookies(keyFilter = '') {
        const url = this.session.tabUrl;
        if (!url) return 'Error: current tab URL is unavailable.';

        const result = await this.sendCommand('Network.getCookies', { urls: [url] });
        const cookies = Array.isArray(result?.cookies) ? result.cookies : [];
        const filtered = cookies.filter((cookie) => {
            if (!keyFilter) return true;
            return String(cookie.name || '')
                .toLowerCase()
                .includes(keyFilter);
        });

        if (filtered.length === 0) return 'No cookies found for the current page.';

        const selected = filtered.slice(0, MAX_STORAGE_ITEMS);
        const lines = selected.map(
            (cookie) =>
                `${cookie.name}: <redacted> (domain=${cookie.domain || ''}, path=${cookie.path || ''}, expires=${cookie.expires || 'session'})`
        );
        return this.truncateOutput(`cookies (${filtered.length} items):\n${lines.join('\n')}`);
    }

    async evaluateValue(expression, { awaitPromise = false, timeoutMs } = {}) {
        const response = await this.sendCommand(
            'Runtime.evaluate',
            {
                expression,
                returnByValue: true,
                awaitPromise,
                userGesture: false,
            },
            timeoutMs ? { timeoutMs } : {}
        );

        if (response?.exceptionDetails) {
            throw new Error(
                response.exceptionDetails.exception?.description ||
                    response.exceptionDetails.text ||
                    'Evaluation failed.'
            );
        }

        return response?.result?.value;
    }

    async getPageInfo() {
        const info = await this.evaluateValue(`(() => {
            const frameworks = [];
            if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || window.React || document.querySelector('[data-reactroot]')) frameworks.push('React');
            if (document.querySelector('#__next')) frameworks.push('Next.js');
            if (window.__VUE__ || window.Vue) frameworks.push('Vue');
            if (document.querySelector('#__nuxt')) frameworks.push('Nuxt');
            if (window.ng || document.querySelector('[ng-version]')) frameworks.push('Angular');
            if (document.querySelector('[class*="svelte-"]')) frameworks.push('Svelte');
            if (window.Turbo || document.querySelector('[data-turbo-body], turbo-frame, turbo-stream')) frameworks.push('Turbo');
            if (window.Stimulus) frameworks.push('Stimulus');
            return {
                url: location.href,
                title: document.title,
                readyState: document.readyState,
                viewport: {
                    width: innerWidth,
                    height: innerHeight,
                    devicePixelRatio,
                },
                frameworks,
            };
        })()`);

        return this.truncateOutput(JSON.stringify(info, null, 2));
    }

    async getDomHtml({ selector = '', maxLength = 20000 } = {}) {
        const limit = Math.min(Math.max(1000, Number(maxLength) || 20000), MAX_TOOL_OUTPUT_LENGTH);
        const selectorValue = String(selector || '');
        const html = await this.evaluateValue(`(() => {
            const selector = ${JSON.stringify(selectorValue)};
            const element = selector ? document.querySelector(selector) : document.documentElement;
            return element ? element.outerHTML : null;
        })()`);

        if (html == null) {
            return selectorValue
                ? `Error: No element matches selector '${selectorValue}'.`
                : 'Error: No document available.';
        }

        return truncate(html, limit);
    }

    async getElementStyles({ selector = '', properties = [] } = {}) {
        const selectorValue = String(selector || '').trim();
        if (!selectorValue) return "Error: 'selector' is required.";

        const propList = Array.isArray(properties)
            ? properties.filter((property) => typeof property === 'string' && property)
            : [];

        const styles = await this.evaluateValue(`(() => {
            const element = document.querySelector(${JSON.stringify(selectorValue)});
            if (!element) return null;
            const computed = getComputedStyle(element);
            const defaults = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-size', 'font-weight', 'border', 'z-index', 'opacity', 'overflow', 'flex', 'grid-template-columns'];
            const requested = ${JSON.stringify(propList)};
            const keys = requested.length ? requested : defaults;
            const out = {};
            for (const key of keys) out[key] = computed.getPropertyValue(key);
            return out;
        })()`);

        if (!styles) return `Error: No element matches selector '${selectorValue}'.`;
        return this.truncateOutput(JSON.stringify(styles, null, 2));
    }

    async getScriptSources({ scriptId, urlContains, limit } = {}) {
        const normalizedId = String(scriptId || '').trim();
        if (normalizedId) {
            try {
                const result = await this.sendCommand('Debugger.getScriptSource', {
                    scriptId: normalizedId,
                });
                const source = typeof result?.scriptSource === 'string' ? result.scriptSource : '';
                if (!source) {
                    return `Error: Script '${normalizedId}' has no source available.`;
                }
                const entry = this.session.scripts.get(normalizedId);
                const header = entry?.url
                    ? `Script ${normalizedId}: ${entry.url}\n\n`
                    : `Script ${normalizedId}:\n\n`;
                return this.truncateOutput(header + truncate(source));
            } catch (error) {
                return `Error reading script '${normalizedId}': ${error?.message || String(error)}`;
            }
        }

        const urlFilter = String(urlContains || '').toLowerCase();
        // Debugger.scriptParsed fires again with new scriptIds on soft
        // navigations; dedupe by URL so consecutive calls stay stable.
        const byUrl = new Map();
        for (const script of this.session.scripts.values()) {
            if (!script.url) continue;
            if (urlFilter && !script.url.toLowerCase().includes(urlFilter)) continue;
            byUrl.set(script.url, script);
        }
        const scripts = Array.from(byUrl.values()).sort((a, b) => a.url.localeCompare(b.url));

        if (scripts.length === 0) {
            return 'No external scripts parsed since Debug was enabled. Inline scripts and scripts loaded before Debug are not listed.';
        }

        const selected = scripts.slice(0, normalizeLimit(limit ?? 100));
        return this.truncateOutput(
            `Scripts parsed after Debug was enabled (${scripts.length}):\n` +
                selected
                    .map((script) => {
                        const url = script.url;
                        const moduleTag = script.isModule ? ' [module]' : '';
                        const range =
                            script.startLine != null && script.endLine != null
                                ? ` lines ${script.startLine}-${script.endLine}`
                                : '';
                        const size =
                            script.length != null ? ` ${Math.round(script.length / 1024)}KB` : '';
                        return `scriptId=${script.scriptId}${moduleTag} ${truncate(url, 300)}${range}${size}`;
                    })
                    .join('\n')
        );
    }

    async evaluateScript({ script } = {}) {
        const expression = typeof script === 'string' ? script.trim() : '';
        if (!expression) return "Error: 'script' must be a non-empty string.";
        if (expression.length > 10240) {
            return 'Error: Script exceeds the 10240-character safety limit.';
        }

        try {
            const value = await this.evaluateValue(expression, {
                awaitPromise: true,
                timeoutMs: DEBUG_EVALUATE_TIMEOUT_MS,
            });
            if (value === undefined) return 'undefined';
            if (typeof value === 'string') return this.truncateOutput(value);
            try {
                return this.truncateOutput(JSON.stringify(value, null, 2));
            } catch {
                return this.truncateOutput(String(value));
            }
        } catch (error) {
            return `Error: ${error?.message || String(error)}`;
        }
    }

    truncateOutput(text) {
        return truncate(text, MAX_TOOL_OUTPUT_LENGTH);
    }
}
