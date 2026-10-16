import { AuthManager } from './auth_manager.js';
import { getConnectionSettings } from './session/settings_store.js';
import { RequestDispatcher } from './session/request_dispatcher.js';
import { classifyProviderError, isUnavailableWebAuthError } from './session/error_classifier.js';
import { keepAliveManager } from './keep_alive.js';

const REQUEST_CANCELLED_TEXT = 'Request cancelled.';

function createGeminiAuthLink(accountIndex) {
    const href = `https://gemini.google.com/u/${accountIndex}/`;
    return `<a href="${href}" target="_blank" class="gemini-auth-link">gemini.google.com/u/${accountIndex}/</a>`;
}

export class GeminiSessionManager {
    constructor() {
        this.auth = new AuthManager();
        this.dispatcher = new RequestDispatcher(this.auth);
        this.abortControllers = new Map();
    }

    _abortByKey(key) {
        const controller = this.abortControllers.get(key);
        if (controller) {
            try {
                controller.abort();
            } catch {}
            this.abortControllers.delete(key);
            return true;
        }
        return false;
    }

    async ensureInitialized() {
        await this.auth.ensureInitialized();
    }

    async handleSendPrompt(request, onUpdate, abortKey = null) {
        const key = abortKey || 'default';
        // Cancel only previous request for same key (sequential prompt handling)
        // instead of aborting every in-flight request globally.
        this._abortByKey(key);

        const abortController = new AbortController();
        this.abortControllers.set(key, abortController);
        const signal = abortController.signal;
        let thoughtsStartedAt = null;
        let thoughtsDurationSeconds = null;
        const trackedOnUpdate = (partialText, partialThoughts) => {
            if (typeof partialThoughts === 'string' && partialThoughts.trim()) {
                if (!thoughtsStartedAt) {
                    thoughtsStartedAt = Date.now();
                }
                thoughtsDurationSeconds = (Date.now() - thoughtsStartedAt) / 1000;
            }
            onUpdate(partialText, partialThoughts);
        };

        // Trigger keepalive rotation during long-running requests to prevent SW termination
        keepAliveManager.performRotation().catch(() => {});
        // Arm a short-interval heartbeat so a >30s thinking/reasoning pause
        // (no tokens emitted) does not let MV3 idle-terminate the worker and
        // leave the UI stuck on a loading spinner forever.
        keepAliveManager.beginStreamHeartbeat();

        try {
            const settings = await getConnectionSettings({ provider: request.provider });

            let files = [];
            if (request.files && Array.isArray(request.files)) {
                files = request.files;
            } else if (request.image) {
                files = [
                    {
                        base64: request.image,
                        type: request.imageType,
                        name: request.imageName || 'image.png',
                    },
                ];
            }

            // Ensure Auth is ready for Web provider (Dispatcher relies on AuthManager)
            if (settings.provider === 'web') {
                await this.ensureInitialized();
            }

            const result = await this.dispatcher.dispatch(
                request,
                settings,
                files,
                trackedOnUpdate,
                signal
            );
            if (result?.thoughts) {
                result.thoughtsDurationSeconds = thoughtsStartedAt
                    ? (Date.now() - thoughtsStartedAt) / 1000
                    : (thoughtsDurationSeconds ?? 0);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                return {
                    action: 'GEMINI_REPLY',
                    sessionId: request.sessionId || null,
                    text: REQUEST_CANCELLED_TEXT,
                    status: 'cancelled',
                };
            }

            console.error('Gemini Error:', error);

            let errorMessage = error.message || 'Unknown error';
            const isZh = chrome.i18n.getUILanguage().startsWith('zh');

            if (isUnavailableWebAuthError(errorMessage)) {
                this.auth.forceContextRefresh();
                try {
                    await chrome.storage.local.remove(['geminiContext']);
                } catch (storageError) {
                    console.warn(
                        '[Gemini Nexus] Failed to clear stale Web auth context:',
                        storageError
                    );
                }

                const currentIndex = this.auth.getCurrentIndex();
                const authLink = createGeminiAuthLink(currentIndex);
                if (isZh) {
                    errorMessage = `账号 (Index: ${currentIndex}) 未登录、会话已过期或 Gemini Web 请求参数不可用。请前往 ${authLink} 登录或刷新 Gemini 页面。`;
                } else {
                    errorMessage = `Account (Index: ${currentIndex}) is not logged in, the session expired, or Gemini Web request parameters are unavailable. Please log in at ${authLink} or refresh Gemini.`;
                }
            } else if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
                errorMessage = isZh
                    ? '请求过于频繁，请稍后再试 (429)'
                    : 'Too many requests, please try again later (429)';
            }

            const { kind: errorKind, retryable } = classifyProviderError(errorMessage);

            return {
                action: 'GEMINI_REPLY',
                sessionId: request.sessionId || null,
                text: 'Error: ' + errorMessage,
                status: 'error',
                errorKind,
                retryable,
            };
        } finally {
            if (this.abortControllers.get(key) === abortController) {
                this.abortControllers.delete(key);
            }
            // Always disarm the heartbeat, whether the stream completed, was
            // cancelled, or errored. Without this the alarm fires forever.
            keepAliveManager.endStreamHeartbeat();
        }
    }

    cancelCurrentRequest(abortKey = null) {
        if (abortKey) {
            return this._abortByKey(abortKey);
        }
        if (this.abortControllers.size === 0) return false;
        for (const [, controller] of this.abortControllers) {
            try {
                controller.abort();
            } catch {}
        }
        this.abortControllers.clear();
        return true;
    }

    async setContext(context) {
        await this.auth.updateContext(context);
    }

    async resetContext() {
        await this.auth.resetContext();
    }

    async clearContext() {
        await this.auth.clearContext();
    }
}
