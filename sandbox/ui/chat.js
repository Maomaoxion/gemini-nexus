import { t } from '../core/i18n.js';
import { copyToClipboard } from '../render/clipboard.js';
import { cleanupLiveArtifacts } from '../render/artifacts.js';
import { TemplateIcons } from './templates/icons.js';
import '../../shared/ui/copy_feedback.js';

export class ChatController {
    constructor(elements) {
        this.historyDiv = elements.historyDiv;
        this.statusDiv = elements.statusDiv;
        this.inputFn = elements.inputFn;
        this.sendBtn = elements.sendBtn;
        this.liveArtifactsBtn = document.getElementById('live-artifacts-btn');
        this.imagePreview = elements.imagePreview || document.getElementById('image-preview');
        this.footerEl = document.querySelector('.footer');
        this.shouldFollowBottom = true;
        this.scrollFrame = null;
        this.userScrollIntent = null;
        this.lastTouchScrollTop = null;
        this.resizeObserver = null;
        this.footerResizeObserver = null;
        this.observedResizeElements = new WeakSet();
        this.hasAttachments = false;

        this.initListeners();
        this.initEmptyTips();
        this.initFooterOffsetSync();
        this.syncSendEnabled();
    }

    initEmptyTips() {
        const emptyEl = document.getElementById('chat-empty');
        if (!emptyEl) return;
        emptyEl.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-empty-action]');
            if (!trigger) return;
            const action = trigger.getAttribute('data-empty-action');
            if (action === 'mention-tab') {
                const input = this.inputFn;
                if (!input) return;
                // The @ mention only triggers at a word boundary, so keep the
                // trigger separated from text the user already typed.
                const prefix = input.value && !/\s$/.test(input.value) ? ' ' : '';
                input.value += `${prefix}@`;
                input.setSelectionRange?.(input.value.length, input.value.length);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.focus();
            } else if (action === 'capture') {
                const button = document.getElementById('capture-menu-btn');
                // Open the Capture dropdown directly — tool_button_events handles toggleMenu
                if (button) button.click();
            } else if (action === 'browser-control') {
                const button = document.getElementById('browser-control-btn');
                if (button) {
                    if (button.getAttribute('aria-pressed') !== 'true') button.click();
                    else this.inputFn?.focus();
                }
            } else if (action === 'github-star') {
                const browserButton = document.getElementById('browser-control-btn');
                if (browserButton?.getAttribute('aria-pressed') !== 'true') browserButton?.click();
                setTimeout(() => {
                    if (!this.inputFn || !this.sendBtn) return;
                    const prompt = t('githubStarPrompt');
                    this.inputFn.value = prompt;
                    this.inputFn.dispatchEvent(new Event('input', { bubbles: true }));
                    this.inputFn.style.height = 'auto';
                    this.inputFn.style.height = `${this.inputFn.scrollHeight}px`;
                    this.updateFooterOffset?.();
                    this.syncSendEnabled?.();
                    this.inputFn.focus();
                    setTimeout(() => this.sendBtn?.click(), 120);
                }, 450);
            }
        });
    }

    initListeners() {
        if (this.inputFn) {
            this.inputFn.addEventListener('input', () => {
                this.inputFn.style.height = 'auto';
                this.inputFn.style.height = this.inputFn.scrollHeight + 'px';
                this.updateFooterOffset();
                this.syncSendEnabled();
            });
        }

        if (this.historyDiv) {
            this.historyDiv.addEventListener('click', async (clickEvent) => {
                const link = clickEvent.target.closest('a[href]');
                if (link) {
                    const href = link.getAttribute('href');
                    if (href && /^https?:\/\//i.test(href)) {
                        clickEvent.preventDefault();
                        clickEvent.stopPropagation();
                        window.parent.postMessage(
                            {
                                action: 'OPEN_EXTERNAL_URL',
                                payload: { url: href },
                            },
                            '*'
                        );
                        return;
                    }
                }

                const copyCodeButton = clickEvent.target.closest('.copy-code-btn');
                if (!copyCodeButton) return;

                const codeBlockWrapper = copyCodeButton.closest('.code-block-wrapper');
                const codeElement = codeBlockWrapper.querySelector('code');
                if (!codeElement) return;

                try {
                    await copyToClipboard(codeElement.textContent);

                    globalThis.GeminiCopyFeedback.showCopied(copyCodeButton, t('copied'));
                } catch (error) {
                    console.error('Failed to copy code', error);
                }
            });
        }

        if (this.historyDiv) {
            this.historyDiv.addEventListener('scroll', () => this.handleHistoryScroll(), {
                passive: true,
            });
            this.historyDiv.addEventListener('wheel', (event) => this.handleHistoryWheel(event), {
                passive: true,
            });
            this.historyDiv.addEventListener('pointerdown', () => this.handleHistoryPointerDown(), {
                passive: true,
            });
            window.addEventListener('pointerup', () => this.handleHistoryPointerUp(), {
                passive: true,
            });
            this.historyDiv.addEventListener('touchstart', () => this.handleHistoryTouchStart(), {
                passive: true,
            });
            this.historyDiv.addEventListener('touchmove', () => this.handleHistoryTouchMove(), {
                passive: true,
            });
            this.initScrollObservers();
        }
    }

    initFooterOffsetSync() {
        this.updateFooterOffset();

        if (!this.footerEl || typeof ResizeObserver === 'undefined') return;

        this.footerResizeObserver = new ResizeObserver(() => this.updateFooterOffset());
        this.footerResizeObserver.observe(this.footerEl);
    }

    updateFooterOffset() {
        if (!this.footerEl) return;

        const rect = this.footerEl.getBoundingClientRect();
        const height = Math.ceil(rect.height || 0);
        if (height > 0) {
            document.documentElement.style.setProperty('--footer-height', `${height}px`);
        }
    }

    updateStatus(text) {
        if (this.statusDiv) {
            this.statusDiv.innerText = text;
        }
    }

    clear() {
        // Release Live Artifact listeners/iframes first: blanking innerHTML
        // alone would orphan them.
        if (this.historyDiv) {
            cleanupLiveArtifacts(this.historyDiv);
            this.historyDiv.innerHTML = '';
        }
    }

    isNearBottom(threshold = 120) {
        if (!this.historyDiv) return null;

        const distanceFromBottom =
            this.historyDiv.scrollHeight - this.historyDiv.scrollTop - this.historyDiv.clientHeight;

        return distanceFromBottom <= threshold;
    }

    getScrollState() {
        if (!this.historyDiv) return null;

        return {
            scrollTop: this.historyDiv.scrollTop,
            scrollHeight: this.historyDiv.scrollHeight,
            clientHeight: this.historyDiv.clientHeight,
            isNearBottom: this.isNearBottom(),
        };
    }

    // Wheel-up is an explicit "I want to read earlier content" signal.
    handleHistoryWheel(event) {
        const deltaY = Number(event?.deltaY) || 0;
        if (deltaY === 0) return;

        this.userScrollIntent = deltaY < 0 ? 'up' : 'down';
        if (deltaY < 0) {
            this.shouldFollowBottom = false;
            this.cancelScheduledBottomScroll();
        }
    }

    handleHistoryPointerDown() {
        this.userScrollIntent = 'pointer';
    }

    handleHistoryPointerUp() {
        if (this.userScrollIntent === 'pointer') this.userScrollIntent = null;
    }

    handleHistoryTouchStart() {
        this.userScrollIntent = 'pointer';
        this.lastTouchScrollTop = this.historyDiv?.scrollTop ?? null;
    }

    handleHistoryTouchMove() {
        if (!this.historyDiv || this.lastTouchScrollTop === null) return;

        const scrollTop = this.historyDiv.scrollTop;
        if (scrollTop < this.lastTouchScrollTop - 2) {
            this.shouldFollowBottom = false;
            this.cancelScheduledBottomScroll();
        }
        this.lastTouchScrollTop = scrollTop;
    }

    handleHistoryScroll() {
        const isNearBottom = this.isNearBottom();
        if (isNearBottom === null) return;

        if (!isNearBottom) {
            this.shouldFollowBottom = false;
            this.cancelScheduledBottomScroll();
            if (this.userScrollIntent !== 'pointer') this.userScrollIntent = null;
            return;
        }

        // Programmatic auto-scroll must not re-arm following after the user
        // scrolled away; only an intentional downward scroll does that.
        if (this.userScrollIntent === 'down' || this.userScrollIntent === 'pointer') {
            this.shouldFollowBottom = true;
        }
        if (this.userScrollIntent !== 'pointer') this.userScrollIntent = null;
    }

    initScrollObservers() {
        if (!this.historyDiv) return;

        if (typeof MutationObserver !== 'undefined') {
            const mutationObserver = new MutationObserver(() => {
                this.observeScrollableChildren();
                this.followStreamingContent();
            });
            mutationObserver.observe(this.historyDiv, {
                childList: true,
                subtree: true,
                characterData: true,
            });
        }

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.followStreamingContent());
            this.resizeObserver.observe(this.historyDiv);
            this.observeScrollableChildren();
        }
    }

    observeScrollableChildren() {
        if (!this.resizeObserver || !this.historyDiv) return;

        Array.from(this.historyDiv.children).forEach((child) => {
            if (this.observedResizeElements.has(child)) return;
            this.observedResizeElements.add(child);
            this.resizeObserver.observe(child);
        });
    }

    cancelScheduledBottomScroll() {
        if (this.scrollFrame === null) return;
        window.cancelAnimationFrame(this.scrollFrame);
        this.scrollFrame = null;
    }

    scheduleBottomScroll(behavior = 'instant') {
        if (!this.historyDiv) return;
        if (this.scrollFrame !== null) return;

        this.scrollFrame = window.requestAnimationFrame(() => {
            this.scrollFrame = null;
            // A pending frame must not pull the viewport down after the user
            // scrolled away in the same frame.
            if (!this.historyDiv || !this.shouldFollowBottom) return;
            this.historyDiv.scrollTo({
                top: this.historyDiv.scrollHeight,
                behavior,
            });
        });
    }

    followBottom({ smooth = false } = {}) {
        this.shouldFollowBottom = true;
        this.scheduleBottomScroll(smooth ? 'smooth' : 'instant');
    }

    followStreamingContent() {
        if (!this.shouldFollowBottom) return;
        this.scheduleBottomScroll('instant');
    }

    restoreScrollState(state) {
        if (!this.historyDiv || !state) return;

        setTimeout(() => {
            if (state.isNearBottom) {
                this.shouldFollowBottom = true;
                this.scheduleBottomScroll('instant');
                return;
            }

            this.shouldFollowBottom = false;
            const maxScrollTop = Math.max(
                0,
                this.historyDiv.scrollHeight - this.historyDiv.clientHeight
            );
            this.historyDiv.scrollTop = Math.min(state.scrollTop, maxScrollTop);
        }, 50);
    }

    scrollToBottom(options = {}) {
        if (!this.historyDiv) return;
        if (options.mode !== 'bottom' && options.force !== true && !this.shouldFollowBottom) return;

        setTimeout(() => {
            if (!this.historyDiv) return;

            if (options.mode === 'bottom') {
                this.shouldFollowBottom = true;
                this.scheduleBottomScroll('instant');
                return;
            }
            if (options.force !== true && !this.shouldFollowBottom) return;

            // Scroll to the start of the last message to ensure visibility from the beginning
            const lastMsg = this.historyDiv.lastElementChild;
            if (lastMsg) {
                this.historyDiv.scrollTo({
                    top: lastMsg.offsetTop - 20,
                    behavior: 'smooth',
                });
            } else {
                this.historyDiv.scrollTop = this.historyDiv.scrollHeight;
            }
        }, 50);
    }

    getInputValue() {
        return this.inputFn?.value || '';
    }

    setInputValue(value, options = {}) {
        if (!this.inputFn) return;
        this.inputFn.value = typeof value === 'string' ? value : '';
        this.inputFn.style.height = 'auto';
        if (this.inputFn.value) {
            this.inputFn.style.height = `${this.inputFn.scrollHeight}px`;
        }
        this.updateFooterOffset();
        if (options.focus) this.inputFn.focus();
        this.syncSendEnabled();
    }

    resetInput() {
        this.setInputValue('', { focus: true });
    }

    setHasAttachments(hasAttachments) {
        this.hasAttachments = hasAttachments === true;
        this.syncSendEnabled();
    }

    hasSendableContent() {
        const text = this.inputFn?.value?.trim() || '';
        if (text) return true;
        if (this.hasAttachments) return true;
        if (this.imagePreview?.classList.contains('has-image')) return true;
        return false;
    }

    syncSendEnabled() {
        if (!this.sendBtn) return;
        // Stop must always be clickable while generating.
        if (this.sendBtn.classList.contains('generating')) {
            this.sendBtn.disabled = false;
            this.sendBtn.setAttribute('aria-disabled', 'false');
            return;
        }
        // Keep the button enabled so click always fires and can show "enter a
        // message" feedback. Visual/aria still reflect empty vs ready state.
        const canSend = this.hasSendableContent();
        this.sendBtn.disabled = false;
        this.sendBtn.setAttribute('aria-disabled', canSend ? 'false' : 'true');
        this.sendBtn.classList.toggle('is-empty', !canSend);
    }

    toggleLiveArtifacts(isActive) {
        if (this.liveArtifactsBtn) {
            this.liveArtifactsBtn.classList.toggle('active', isActive);
            this.liveArtifactsBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
    }

    setLoading(isLoading) {
        if (isLoading) {
            this.updateStatus(''); // Clear status text, only show spinner
            if (this.statusDiv) this.statusDiv.classList.add('thinking');

            if (this.sendBtn) {
                this.sendBtn.innerHTML = TemplateIcons.STOP;
                this.sendBtn.title = t('stopGenerating');
                this.sendBtn.classList.add('generating');
                this.sendBtn.disabled = false;
            }
        } else {
            this.updateStatus('');
            if (this.statusDiv) this.statusDiv.classList.remove('thinking');

            if (this.sendBtn) {
                this.sendBtn.innerHTML = TemplateIcons.SEND;
                this.sendBtn.title = t('sendMessage');
                this.sendBtn.classList.remove('generating');
            }
            this.syncSendEnabled();
        }
    }
}
