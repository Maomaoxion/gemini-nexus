const MIME_EXTENSIONS = {
    'application/pdf': 'pdf',
    'application/json': 'json',
    'text/css': 'css',
    'text/csv': 'csv',
    'text/html': 'html',
    'text/javascript': 'js',
    'text/markdown': 'md',
    'text/plain': 'txt',
    'text/x-python': 'py',
};

const IMAGE_SIGNATURES = [
    { signature: '/9j/', type: 'image/jpeg' },
    { signature: 'iVBORw0KGgo', type: 'image/png' },
    { signature: 'R0lGODdh', type: 'image/gif' },
    { signature: 'R0lGODlh', type: 'image/gif' },
    { signature: 'UklGR', type: 'image/webp' },
];

export const MAX_ATTACHMENTS_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function estimateDataUrlBytes(dataUrl) {
    if (typeof dataUrl !== 'string') return 0;
    const commaIndex = dataUrl.indexOf(',');
    const payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : '';
    return Math.floor(payload.replace(/\s+/g, '').length * 0.75);
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

export function getDataUrlMime(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    return dataUrl.match(/^data:([^;,]+)[;,]/)?.[1] || null;
}

function getDataUrlPayload(dataUrl) {
    if (typeof dataUrl !== 'string') return '';
    const commaIndex = dataUrl.indexOf(',');
    return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : '';
}

function inferImageMimeFromDataUrl(dataUrl) {
    const payload = getDataUrlPayload(dataUrl).replace(/\s+/g, '');
    const match = IMAGE_SIGNATURES.find(({ signature }) => payload.startsWith(signature));
    return match ? match.type : null;
}

function normalizeAttachmentType(type, dataUrl) {
    const normalizedType = typeof type === 'string' ? type.trim() : '';
    if (normalizedType && normalizedType !== 'application/octet-stream') {
        return normalizedType;
    }

    return inferImageMimeFromDataUrl(dataUrl) || normalizedType || 'application/octet-stream';
}

function normalizeAttachmentDataUrl(dataUrl, type) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl;
    if (!type || !type.startsWith('image/')) return dataUrl;

    const metadata = dataUrl.slice(0, dataUrl.indexOf(','));
    const payload = getDataUrlPayload(dataUrl);
    if (!metadata || !payload) return dataUrl;

    const currentType = getDataUrlMime(dataUrl);
    if (currentType === type) return dataUrl;

    return `data:${type};base64,${payload}`;
}

function getDefaultExtension(mimeType) {
    if (!mimeType) return 'bin';
    if (mimeType.startsWith('image/')) return mimeType.split('/')[1] || 'png';
    return MIME_EXTENSIONS[mimeType] || 'bin';
}

function createDefaultName(index, mimeType) {
    return `attachment-${index + 1}.${getDefaultExtension(mimeType)}`;
}

export function normalizeUserAttachments(attachments) {
    const items = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];

    return items
        .slice(0, MAX_ATTACHMENTS_COUNT)
        .map((item, index) => {
            if (typeof item === 'string') {
                const declaredType = getDataUrlMime(item);
                const type = declaredType
                    ? normalizeAttachmentType(declaredType, item)
                    : inferImageMimeFromDataUrl(item) || 'image/png';
                return {
                    base64: normalizeAttachmentDataUrl(item, type),
                    type,
                    name: createDefaultName(index, type),
                };
            }

            if (!isPlainObject(item) || typeof item.base64 !== 'string') return null;

            const type = normalizeAttachmentType(
                item.type || getDataUrlMime(item.base64),
                item.base64
            );
            return {
                base64: normalizeAttachmentDataUrl(item.base64, type),
                type,
                name:
                    typeof item.name === 'string' && item.name.trim()
                        ? item.name
                        : createDefaultName(index, type),
            };
        })
        .filter(Boolean);
}

export function getImageAttachmentDataUrls(attachments) {
    return normalizeUserAttachments(attachments)
        .filter((attachment) => attachment.type.startsWith('image/'))
        .map((attachment) => attachment.base64);
}

/**
 * Rejects oversized sends with a user-facing error. Normalization itself
 * stays total (history restore must never throw), so send paths call this
 * explicitly before converting or uploading attachments.
 */
export function assertAttachmentsWithinLimits(attachments) {
    const items = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];
    if (items.length > MAX_ATTACHMENTS_COUNT) {
        throw new Error(
            `Too many attachments (${items.length}); at most ${MAX_ATTACHMENTS_COUNT} are supported.`
        );
    }
    for (const item of items) {
        const base64 = typeof item === 'string' ? item : item?.base64;
        const bytes = estimateDataUrlBytes(base64);
        if (bytes > MAX_ATTACHMENT_BYTES) {
            const name = (typeof item === 'object' && item?.name) || 'attachment';
            throw new Error(
                `Attachment "${name}" is too large (~${Math.round(bytes / 1048576)}MB); files must be under ${MAX_ATTACHMENT_BYTES / 1048576}MB.`
            );
        }
    }
}

export function normalizeMessageImages(image) {
    if (!image) return [];
    const images = Array.isArray(image) ? image : [image];
    return images.filter(Boolean);
}

export function getAttachmentDataUrls(attachments) {
    return normalizeUserAttachments(attachments).map((attachment) => attachment.base64);
}

export function countUserAttachmentsByType(attachments) {
    return normalizeUserAttachments(attachments).reduce(
        (counts, attachment) => {
            if (attachment.type.startsWith('image/')) {
                counts.images += 1;
            } else {
                counts.files += 1;
            }
            return counts;
        },
        { images: 0, files: 0 }
    );
}

export function getNonImageAttachments(attachments) {
    return normalizeUserAttachments(attachments).filter(
        (attachment) => !attachment.type.startsWith('image/')
    );
}

export function attachmentToInlineData(attachment) {
    const [metadata, data] = String(attachment?.base64 || '').split(',');
    if (!metadata || !data) return null;

    return {
        mimeType:
            attachment.type || getDataUrlMime(attachment.base64) || 'application/octet-stream',
        data,
    };
}

export function describeMessageAttachmentMarkers(message) {
    const markers = [];
    const userAttachmentCounts = countUserAttachmentsByType(message?.attachments);
    const legacyImages =
        userAttachmentCounts.images === 0 && userAttachmentCounts.files === 0
            ? normalizeMessageImages(message?.image).length
            : 0;
    const imageCount = userAttachmentCounts.images + legacyImages;

    if (imageCount > 0) {
        markers.push(`[${imageCount} image attachment(s)]`);
    }
    if (userAttachmentCounts.files > 0) {
        markers.push(`[${userAttachmentCounts.files} file attachment(s)]`);
    }
    if (Array.isArray(message?.generatedImages) && message.generatedImages.length > 0) {
        markers.push(`[${message.generatedImages.length} generated image(s)]`);
    }
    if (Array.isArray(message?.sources) && message.sources.length > 0) {
        markers.push(`[${message.sources.length} source link(s)]`);
    }

    return markers;
}
