(function () {
    class GeminiStreamHandler {
        constructor(uiController, callbacks) {
            this.ui = uiController;
            this.callbacks = callbacks || {}; // { onSessionId }
            this.handleStreamMessage = this.handleStreamMessage.bind(this);
        }

        init() {
            chrome.runtime.onMessage.addListener(this.handleStreamMessage);
        }

        handleStreamMessage(request) {
            // The toolbar only consumes its own quick-ask stream. Sidepanel
            // streams are broadcast via chrome.runtime.sendMessage too; reject
            // them explicitly (a missing source used to fall through here and
            // leak sidepanel tokens into an open toolbar ask window).
            if (request.source && request.source !== 'toolbar') return false;

            if (request.action === 'GEMINI_STREAM_UPDATE') {
                if (this.ui.isVisible()) {
                    this.ui.showResult(request.text, null, true);
                }
            }

            if (request.action === 'GEMINI_STREAM_DONE') {
                const result = request.result;

                if (request.sessionId) {
                    if (this.callbacks.onSessionId) {
                        this.callbacks.onSessionId(request.sessionId);
                    }
                }

                if (this.ui.isVisible()) {
                    if (result && result.status === 'success') {
                        this.ui.showResult(result.text, null, false, result.images);
                    } else if (result && result.status === 'error') {
                        this.ui.showError(result.text);
                    } else if (result && result.status === 'cancelled') {
                        // A quick-ask can be cancelled by an external path
                        // (e.g. the user sends a sidepanel SEND_PROMPT, whose
                        // cancelActiveRun aborts the in-flight quick-ask).
                        // Without this branch the toolbar stayed in the
                        // loading state forever: no result, no error, no way
                        // to dismiss except closing the toolbar.
                        this.ui.showResult(result.text || '', null, false);
                    }
                }

                // Always clear the streaming/loading indicator for terminal
                // statuses so the toolbar is not left stuck.
                if (
                    result &&
                    (result.status === 'success' ||
                        result.status === 'error' ||
                        result.status === 'cancelled')
                ) {
                    this.ui.stopLoading();
                }
            }
        }
    }

    window.GeminiStreamHandler = GeminiStreamHandler;
})();
