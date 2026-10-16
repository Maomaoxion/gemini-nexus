(function () {
    const SANDBOX_CLEANUP_DELAY_MS = 250;
    // A renderer that never answers must not leave the toolbar in a loading
    // state forever: the single caller (ui/renderer.js) falls back to escaped
    // plain text when render() rejects.
    const RENDER_TIMEOUT_MS = 8000;

    class RendererBridge {
        constructor(hostElement) {
            this.host = hostElement;
            this.iframe = null;
            this.callbacksByRequestId = {};
            this.renderTimeouts = {};
            this.requestIdCounter = 0;
            this.cleanupTimer = null;
            this.iframeLoaded = false;
            this.iframeReady = null;
            this.handleMessage = this.handleMessage.bind(this);
            this._destroyed = false;
            this.init();
        }

        init() {
            window.addEventListener('message', this.handleMessage);
        }

        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;
            window.removeEventListener('message', this.handleMessage);
            if (this.cleanupTimer) {
                clearTimeout(this.cleanupTimer);
                this.cleanupTimer = null;
            }
            // Settle pending renders so their awaiters never hang: rejection
            // funnels into the caller's escaped-text fallback.
            for (const requestId of Object.keys(this.callbacksByRequestId)) {
                clearTimeout(this.renderTimeouts[requestId]);
                this.callbacksByRequestId[requestId].reject(new Error('Renderer bridge destroyed'));
            }
            this.iframe?.remove();
            this.iframe = null;
            this.iframeLoaded = false;
            this.iframeReady = null;
            this.callbacksByRequestId = {};
            this.renderTimeouts = {};
        }

        ensureIframe() {
            if (this.cleanupTimer) {
                clearTimeout(this.cleanupTimer);
                this.cleanupTimer = null;
            }

            if (this.iframe && this.iframe.isConnected) {
                return this.iframe;
            }

            this.iframe = document.createElement('iframe');
            try {
                const pageGuard = window.GeminiNexusPageGuard;
                if (pageGuard?.safeGetURL) {
                    this.iframe.src = pageGuard.safeGetURL('sandbox/index.html?mode=renderer');
                } else if (
                    typeof chrome !== 'undefined' &&
                    typeof chrome.runtime?.getURL === 'function'
                ) {
                    this.iframe.src = chrome.runtime.getURL('sandbox/index.html?mode=renderer');
                }
            } catch {
                // Extension context invalidated
            }
            this.iframe.style.display = 'none';
            this.iframeLoaded = false;
            this.iframeReady = new Promise((resolve) => {
                this.iframe.addEventListener(
                    'load',
                    () => {
                        this.iframeLoaded = true;
                        resolve();
                    },
                    { once: true }
                );
            });
            this.host.appendChild(this.iframe);
            return this.iframe;
        }

        async waitForIframe(iframe) {
            if (this.iframeLoaded && iframe === this.iframe) return;
            await this.iframeReady;
        }

        handleMessage(event) {
            // Strict source check: only accept messages from the renderer iframe we created.
            // event.origin is null for sandboxed iframes, so we rely on event.source identity.
            if (event.source !== this.iframe?.contentWindow) return;
            // As an additional hardening step, verify the iframe's src is our extension's sandbox.
            if (this.iframe && event.source === this.iframe.contentWindow) {
                try {
                    const expectedPrefix = chrome.runtime.getURL('sandbox/index.html');
                    if (!this.iframe.src || !this.iframe.src.startsWith(expectedPrefix)) {
                        return;
                    }
                } catch {
                    // Chrome API may be unavailable in non-extension contexts; fail closed.
                    return;
                }
            }
            if (!event.data || typeof event.data !== 'object') return;

            if (event.data.action === 'RENDER_RESULT') {
                const { html, reqId: requestId, fetchTasks } = event.data;
                if (Object.prototype.hasOwnProperty.call(this.callbacksByRequestId, requestId)) {
                    const entry = this.callbacksByRequestId[requestId];
                    clearTimeout(this.renderTimeouts[requestId]);
                    delete this.callbacksByRequestId[requestId];
                    delete this.renderTimeouts[requestId];
                    entry.resolve({ html, fetchTasks });
                    this.scheduleCleanup();
                }
            }
        }

        scheduleCleanup() {
            if (Object.keys(this.callbacksByRequestId).length > 0) return;

            this.cleanupTimer = setTimeout(() => {
                if (Object.keys(this.callbacksByRequestId).length > 0) return;
                this.iframe?.remove();
                this.iframe = null;
                this.iframeLoaded = false;
                this.iframeReady = null;
                this.cleanupTimer = null;
            }, SANDBOX_CLEANUP_DELAY_MS);
        }

        createRequestId() {
            if (globalThis.GeminiNexusIds?.createPrefixedId) {
                return globalThis.GeminiNexusIds.createPrefixedId('req');
            }
            if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
                return `req_${globalThis.crypto.randomUUID().toUpperCase()}`;
            }
            this.requestIdCounter += 1;
            return `req_${this.requestIdCounter}`;
        }

        withTimeout(promise, ms) {
            let timer;
            const guard = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Renderer timed out after ${ms}ms`)), ms);
            });
            return Promise.race([
                Promise.resolve(promise).finally(() => clearTimeout(timer)),
                guard,
            ]);
        }

        async render(text, images = []) {
            const requestId = this.createRequestId();
            const iframe = this.ensureIframe();
            try {
                await this.withTimeout(this.waitForIframe(iframe), RENDER_TIMEOUT_MS);
            } catch {
                this.scheduleCleanup();
                throw new Error(`Renderer timed out after ${RENDER_TIMEOUT_MS}ms`);
            }
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (
                        Object.prototype.hasOwnProperty.call(this.callbacksByRequestId, requestId)
                    ) {
                        delete this.callbacksByRequestId[requestId];
                        delete this.renderTimeouts[requestId];
                        this.scheduleCleanup();
                        reject(new Error(`Renderer timed out after ${RENDER_TIMEOUT_MS}ms`));
                    }
                }, RENDER_TIMEOUT_MS);
                this.renderTimeouts[requestId] = timer;
                this.callbacksByRequestId[requestId] = {
                    resolve: (result) => {
                        clearTimeout(this.renderTimeouts[requestId]);
                        delete this.renderTimeouts[requestId];
                        resolve(result);
                    },
                    reject: (error) => {
                        clearTimeout(this.renderTimeouts[requestId]);
                        delete this.renderTimeouts[requestId];
                        reject(error);
                    },
                };
                if (iframe === this.iframe && iframe.contentWindow) {
                    iframe.contentWindow.postMessage(
                        { action: 'RENDER', text, images, reqId: requestId },
                        '*'
                    );
                } else {
                    // The bridge was torn down or recreated while waiting for
                    // the iframe: reject so the caller shows its fallback.
                    this.callbacksByRequestId[requestId].reject(
                        new Error('Renderer iframe unavailable')
                    );
                    delete this.callbacksByRequestId[requestId];
                    this.scheduleCleanup();
                }
            });
        }
    }

    window.GeminiRendererBridge = RendererBridge;
})();
