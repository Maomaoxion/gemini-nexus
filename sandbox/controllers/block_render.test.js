// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendMessage } from '../render/message.js';
import { appendTextBlockToHistory, appendToolBlockToHistory } from './block_render.js';

vi.mock('../render/message.js', () => ({
    appendMessage: vi.fn(() => ({ fallback: true })),
}));

describe('appendTextBlockToHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('appends the text block to the active turn and passes options through', () => {
        const controller = { div: document.createElement('div') };
        const turnView = { appendTextBlock: vi.fn(() => controller) };
        const options = { text: 'Answer', thoughts: 'Thinking', isStreaming: true };

        const result = appendTextBlockToHistory(turnView, document.createElement('div'), options);

        expect(turnView.appendTextBlock).toHaveBeenCalledWith(options);
        expect(result).toBe(controller);
        expect(appendMessage).not.toHaveBeenCalled();
    });

    it('falls back to an AI message carrying the text block fields', () => {
        const historyDiv = document.createElement('div');
        const sources = [{ title: 'Example', url: 'https://example.com' }];
        const options = {
            text: 'Answer',
            attachment: ['image.png'],
            thoughts: 'Thinking',
            sources,
            isFinal: true,
        };

        appendTextBlockToHistory(null, historyDiv, options);

        expect(appendMessage).toHaveBeenCalledWith(
            historyDiv,
            'Answer',
            'ai',
            ['image.png'],
            'Thinking',
            sources,
            options
        );
    });

    it('normalizes missing text block fields in the fallback', () => {
        const historyDiv = document.createElement('div');
        const options = { isStreaming: true };

        appendTextBlockToHistory(undefined, historyDiv, options);

        expect(appendMessage).toHaveBeenCalledWith(historyDiv, '', 'ai', null, '', null, options);
    });
});

describe('appendToolBlockToHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('appends the tool block to the active turn and returns its controller', () => {
        const controller = { div: document.createElement('div') };
        const turnView = { appendToolBlock: vi.fn(() => controller) };
        const options = { text: 'Tool output', kind: 'tool-output' };

        const result = appendToolBlockToHistory(turnView, document.createElement('div'), options);

        expect(turnView.appendToolBlock).toHaveBeenCalledWith(options);
        expect(result).toBe(controller);
        expect(appendMessage).not.toHaveBeenCalled();
    });

    it('falls back to a user message carrying the tool attachment', () => {
        const historyDiv = document.createElement('div');
        const options = { text: 'Tool output', attachment: ['image.png'], kind: 'tool-output' };

        appendToolBlockToHistory(null, historyDiv, options);

        expect(appendMessage).toHaveBeenCalledWith(
            historyDiv,
            'Tool output',
            'user',
            ['image.png'],
            null,
            null,
            options
        );
    });
});
