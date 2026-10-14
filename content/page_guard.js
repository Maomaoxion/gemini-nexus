(function () {
    function isMhtmlArchiveUrl(url) {
        return typeof url === 'string' && /\.(?:mhtml|mht)(?:[?#].*)?$/i.test(url);
    }

    function computeDisabled() {
        const href = window.location && window.location.href;
        return isMhtmlArchiveUrl(href);
    }

    function isContextValid() {
        try {
            if (typeof chrome === 'undefined' || !chrome.runtime) return true;
            if ('id' in chrome.runtime && !chrome.runtime.id) {
                return false;
            }
            return true;
        } catch {
            return false;
        }
    }

    function safeGetURL(path) {
        try {
            if (isContextValid() && typeof chrome?.runtime?.getURL === 'function') {
                return chrome.runtime.getURL(path);
            }
        } catch {
            // Extension context invalidated
        }
        return '';
    }

    window.GeminiNexusPageGuard = {
        get isDisabled() {
            return computeDisabled();
        },
        get reason() {
            return computeDisabled() ? 'mhtml' : null;
        },
        isMhtmlArchiveUrl,
        isContextValid,
        safeGetURL,
    };
})();
