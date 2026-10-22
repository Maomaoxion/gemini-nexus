// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from './chat.js';

vi.mock('../render/clipboard.js', () => ({
    copyToClipboard: vi.fn(),
}));

vi.mock('../core/i18n.js', () => ({
    t: (key) => key,
}));

function setScrollMetrics(element, { scrollHeight, clientHeight, scrollTop }) {
    Object.defineProperty(element, 'scrollHeight', {
        configurable: true,
        value: scrollHeight,
    });
    Object.defineProperty(element, 'clientHeight', {
        configurable: true,
        value: clientHeight,
    });
    Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        writable: true,
        value: scrollTop,
    });
}

function createController() {
    const historyDiv = document.createElement('div');
    historyDiv.scrollTo = vi.fn(({ top }) => {
        historyDiv.scrollTop = top;
    });

    const controller = new ChatController({
        historyDiv,
        inputFn: document.createElement('textarea'),
        sendBtn: document.createElement('button'),
        statusDiv: document.createElement('div'),
    });

    return { controller, historyDiv };
}

describe('ChatController footer spacing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.documentElement.style.removeProperty('--footer-height');
        document.body.innerHTML = '<div class="footer"></div>';
    });

    it('publishes the measured footer height for chat-history padding', () => {
        const footer = document.querySelector('.footer');
        footer.getBoundingClientRect = vi.fn(() => ({ height: 298.2 }));

        const { controller } = createController();
        controller.updateFooterOffset();

        expect(document.documentElement.style.getPropertyValue('--footer-height')).toBe('299px');
    });
});

describe('ChatController empty-state mention tip', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('inserts the @ trigger at a word boundary', () => {
        document.body.innerHTML = `
            <div class="footer"></div>
            <div id="chat-empty">
                <button class="chat-empty-tip" data-empty-action="mention-tab"></button>
            </div>
        `;
        const inputFn = document.createElement('textarea');
        inputFn.value = 'draft text';
        const controller = new ChatController({
            historyDiv: document.createElement('div'),
            inputFn,
            sendBtn: document.createElement('button'),
            statusDiv: document.createElement('div'),
        });

        document.querySelector('[data-empty-action="mention-tab"]').click();

        expect(inputFn.value).toBe('draft text @');
        expect(inputFn.selectionStart).toBe('draft text @'.length);
        expect(controller).toBeTruthy();
    });
});

describe('ChatController send enablement', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('marks empty send as is-empty while keeping the button clickable', () => {
        const sendBtn = document.createElement('button');
        const inputFn = document.createElement('textarea');
        const controller = new ChatController({
            historyDiv: document.createElement('div'),
            inputFn,
            sendBtn,
            statusDiv: document.createElement('div'),
        });

        // Empty state stays enabled so click can show feedback (is-empty / aria-disabled).
        expect(sendBtn.disabled).toBe(false);
        expect(sendBtn.classList.contains('is-empty')).toBe(true);
        expect(sendBtn.getAttribute('aria-disabled')).toBe('true');

        inputFn.value = 'hello';
        inputFn.dispatchEvent(new Event('input'));
        expect(sendBtn.disabled).toBe(false);
        expect(sendBtn.classList.contains('is-empty')).toBe(false);
        expect(sendBtn.getAttribute('aria-disabled')).toBe('false');

        inputFn.value = '   ';
        inputFn.dispatchEvent(new Event('input'));
        expect(sendBtn.classList.contains('is-empty')).toBe(true);
        expect(sendBtn.getAttribute('aria-disabled')).toBe('true');

        controller.setHasAttachments(true);
        expect(sendBtn.classList.contains('is-empty')).toBe(false);
        expect(sendBtn.getAttribute('aria-disabled')).toBe('false');

        controller.setLoading(true);
        expect(sendBtn.disabled).toBe(false);
        expect(sendBtn.classList.contains('generating')).toBe(true);

        controller.setLoading(false);
        expect(sendBtn.classList.contains('generating')).toBe(false);
        expect(sendBtn.disabled).toBe(false);
        expect(sendBtn.classList.contains('is-empty')).toBe(false);

        controller.setHasAttachments(false);
        expect(sendBtn.classList.contains('is-empty')).toBe(true);
        expect(sendBtn.getAttribute('aria-disabled')).toBe('true');
        expect(sendBtn.disabled).toBe(false);
    });
});

describe('ChatController streaming scroll following', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            callback();
            return 1;
        });
    });

    it('keeps following the bottom while streamed content grows', () => {
        const { controller, historyDiv } = createController();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1000,
            clientHeight: 400,
            scrollTop: 600,
        });

        controller.handleHistoryScroll();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1300,
            clientHeight: 400,
            scrollTop: 600,
        });
        controller.followStreamingContent();

        expect(historyDiv.scrollTo).toHaveBeenCalledWith({
            top: 1300,
            behavior: 'instant',
        });
    });

    it('stops following when the user scrolls away from the bottom', () => {
        const { controller, historyDiv } = createController();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1000,
            clientHeight: 400,
            scrollTop: 300,
        });

        controller.handleHistoryScroll();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1300,
            clientHeight: 400,
            scrollTop: 300,
        });
        controller.followStreamingContent();

        expect(historyDiv.scrollTo).not.toHaveBeenCalled();
    });

    it('stops following immediately on wheel-up even while still near the bottom', () => {
        const { controller, historyDiv } = createController();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1000,
            clientHeight: 400,
            scrollTop: 600,
        });

        controller.handleHistoryWheel({ deltaY: -100 });

        setScrollMetrics(historyDiv, {
            scrollHeight: 1400,
            clientHeight: 400,
            scrollTop: 536,
        });
        controller.followStreamingContent();

        expect(historyDiv.scrollTo).not.toHaveBeenCalled();
        expect(controller.shouldFollowBottom).toBe(false);
    });

    it('does not re-arm following from programmatic scroll events', () => {
        const { controller, historyDiv } = createController();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1000,
            clientHeight: 400,
            scrollTop: 600,
        });
        controller.handleHistoryWheel({ deltaY: -100 });
        controller.handleHistoryScroll();

        controller.handleHistoryScroll();

        expect(controller.shouldFollowBottom).toBe(false);
    });

    it('re-arms following after an intentional wheel-down back to the bottom', () => {
        const { controller, historyDiv } = createController();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1000,
            clientHeight: 400,
            scrollTop: 600,
        });
        controller.handleHistoryWheel({ deltaY: -100 });
        controller.handleHistoryScroll();

        controller.handleHistoryWheel({ deltaY: 120 });
        setScrollMetrics(historyDiv, {
            scrollHeight: 1400,
            clientHeight: 400,
            scrollTop: 1000,
        });
        controller.handleHistoryScroll();
        controller.followStreamingContent();

        expect(controller.shouldFollowBottom).toBe(true);
        expect(historyDiv.scrollTo).toHaveBeenCalledWith({
            top: 1400,
            behavior: 'instant',
        });
    });

    it('does not force the viewport down while the user is reading history', () => {
        const { controller, historyDiv } = createController();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1400,
            clientHeight: 400,
            scrollTop: 300,
        });
        controller.handleHistoryScroll();

        controller.scrollToBottom();
        vi.advanceTimersByTime(50);

        expect(historyDiv.scrollTo).not.toHaveBeenCalled();

        controller.scrollToBottom({ force: true });
        vi.advanceTimersByTime(50);

        expect(historyDiv.scrollTop).toBe(1400);
    });

    it('follows the stream again after the user sends a new message', () => {
        const { controller, historyDiv } = createController();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1400,
            clientHeight: 400,
            scrollTop: 300,
        });
        controller.handleHistoryScroll();
        setScrollMetrics(historyDiv, {
            scrollHeight: 1800,
            clientHeight: 400,
            scrollTop: 300,
        });

        controller.followBottom();

        expect(controller.shouldFollowBottom).toBe(true);
        expect(historyDiv.scrollTo).toHaveBeenCalledWith({
            top: 1800,
            behavior: 'instant',
        });
    });

    it('releases artifact resources when clearing history', () => {
        const { controller, historyDiv } = createController();
        const artifact = document.createElement('div');
        artifact.setAttribute('data-live-artifact-enhanced', 'true');
        const cleanup = vi.fn();
        artifact.__liveArtifactCleanup = cleanup;
        historyDiv.appendChild(artifact);

        controller.clear();

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(historyDiv.innerHTML).toBe('');
    });
});
