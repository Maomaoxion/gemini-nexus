// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendMessage } from './message.js';
import { renderContent } from './content.js';

vi.mock('./content.js', () => ({
    renderContent: vi.fn((contentDiv, text) => {
        contentDiv.textContent = text || '';
    }),
}));

vi.mock('./clipboard.js', () => ({
    copyToClipboard: vi.fn(),
}));

vi.mock('./generated_image.js', () => ({
    createGeneratedImage: vi.fn(() => document.createElement('img')),
}));

vi.mock('../core/i18n.js', () => ({
    t: (key) => key,
}));

describe('appendMessage copy button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not show a copy button when a streaming AI update has no visible text', () => {
        const container = document.createElement('div');
        const controller = appendMessage(container, '', 'ai', null, '', null, {
            isStreaming: true,
            autoScroll: false,
        });

        controller.update('', undefined, { isStreaming: true });

        expect(container.querySelector('.copy-btn')).toBeNull();
    });

    it('shows and removes the copy button as visible AI text appears and disappears', () => {
        const container = document.createElement('div');
        const controller = appendMessage(container, '', 'ai', null, '', null, {
            isStreaming: true,
            autoScroll: false,
        });

        controller.update('Visible answer', undefined, { isStreaming: true });
        expect(container.querySelector('.copy-btn')).not.toBeNull();

        controller.update('', undefined, { isStreaming: true });
        expect(container.querySelector('.copy-btn')).toBeNull();
    });

    it('hides the copy button when an intermediate AI message suppresses copying', () => {
        const container = document.createElement('div');
        const controller = appendMessage(container, '', 'ai', null, 'thinking', null, {
            isStreaming: true,
            autoScroll: false,
        });

        controller.update('I will call a tool now.', undefined, { isStreaming: true });
        expect(container.querySelector('.copy-btn')).not.toBeNull();

        controller.finalize('I will call a tool now.', undefined, { suppressCopy: true });
        expect(container.querySelector('.copy-btn')).toBeNull();
        expect(container.querySelector('.msg-content')?.textContent).toBe(
            'I will call a tool now.'
        );
    });

    it('passes current streaming and final render state to message content', () => {
        const container = document.createElement('div');
        const controller = appendMessage(container, '', 'ai', null, '', null, {
            isStreaming: true,
            autoScroll: false,
        });

        controller.update('Partial mermaid block', undefined, { isStreaming: true });
        const contentDiv = controller.div.querySelector('.msg-content');
        expect(contentDiv.textContent).toBe('Partial mermaid block');
        expect(contentDiv.classList.contains('msg-content-streaming')).toBe(true);
        // Streaming tokens use plain text; Markdown runs only at finalize.
        // (The thoughts region renders independently of the message content.)
        const contentCalls = () =>
            renderContent.mock.calls.filter(([element]) => element === contentDiv);
        expect(contentCalls()).toHaveLength(0);

        controller.finalize('Final mermaid block', undefined);
        expect(contentCalls()).toHaveLength(1);
        expect(contentCalls()[0].slice(1)).toEqual([
            'Final mermaid block',
            'ai',
            expect.objectContaining({ isStreaming: false, isFinal: true }),
        ]);
        expect(contentDiv.classList.contains('msg-content-streaming')).toBe(false);
    });

    it('uses AMC-style rows, action rails, and content containers for normal messages', () => {
        const container = document.createElement('div');

        const aiController = appendMessage(container, 'Assistant answer', 'ai', null, '', null, {
            autoScroll: false,
        });
        const userController = appendMessage(container, 'User question', 'user', null, '', null, {
            autoScroll: false,
            onEdit: vi.fn(),
        });

        const aiRow = aiController.div.querySelector(':scope > .msg-row');
        expect(aiController.div.dataset.messageRole).toBe('model');
        expect(aiRow?.children[0]?.classList.contains('message-action-rail')).toBe(true);
        expect(aiRow?.children[1]?.classList.contains('message-content-container')).toBe(true);
        expect(aiController.div.querySelector('.message-avatar-ai')).not.toBeNull();
        expect(aiController.div.querySelector('.message-actions .copy-btn')).not.toBeNull();
        expect(aiController.div.querySelector(':scope > .copy-btn')).toBeNull();

        const userRow = userController.div.querySelector(':scope > .msg-row');
        expect(userController.div.dataset.messageRole).toBe('user');
        expect(userRow?.children[0]?.classList.contains('message-content-container')).toBe(true);
        expect(userRow?.children[1]?.classList.contains('message-action-rail')).toBe(true);
        expect(userController.div.querySelector('.message-avatar-user')).not.toBeNull();
        expect(userController.div.querySelector('.message-actions .copy-btn')).not.toBeNull();
        expect(userController.div.querySelector('.message-actions .edit-btn')).not.toBeNull();
    });

    it('aligns tool process cards with the assistant content column', () => {
        const container = document.createElement('div');

        const controller = appendMessage(container, '', 'user', null, null, null, {
            kind: 'tool-status',
            toolName: 'navigate_page',
            toolStatus: 'completed',
            autoScroll: false,
        });

        const row = controller.div.querySelector(':scope > .msg-row');
        expect(row?.classList.contains('tool-message-row')).toBe(true);
        expect(row?.children[0]?.classList.contains('tool-message-rail')).toBe(true);
        expect(row?.children[1]?.classList.contains('tool-message-content-container')).toBe(true);
        expect(controller.div.querySelector('.message-avatar')).toBeNull();
        expect(controller.div.querySelector('.message-actions .copy-btn')).toBeNull();
        expect(renderContent).toHaveBeenLastCalledWith(
            expect.any(HTMLDivElement),
            '',
            'tool-status',
            expect.objectContaining({ toolName: 'navigate_page' })
        );
    });

    it('groups consecutive normal messages from the same role like AMC', () => {
        const container = document.createElement('div');

        const firstAi = appendMessage(container, 'First assistant answer', 'ai', null, '', null, {
            autoScroll: false,
        });
        const secondAi = appendMessage(
            container,
            'Follow-up assistant answer',
            'ai',
            null,
            '',
            null,
            {
                autoScroll: false,
            }
        );
        const firstUser = appendMessage(container, 'First user message', 'user', null, '', null, {
            autoScroll: false,
            onEdit: vi.fn(),
        });
        const secondUser = appendMessage(
            container,
            'Follow-up user message',
            'user',
            null,
            '',
            null,
            {
                autoScroll: false,
                onEdit: vi.fn(),
            }
        );

        expect(firstAi.div.classList.contains('msg-grouped')).toBe(false);
        expect(secondAi.div.classList.contains('msg-grouped')).toBe(true);
        expect(firstUser.div.classList.contains('msg-grouped')).toBe(false);
        expect(secondUser.div.classList.contains('msg-grouped')).toBe(true);
    });
});

describe('appendMessage artifact cleanup', () => {
    function plantFakeArtifact(messageDiv) {
        const artifact = document.createElement('div');
        artifact.setAttribute('data-live-artifact-enhanced', 'true');
        const cleanup = vi.fn();
        artifact.__liveArtifactCleanup = cleanup;
        messageDiv.appendChild(artifact);
        return cleanup;
    }

    it('releases artifact resources when the delete button removes the message', () => {
        const container = document.createElement('div');
        const controller = appendMessage(container, 'hello', 'ai', null, '', null, {
            autoScroll: false,
        });
        const cleanup = plantFakeArtifact(controller.div);

        container.querySelector('.delete-btn').click();

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(controller.div.isConnected).toBe(false);
    });

    it('releases artifact resources on dispose', () => {
        const container = document.createElement('div');
        const controller = appendMessage(container, 'hello', 'ai', null, '', null, {
            autoScroll: false,
        });
        const cleanup = plantFakeArtifact(controller.div);

        controller.dispose();

        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
