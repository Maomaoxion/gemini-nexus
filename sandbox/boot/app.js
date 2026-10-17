import { renderLayout } from '../ui/layout.js';
import { applyTranslations, t } from '../core/i18n.js';
import { sendToBackground } from '../../shared/messaging/index.js';
import { loadLibs, MARKDOWN_READY_EVENT } from './loader.js';
import { AppMessageBridge } from './messaging.js';
import { bindAppEvents } from './events.js';

export function initAppMode() {
    // Render layout before querying DOM nodes.
    renderLayout();

    // Apply translations before signaling readiness.
    applyTranslations();

    // Chrome extension sandbox 环境限制:postMessage 必须使用 '*'
    // sandbox page 的 origin 为 'null',对非 sandbox window 使用精确 origin 无效
    window.parent.postMessage({ action: 'UI_READY' }, '*');

    const bridge = new AppMessageBridge();

    document.addEventListener('gemini-language-changed', () => {
        applyTranslations();
    });

    (async () => {
        try {
            // Load the heavier application modules after the shell is visible.
            const [{ ImageManager }, { SessionManager }, { UIController }, { AppController }] =
                await Promise.all([
                    import('../core/image_manager.js'),
                    import('../core/session_manager.js'),
                    import('../ui/ui_controller.js'),
                    import('../controllers/app_controller.js'),
                ]);

            const sessionManager = new SessionManager();

            const ui = new UIController({
                historyListEl: document.getElementById('history-list'),
                sidebar: document.getElementById('history-sidebar'),
                sidebarOverlay: document.getElementById('sidebar-overlay'),
                statusDiv: document.getElementById('status'),
                historyDiv: document.getElementById('chat-history'),
                inputFn: document.getElementById('prompt'),
                sendBtn: document.getElementById('send'),
                historyToggleBtn: document.getElementById('history-toggle'),
                closeSidebarBtn: document.getElementById('close-sidebar'),
                modelSelect: document.getElementById('model-select'),
            });

            const imageManager = new ImageManager(
                {
                    imageInput: document.getElementById('image-input'),
                    imagePreview: document.getElementById('image-preview'),
                    inputWrapper: document.querySelector('.input-wrapper'),
                    inputFn: document.getElementById('prompt'),
                },
                {
                    onUrlDrop: (url) => {
                        ui.updateStatus(t('loadingImage'));
                        sendToBackground({ action: 'FETCH_IMAGE', url });
                    },
                    onFilesChanged: (hasFiles) => {
                        ui.chat?.setHasAttachments?.(hasFiles);
                        app?.onComposerChanged?.();
                    },
                }
            );

            const app = new AppController(sessionManager, ui, imageManager);

            // Bind click handlers before flushing queued parent messages so a
            // restore-handler failure cannot leave the shell with dead buttons.
            bindAppEvents(app, ui, (resizeCallback) => bridge.setResizeCallback(resizeCallback));

            bridge.setUI(ui);
            bridge.setApp(app);

            // Re-render restored sessions exactly when Markdown becomes available.
            // Gated on sessionsRestored: before RESTORE_SESSIONS arrives there
            // is no current session, so an early event would only no-op.
            window.addEventListener(MARKDOWN_READY_EVENT, () => {
                if (app && app.sessionsRestored) app.rerender();
            });

            // Trigger dependency load in parallel. Markdown configuration
            // happens inside the loader when marked arrives; no direct
            // configureMarkdown() call here (marked is not loaded yet).
            loadLibs();

            console.info('[Gemini Nexus] Sandbox app controllers ready');
        } catch (error) {
            // A failed dynamic import previously left a painted shell with dead buttons.
            console.error('[Gemini Nexus] Failed to boot sandbox app:', error);
            const status = document.getElementById('status');
            if (status) {
                status.textContent =
                    'UI failed to load. Reload the side panel. ' +
                    (error?.message || String(error));
                status.style.color = 'var(--error, #c5221f)';
            }
        }
    })();
}
