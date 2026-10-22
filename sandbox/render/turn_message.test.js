// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnMessage } from './turn_message.js';

function createHost() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return host;
}

describe('createTurnMessage', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('renders one AI message with a single avatar and content area', () => {
        const turn = createTurnMessage(createHost());

        expect(turn.el.classList.contains('msg')).toBe(true);
        expect(turn.el.classList.contains('ai')).toBe(true);
        expect(turn.el.classList.contains('turn-message')).toBe(true);
        expect(turn.el.querySelectorAll('.message-avatar').length).toBe(1);
        expect(turn.el.querySelector('.turn-content')).not.toBeNull();
    });

    it('appends text and tool blocks inside the turn content', () => {
        const turn = createTurnMessage(createHost());

        turn.appendTextBlock({ text: 'First part' });
        turn.appendToolBlock({
            text: 'tool output',
            toolName: 'get_page_errors',
            toolStatus: 'completed',
        });
        turn.appendTextBlock({ text: 'Second part' });

        const content = turn.contentEl;
        expect(content.querySelectorAll('.msg.ai').length).toBe(2);
        expect(content.querySelectorAll('.msg.msg-tool-output').length).toBe(1);
        expect(turn.el.querySelector('.copy-btn')).not.toBeNull();
    });

    it('shows the copy button after a streamed block receives text', () => {
        const turn = createTurnMessage(createHost());
        const block = turn.appendTextBlock({ text: '', isStreaming: true });

        expect(turn.el.querySelector('.copy-btn')).toBeNull();

        block.update('Streamed answer', '', { isStreaming: true });

        expect(turn.el.querySelector('.copy-btn')).not.toBeNull();
    });

    it('enables retry only after a handler is attached', () => {
        const turn = createTurnMessage(createHost());
        const retryButton = turn.el.querySelector('.retry-btn');

        expect(retryButton.disabled).toBe(true);

        const onRetry = vi.fn();
        turn.setRetryHandler(onRetry);

        expect(retryButton.disabled).toBe(false);
        retryButton.click();
        expect(onRetry).toHaveBeenCalled();
    });

    it('routes delete to the turn-level handler', () => {
        const onDelete = vi.fn();
        const turn = createTurnMessage(createHost(), { onDelete });

        turn.el.querySelector('.delete-btn').click();

        expect(onDelete).toHaveBeenCalled();
        expect(document.body.contains(turn.el)).toBe(true);
    });

    it('keeps nested block rails out of the content so the turn owns the avatar', () => {
        const turn = createTurnMessage(createHost());
        turn.appendTextBlock({ text: 'First part' });
        turn.appendToolBlock({
            text: 'tool output',
            toolName: 'get_page_errors',
            toolStatus: 'completed',
        });

        expect(turn.contentEl.querySelectorAll('.message-action-rail').length).toBe(0);
        expect(turn.el.querySelectorAll('.message-avatar').length).toBe(1);
    });
});
