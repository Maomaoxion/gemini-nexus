/**
 * Storage report for saved chats.
 *
 * The chat list lives in the sandbox, so the data-management panel can size it
 * locally: every session is measured by its serialized size, with embedded
 * base64 images counted separately because they dominate the total.
 */

const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

function utf8ByteLength(text) {
    if (encoder) return encoder.encode(text).length;
    return text.length;
}

function collectDataUrlBytes(value, counter) {
    if (typeof value === 'string') {
        if (value.startsWith('data:')) counter.bytes += utf8ByteLength(value);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((entry) => collectDataUrlBytes(entry, counter));
        return;
    }
    if (value && typeof value === 'object') {
        Object.keys(value).forEach((key) => collectDataUrlBytes(value[key], counter));
    }
}

function measureMessageImages(message) {
    const counter = { bytes: 0 };
    if (!message || typeof message !== 'object') return 0;

    collectDataUrlBytes(message.image, counter);
    collectDataUrlBytes(message.attachments, counter);
    collectDataUrlBytes(message.generatedImages, counter);

    return counter.bytes;
}

export function measureSessionStorage(session) {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    let imageBytes = 0;
    let messageBytes = 0;

    for (const message of messages) {
        messageBytes += utf8ByteLength(JSON.stringify(message ?? null));
        imageBytes += measureMessageImages(message);
    }

    let totalBytes = 0;
    try {
        totalBytes = utf8ByteLength(JSON.stringify(session ?? null));
    } catch {
        // Circular or otherwise unserializable data: fall back to the message sum.
        totalBytes = messageBytes;
    }

    return {
        bytes: totalBytes,
        imageBytes,
        messageBytes,
        messageCount: messages.length,
    };
}

export function buildSessionStorageReport(sessions, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const entries = (Array.isArray(sessions) ? sessions : [])
        .filter((session) => session && typeof session === 'object')
        .map((session) => {
            const storage = measureSessionStorage(session);
            return {
                id: session.id,
                title: typeof session.title === 'string' ? session.title : '',
                updatedAt: Number.isFinite(session.timestamp) ? session.timestamp : 0,
                ...storage,
            };
        })
        .sort((left, right) => right.bytes - left.bytes);

    return {
        sessions: entries,
        totals: {
            sessionCount: entries.length,
            messageCount: entries.reduce((total, entry) => total + entry.messageCount, 0),
            totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
            imageBytes: entries.reduce((total, entry) => total + entry.imageBytes, 0),
        },
        now,
    };
}

export function formatStorageBytes(bytes, { fractionDigits = 1 } = {}) {
    const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    if (value < 1024) return `${Math.round(value)} B`;

    const units = ['KB', 'MB', 'GB'];
    let scaled = value / 1024;
    let unitIndex = 0;
    while (scaled >= 1024 && unitIndex < units.length - 1) {
        scaled /= 1024;
        unitIndex++;
    }

    const rounded = scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(fractionDigits));
    return `${rounded} ${units[unitIndex]}`;
}

export function selectSessionsOlderThan(report, days, { now } = {}) {
    const reference = Number.isFinite(now) ? now : report?.now || Date.now();
    const cutoffMs = Math.max(0, days) * 24 * 60 * 60 * 1000;

    return (report?.sessions || [])
        .filter((session) => {
            if (!Number.isFinite(session.updatedAt) || session.updatedAt <= 0) return false;
            return reference - session.updatedAt > cutoffMs;
        })
        .map((session) => session.id);
}
