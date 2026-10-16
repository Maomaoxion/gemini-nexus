const SAFE_DOWNLOAD_URL_PATTERN = /^(https?:|blob:|data:image\/)/i;
const UNSAFE_FILENAME_CHARS_PATTERN = /[\\/:*?"<>|]/g;
const MAX_FILENAME_LENGTH = 180;
const SAFE_TEXT_CONTENT_TYPES = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
]);

function sanitizeDownloadFilename(filename) {
    const cleaned = String(filename || '')
        .replace(UNSAFE_FILENAME_CHARS_PATTERN, '_')
        .trim();
    return cleaned.slice(0, MAX_FILENAME_LENGTH) || 'download';
}

function triggerDownload(url, filename) {
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);

    try {
        downloadLink.click();
    } finally {
        document.body.removeChild(downloadLink);
    }
}

export function downloadFile(url, filename) {
    // The URL arrives from sandbox iframe messages: restrict to image-capable
    // schemes so a compromised renderer cannot trigger arbitrary navigation.
    if (typeof url !== 'string' || !SAFE_DOWNLOAD_URL_PATTERN.test(url)) {
        console.warn('[Gemini Nexus] Refused unsafe download URL');
        return false;
    }
    triggerDownload(url, sanitizeDownloadFilename(filename));
    return true;
}

export function downloadText(text, filename, contentType = 'text/plain') {
    const normalizedType = String(contentType || 'text/plain')
        .split(';')[0]
        .trim()
        .toLowerCase();
    const blob = new Blob([text], {
        type: SAFE_TEXT_CONTENT_TYPES.has(normalizedType) ? normalizedType : 'text/plain',
    });
    const url = URL.createObjectURL(blob);

    try {
        triggerDownload(url, sanitizeDownloadFilename(filename || 'download.txt'));
    } finally {
        URL.revokeObjectURL(url);
    }
}
