(function () {
    function isMhtmlArchiveUrl(url) {
        return typeof url === 'string' && /\.(?:mhtml|mht)(?:[?#].*)?$/i.test(url);
    }

    function computeDisabled() {
        const href = window.location && window.location.href;
        return isMhtmlArchiveUrl(href);
    }

    window.GeminiNexusPageGuard = {
        get isDisabled() {
            return computeDisabled();
        },
        get reason() {
            return computeDisabled() ? 'mhtml' : null;
        },
        isMhtmlArchiveUrl,
    };
})();
