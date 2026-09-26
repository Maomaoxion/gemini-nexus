(function () {
    function generateUUID() {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
            return globalThis.crypto.randomUUID().toUpperCase();
        }

        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
            .replace(/[xy]/g, (placeholder) => {
                const randomNibble = (Math.random() * 16) | 0;
                const uuidNibble = placeholder === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
                return uuidNibble.toString(16);
            })
            .toUpperCase();
    }

    function createPrefixedId(prefix) {
        const safePrefix = String(prefix || 'id')
            .replace(/[^A-Za-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return `${safePrefix || 'id'}_${generateUUID()}`;
    }

    globalThis.GeminiNexusIds = {
        generateUUID,
        createPrefixedId,
    };
})();
