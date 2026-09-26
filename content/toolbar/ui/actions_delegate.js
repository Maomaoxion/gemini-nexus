(function () {
    function consumeEvent(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    class ToolbarUIActions {
        constructor(uiManager) {
            this.manager = uiManager;
        }

        get view() {
            return this.manager.view;
        }
        get renderer() {
            return this.manager.renderer;
        }

        triggerAction(event, action) {
            consumeEvent(event);
            this.manager.fireCallback('onAction', action);
        }

        // Separate names because events.js dispatches by method name; the body is
        // always the same consume-and-fire-onAction pair.
        cancelAsk(event) {
            this.triggerAction(event, 'cancel_ask');
        }

        stopAsk(event) {
            this.triggerAction(event, 'stop_ask');
        }

        retryAsk(event) {
            this.triggerAction(event, 'retry_ask');
        }

        continueChat(event) {
            this.triggerAction(event, 'continue_chat');
        }

        submitAsk() {
            const text = this.view.elements.askInput.value.trim();
            if (text) this.manager.fireCallback('onAction', 'submit_ask', text);
        }

        async copyResult(event) {
            consumeEvent(event);
            const text = this.renderer ? this.renderer.currentText : '';
            if (!text) return;

            try {
                await navigator.clipboard.writeText(text);
                this.view.toggleCopyIcon(true);
                setTimeout(() => this.view.toggleCopyIcon(false), 2000);
            } catch (error) {
                console.error('Failed to copy', error);
                this.view.showError('Copy failed.');
            }
        }

        insertResult(event) {
            consumeEvent(event);
            const text = this.renderer ? this.renderer.currentText : '';
            if (!text) return;
            this.manager.fireCallback('onAction', 'insert_result', text);
        }

        replaceResult(event) {
            consumeEvent(event);
            const text = this.renderer ? this.renderer.currentText : '';
            if (!text) return;
            this.manager.fireCallback('onAction', 'replace_result', text);
        }
    }

    window.GeminiToolbarUIActions = ToolbarUIActions;
})();
