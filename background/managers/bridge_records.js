// Read-only helpers for the local debug bridge RPC. Expose chat history,
// groups, logs, and storage keys so local tools can inspect full usage records
// without DevTools. Large binary payloads (data URLs / base64) are redacted by
// default so native-messaging stays under the ~1MB frame limit.

export const DATA_URL_RE = /^data:[^;]+;base64,/i;
export const LONG_BASE64_MIN = 256;

/**
 * Replace data-URLs / long base64 strings with a length marker.
 * @param {unknown} value
 * @param {{ includeAttachments?: boolean }} [opts]
 */
export function redactLargeBlobs(value, opts = {}) {
    const includeAttachments = opts.includeAttachments === true;
    if (includeAttachments) return value;
    if (value == null) return value;
    if (typeof value === 'string') {
        if (DATA_URL_RE.test(value) || (value.length >= LONG_BASE64_MIN && isMostlyBase64(value))) {
            return `[omitted base64 ${value.length} chars]`;
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactLargeBlobs(item, opts));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            out[key] = redactLargeBlobs(child, opts);
        }
        return out;
    }
    return value;
}

function isMostlyBase64(value) {
    // Avoid treating normal long text as base64; require high base64 alphabet ratio.
    const sample = value.slice(0, 512);
    const base64CharCount = (sample.match(/[A-Za-z0-9+/=]/g) || []).join('').length;
    return base64CharCount / sample.length > 0.95;
}

/**
 * @param {object} session
 * @param {{ includeMessages?: boolean, includeAttachments?: boolean, previewLen?: number }} [opts]
 */
export function summarizeSession(session, opts = {}) {
    const includeMessages = opts.includeMessages === true;
    const includeAttachments = opts.includeAttachments === true;
    const previewLen = Math.max(0, Number(opts.previewLen) || 120);
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const firstUser = messages.find((m) => m?.role === 'user');
    const lastAi = [...messages].reverse().find((m) => m?.role === 'ai');
    const previewText =
        typeof firstUser?.text === 'string'
            ? firstUser.text.length > previewLen
                ? firstUser.text.slice(0, previewLen) + '…'
                : firstUser.text
            : '';

    const summary = {
        id: session?.id ?? null,
        title: session?.title ?? null,
        timestamp: session?.timestamp ?? null,
        isPinned: session?.isPinned === true,
        groupId: session?.groupId ?? null,
        messageCount: messages.length,
        userPreview: previewText,
        lastAiPreview:
            typeof lastAi?.text === 'string'
                ? lastAi.text.length > previewLen
                    ? lastAi.text.slice(0, previewLen) + '…'
                    : lastAi.text
                : '',
        hasContext: session?.context != null,
        hasContextSummary: session?.contextSummary != null,
    };

    if (includeMessages) {
        summary.messages = redactLargeBlobs(messages, { includeAttachments });
        if (session?.context != null) {
            summary.context = redactLargeBlobs(session.context, { includeAttachments });
        }
        if (session?.contextSummary != null) {
            summary.contextSummary = session.contextSummary;
        }
    }
    return summary;
}

/**
 * Full session record (optionally with binary attachments).
 * @param {object} session
 * @param {{ includeAttachments?: boolean }} [opts]
 */
export function projectSession(session, opts = {}) {
    if (!session || typeof session !== 'object') return null;
    return redactLargeBlobs(session, { includeAttachments: opts.includeAttachments === true });
}

/**
 * @param {unknown} sessions
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   includeMessages?: boolean,
 *   includeAttachments?: boolean,
 *   query?: string,
 *   id?: string,
 * }} [params]
 */
export function selectSessions(sessions, params = {}) {
    const list = Array.isArray(sessions) ? sessions : [];
    const id = params.id ? String(params.id) : null;
    let filtered = list;
    if (id) {
        filtered = list.filter((s) => s?.id === id);
    } else if (params.query) {
        const q = String(params.query).toLowerCase();
        filtered = list.filter((s) => {
            const title = String(s?.title || '').toLowerCase();
            if (title.includes(q)) return true;
            const msgs = Array.isArray(s?.messages) ? s.messages : [];
            return msgs.some((m) =>
                String(m?.text || '')
                    .toLowerCase()
                    .includes(q)
            );
        });
    }

    const offset = Math.max(0, Number(params.offset) || 0);
    const limitRaw = Number(params.limit);
    const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(Math.floor(limitRaw), 500)
            : Math.min(filtered.length, 100);

    const slice = filtered.slice(offset, offset + limit);
    const includeMessages = params.includeMessages === true || !!id;
    const includeAttachments = params.includeAttachments === true;

    return {
        total: filtered.length,
        offset,
        limit,
        sessions: slice.map((s) =>
            includeMessages
                ? projectSession(s, { includeAttachments })
                : summarizeSession(s, { includeMessages: false, includeAttachments })
        ),
    };
}

/**
 * Build the get_records / get_sessions RPC payloads from chrome.storage.local.
 * Inject storage API for tests.
 */
export function createBridgeRecordHandlers({ storageLocal, getLogs } = {}) {
    const local = storageLocal || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);

    async function getLocal(keys) {
        if (!local?.get) return {};
        return local.get(keys);
    }

    async function getAllKeys() {
        if (!local?.get) return [];
        const all = await local.get(null);
        return Object.keys(all || {});
    }

    return {
        async get_sessions(params = {}) {
            const { geminiSessions } = await getLocal(['geminiSessions']);
            return selectSessions(geminiSessions, params);
        },

        async get_session(params = {}) {
            const id = params?.id ? String(params.id) : '';
            if (!id) {
                throw new Error('id required');
            }
            const { geminiSessions } = await getLocal(['geminiSessions']);
            const list = Array.isArray(geminiSessions) ? geminiSessions : [];
            const session = list.find((s) => s?.id === id);
            if (!session) {
                return { found: false, session: null };
            }
            return {
                found: true,
                session: projectSession(session, {
                    includeAttachments: params.includeAttachments === true,
                }),
            };
        },

        async get_groups() {
            const { geminiGroups } = await getLocal(['geminiGroups']);
            return {
                groups: Array.isArray(geminiGroups) ? geminiGroups : [],
            };
        },

        async get_storage_keys() {
            const keys = await getAllKeys();
            const sizes = {};
            // Optional size estimate without returning values.
            if (local?.get && keys.length > 0) {
                const data = await local.get(keys);
                for (const key of keys) {
                    try {
                        sizes[key] = JSON.stringify(data[key] ?? null).length;
                    } catch {
                        sizes[key] = null;
                    }
                }
            }
            return { keys: keys.sort(), sizes };
        },

        /**
         * Full dump for local agents: sessions (+ optional messages), groups,
         * recent logs, and status metadata.
         */
        async get_records(params = {}) {
            const includeMessages = params.includeMessages !== false; // default full messages
            const includeAttachments = params.includeAttachments === true;
            const includeLogs = params.includeLogs !== false;
            const logLimit = Math.max(1, Math.min(Number(params.logLimit) || 200, 1000));
            const sessionLimit = Math.max(1, Math.min(Number(params.limit) || 100, 500));

            const stored = await getLocal(['geminiSessions', 'geminiGroups']);
            const selected = selectSessions(stored.geminiSessions, {
                limit: sessionLimit,
                offset: Number(params.offset) || 0,
                includeMessages,
                includeAttachments,
                query: params.query,
                id: params.id,
            });

            let logs = [];
            if (includeLogs && typeof getLogs === 'function') {
                const all = getLogs() || [];
                logs = all.slice(-logLimit);
            }

            return {
                ts: Date.now(),
                sessions: selected,
                groups: Array.isArray(stored.geminiGroups) ? stored.geminiGroups : [],
                logs,
            };
        },
    };
}
