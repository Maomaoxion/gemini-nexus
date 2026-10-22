import { appendMessage, createMessageActionRail } from './message.js';
import { createCopyButton } from './copy_button.js';
import { cleanupLiveArtifacts } from './artifacts.js';
import { t } from '../core/i18n.js';
import { TemplateIcons } from '../ui/templates/icons.js';

/**
 * One user turn renders as a single AI message: one avatar and one action rail
 * for the whole turn, with text/tool blocks stacked inside its content area.
 * Message rows stay split in storage because the model protocol needs tool
 * results as separate turns; this view is what makes them read as one answer.
 */
export function createTurnMessage(container, options = {}) {
    const messageElement = document.createElement('div');
    messageElement.className = 'msg ai turn-message';

    const row = document.createElement('div');
    row.className = 'msg-row';

    const rail = createMessageActionRail('ai');
    const contentHost = document.createElement('div');
    contentHost.className = 'message-content-container turn-content';

    row.appendChild(rail);
    row.appendChild(contentHost);
    messageElement.appendChild(row);
    if (container) container.appendChild(messageElement);

    const actions = rail.querySelector('.message-actions');
    const textBlocks = [];
    let copyBtn = null;
    let retryBtn = null;
    let deleteBtn = null;
    let onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;
    let onDelete = typeof options.onDelete === 'function' ? options.onDelete : null;

    const getCopyText = () => {
        return Array.from(contentHost.querySelectorAll('.msg.ai .msg-content'))
            .map((node) => (node.innerText || node.textContent || '').trim())
            .filter(Boolean)
            .join('\n\n');
    };

    const syncCopyButton = () => {
        const text = getCopyText();
        if (text && !copyBtn) {
            copyBtn = createCopyButton(getCopyText);
            actions.prepend(copyBtn);
        } else if (!text && copyBtn) {
            copyBtn.remove();
            copyBtn = null;
        }
    };

    const syncActionButtons = () => {
        if (!retryBtn) {
            retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'retry-btn';
            retryBtn.title = t('retryButtonTitle');
            retryBtn.setAttribute('aria-label', t('retryButtonTitle'));
            retryBtn.innerHTML = TemplateIcons.REFRESH;
            retryBtn.disabled = true;
            retryBtn.addEventListener('click', () => {
                if (retryBtn?.disabled) return;
                if (onRetry) onRetry();
            });
            actions.appendChild(retryBtn);
        }

        if (!deleteBtn) {
            deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'delete-btn';
            deleteBtn.title = t('delete');
            deleteBtn.setAttribute('aria-label', t('delete'));
            deleteBtn.innerHTML = TemplateIcons.TRASH;
            deleteBtn.addEventListener('click', () => {
                if (onDelete) {
                    onDelete();
                    return;
                }
                cleanupLiveArtifacts(messageElement);
                messageElement.remove();
            });
            actions.appendChild(deleteBtn);
        }
    };

    syncActionButtons();

    const removeBlockRail = (controller) => {
        controller?.div?.querySelector?.('.msg-row > .message-action-rail')?.remove();
    };

    const controller = {
        el: messageElement,
        contentEl: contentHost,
        appendTextBlock(blockOptions = {}) {
            const { onRetry: ignoredRetry, onDelete: ignoredDelete, ...blockRest } = blockOptions;
            const block = appendMessage(
                contentHost,
                blockRest.text || '',
                'ai',
                blockRest.attachment || null,
                blockRest.thoughts || '',
                blockRest.sources || null,
                {
                    ...blockRest,
                    suppressCopy: true,
                    // The turn content is not a scroll container; the chat
                    // history owns scrolling after blocks are appended.
                    autoScroll: false,
                }
            );
            removeBlockRail(block);
            const syncAfter =
                (fn) =>
                (...args) => {
                    const result = fn(...args);
                    syncCopyButton();
                    return result;
                };
            if (typeof block.update === 'function') block.update = syncAfter(block.update);
            if (typeof block.finalize === 'function') block.finalize = syncAfter(block.finalize);
            textBlocks.push(block);
            syncCopyButton();
            return block;
        },
        appendToolBlock(blockOptions = {}) {
            const block = appendMessage(
                contentHost,
                blockOptions.text || '',
                'user',
                blockOptions.attachment || null,
                null,
                null,
                {
                    ...blockOptions,
                    kind: blockOptions.kind || 'tool-output',
                    autoScroll: false,
                }
            );
            removeBlockRail(block);
            return block;
        },
        getLastTextBlock() {
            return textBlocks[textBlocks.length - 1] || null;
        },
        setRetryHandler(handler) {
            onRetry = typeof handler === 'function' ? handler : null;
            if (retryBtn) retryBtn.disabled = !onRetry;
        },
        setDeleteHandler(handler) {
            onDelete = typeof handler === 'function' ? handler : null;
        },
        syncCopyButton,
        dispose() {
            cleanupLiveArtifacts(messageElement);
        },
    };

    return controller;
}
