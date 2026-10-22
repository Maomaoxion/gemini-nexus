import { appendMessage } from '../render/message.js';
import { appendTextBlockToHistory, appendToolBlockToHistory } from './block_render.js';
import { appendContextCompressionNotice } from '../render/context_compression.js';
import { copyToClipboard } from '../render/clipboard.js';
import {
    downloadTextFile,
    sendToBackground,
    saveGroupsToStorage,
    saveSessionsToStorage,
} from '../../shared/messaging/index.js';
import { hasDisplayableText, hasDisplayableThoughts } from '../core/displayable_content.js';
import { stripToolCallMarkup } from '../../shared/text/tool_call_text.js';
import { t } from '../core/i18n.js';
import {
    buildSessionExportFilename,
    buildSessionTextExport,
    serializeSessionForExport,
} from '../core/session_export.js';
import { isToolOutputText, parseToolOutputHeader } from '../../shared/text/tool_call_text.js';

export class SessionFlowController {
    constructor(sessionManager, uiController, appController) {
        this.sessionManager = sessionManager;
        this.ui = uiController;
        this.app = appController;
    }

    handleNewChat() {
        this.enterDraft();
    }

    enterDraft() {
        this.app.messageHandler.resetStream();
        this.sessionManager.enterDraft();
        this.app.boundSessionId = null;
        this.app.saveCurrentTabSessionBinding(null);
        sendToBackground({ action: 'RESET_CONTEXT' });
        this.ui.clearChatHistory();
        this.ui.resetInput();
        this.refreshHistoryUI();
    }

    switchToSession(sessionId, options = {}) {
        const previousSessionId = this.sessionManager.currentSessionId;
        const isSameSession = previousSessionId === sessionId;

        this.app.messageHandler.resetStream();
        this.sessionManager.setCurrentId(sessionId);

        const session = this.sessionManager.getCurrentSession();
        if (!session) return;

        this.ui.clearChatHistory();
        const historyDiv = this.ui.historyDiv;
        // Suppress per-message entrance animation for the bulk rebuild; drop
        // the flag on the next frame so live replies animate again.
        if (historyDiv) historyDiv.setAttribute('data-restoring', '');
        const finishRestore = () => {
            if (!historyDiv) return;
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => historyDiv.removeAttribute('data-restoring'));
            } else {
                historyDiv.removeAttribute('data-restoring');
            }
        };
        const compressionNoticeIndex = this.getCompressionNoticeIndex(session);
        let turnView = null;
        let turnStartIndex = -1;
        try {
            session.messages.forEach((message, index) => {
                if (this.shouldSkipRestoredMessage(message)) return;

                const kind = this.getMessageKind(message);
                const startsUserTurn = message.role === 'user' && kind !== 'tool-output';

                if (startsUserTurn) {
                    if (turnView?.el && !turnView.contentEl?.childElementCount) {
                        turnView.el.remove();
                    }

                    if (index === compressionNoticeIndex) {
                        this.appendRestoredCompressionNotice(this.ui.historyDiv);
                    }

                    turnStartIndex = index;
                    const attachment = message.attachments || message.image;
                    appendMessage(
                        this.ui.historyDiv,
                        message.text,
                        'user',
                        attachment,
                        message.thoughts,
                        message.sources,
                        {
                            onEdit: this.app.prompt.getMessageEditOptions(index).onEdit,
                            onRetry: null,
                            onDelete:
                                this.app.prompt?.getTurnDeleteOptions?.(index)?.onDelete ||
                                this.app.prompt?.getMessageDeleteOptions?.(index)?.onDelete ||
                                null,
                            autoScroll: false,
                        }
                    );
                    turnView =
                        this.ui.chat?.beginTurn?.({
                            onDelete:
                                this.app.prompt?.getTurnDeleteOptions?.(turnStartIndex)?.onDelete ||
                                null,
                        }) || null;
                    return;
                }

                if (!turnView) {
                    turnView = this.ui.chat?.beginTurn?.() || null;
                }

                if (index === compressionNoticeIndex) {
                    this.appendRestoredCompressionNotice(this.ui.historyDiv);
                }

                if (kind === 'tool-output' || kind === 'tool-status') {
                    const toolBlockOptions = {
                        text: message.text,
                        attachment: message.attachments || message.image || null,
                        kind,
                        toolName: this.getRestoredToolName(message),
                        step: this.getRestoredToolStep(message),
                        toolStatus: this.getRestoredToolStatus(message),
                        toolCallText: this.getRestoredToolCallText(message),
                        callIndex: this.getRestoredToolCallIndex(message),
                        callCount: this.getRestoredToolCallCount(message),
                        toolDurationMs: this.getRestoredToolDurationMs(message),
                        isCollapsed: true,
                        autoScroll: false,
                    };
                    appendToolBlockToHistory(turnView, this.ui.historyDiv, toolBlockOptions);
                    return;
                }

                if (message.role === 'ai') {
                    const textBlockOptions = {
                        text: stripToolCallMarkup(message.text),
                        attachment: message.generatedImages,
                        thoughts: message.thoughts,
                        sources: message.sources,
                        suppressCopy: message.suppressCopy === true,
                        isCollapsed: true,
                        thoughtsDurationSeconds: message.thoughtsDurationSeconds,
                        autoScroll: false,
                        onRetry:
                            message.kind !== 'tool-status'
                                ? this.app.prompt?.getMessageRetryOptions?.(index)?.onRetry || null
                                : null,
                        onDelete:
                            this.app.prompt?.getMessageDeleteOptions?.(index)?.onDelete || null,
                    };
                    appendTextBlockToHistory(turnView, this.ui.historyDiv, textBlockOptions);
                    turnView?.setRetryHandler?.(
                        this.app.prompt?.getMessageRetryOptions?.(index)?.onRetry || null
                    );
                }
            });
            if (compressionNoticeIndex === session.messages.length) {
                this.appendRestoredCompressionNotice(this.ui.historyDiv);
            }
        } finally {
            finishRestore();
        }
        this.ui.setTurnView?.(turnView);
        this.app.messageHandler.restoreStreamForSession(sessionId);
        if (options.restoreScrollState && this.ui.restoreChatScrollState) {
            this.ui.restoreChatScrollState(options.restoreScrollState);
        } else {
            // Opening a conversation should land on the newest content, not the
            // start of the final (possibly very long) turn.
            this.ui.scrollToBottom({
                ...(options.scrollOptions || {}),
                mode: 'bottom',
                force: true,
            });
        }

        this.app.boundSessionId = sessionId;
        this.app.saveCurrentTabSessionBinding(sessionId);

        // Only sync background auth context when actually changing sessions
        // (or when forced). Re-selecting the current session must not fire
        // RESET_CONTEXT — that clears live Web tokens and rotates multi-account
        // pointers. New-chat still uses enterDraft() which always resets.
        if (!isSameSession || options.forceContextSync === true) {
            if (session.context) {
                sendToBackground({
                    action: 'SET_CONTEXT',
                    context: session.context,
                    model: this.app.getSelectedModel(),
                });
            } else {
                sendToBackground({ action: 'RESET_CONTEXT' });
            }
        }

        this.refreshHistoryUI();
        this.ui.resetInput();
    }

    refreshHistoryUI() {
        this.ui.renderHistoryList(
            this.sessionManager.getSortedSessions(),
            this.sessionManager.getSortedGroups(),
            this.sessionManager.currentSessionId,
            {
                onSwitch: (id) => this.switchToSession(id),
                onDelete: (id) => this.handleDeleteSession(id),
                onRename: (id, title) => this.handleRenameSession(id, title),
                onTogglePin: (id) => this.handleTogglePinSession(id),
                onDuplicate: (id) => this.handleDuplicateSession(id),
                onShare: (id) => this.handleShareSession(id),
                onExport: (id, format) => this.handleExportSession(id, format),
                onAddGroup: () => this.handleAddNewGroup(),
                onDeleteGroup: (id) => this.handleDeleteGroup(id),
                onRenameGroup: (id, title) => this.handleRenameGroup(id, title),
                onMoveSessionToGroup: (sessionId, groupId) =>
                    this.handleMoveSessionToGroup(sessionId, groupId),
                onToggleGroupExpansion: (id) => this.handleToggleGroupExpansion(id),
            },
            {
                isGenerating: this.app.isGenerating,
                generatingSessionId: this.app.generatingSessionId,
            }
        );
    }

    shouldSkipRestoredMessage(message) {
        if (!message) return false;
        if (message.officialContent && !this.hasDisplayableRestoredContent(message)) return true;
        if (message.role !== 'ai') return false;
        return !this.hasDisplayableRestoredContent(message);
    }

    hasDisplayableRestoredContent(message) {
        const hasGeneratedImages =
            Array.isArray(message.generatedImages) && message.generatedImages.length > 0;
        const hasSources = Array.isArray(message.sources) && message.sources.length > 0;
        return (
            hasDisplayableText(stripToolCallMarkup(message.text)) ||
            hasDisplayableThoughts(message.thoughts) ||
            hasGeneratedImages ||
            hasSources
        );
    }

    getMessageKind(message) {
        if (!message || message.role !== 'user' || typeof message.text !== 'string') {
            return null;
        }
        if (message.kind === 'tool-output') return 'tool-output';
        return isToolOutputText(message.text) ? 'tool-output' : null;
    }

    getRestoredToolName(message) {
        if (this.getMessageKind(message) !== 'tool-output') return '';
        if (message.toolName) return message.toolName;
        return parseToolOutputHeader(message.text).toolName;
    }

    getRestoredToolStep(message) {
        if (this.getMessageKind(message) !== 'tool-output') return '';
        if (message.toolStep) return message.toolStep;
        const match = message.text.match(/\n\n\[Proceeding to step\s+(\d+)\]\s*$/);
        return match ? match[1] : '';
    }

    getRestoredToolStatus(message) {
        if (this.getMessageKind(message) !== 'tool-output') return 'completed';
        return message.toolStatus || 'completed';
    }

    getRestoredToolCallText(message) {
        if (this.getMessageKind(message) !== 'tool-output') return '';
        return message.toolCallText || '';
    }

    getRestoredToolCallIndex(message) {
        if (this.getMessageKind(message) !== 'tool-output') return '';
        return message.toolCallIndex || '';
    }

    getRestoredToolCallCount(message) {
        if (this.getMessageKind(message) !== 'tool-output') return '';
        return message.toolCallCount || '';
    }

    getRestoredToolDurationMs(message) {
        if (this.getMessageKind(message) !== 'tool-output') return null;
        return Number.isFinite(message.toolDurationMs) ? message.toolDurationMs : null;
    }

    getCompressionNoticeIndex(session) {
        const sourceMessageCount = session?.contextSummary?.sourceMessageCount;
        if (!Number.isInteger(sourceMessageCount) || sourceMessageCount <= 0) return -1;
        const messageCount = Array.isArray(session.messages) ? session.messages.length : 0;
        return Math.min(sourceMessageCount, messageCount);
    }

    appendRestoredCompressionNotice(container = this.ui.historyDiv) {
        appendContextCompressionNotice(container || this.ui.historyDiv, t('contextCompressed'), {
            complete: true,
            scroll: false,
        });
    }

    handleDeleteSession(sessionId) {
        const switchNeeded = this.sessionManager.deleteSession(sessionId);
        saveSessionsToStorage(this.sessionManager.getPersistableSessions(), {
            type: 'deleteSession',
            sessionId,
        });

        // If we deleted the session that is currently generating, drop the
        // generating-session guard so the partial reply is not silently
        // discarded by isGeneratingSessionMessage() — and any late stream
        // update / GEMINI_REPLY for the deleted session is ignored cleanly
        // rather than filtered into the void. We do NOT keep the partial
        // streaming bubble (it belongs to a session that no longer exists),
        // but we must not leave the UI pinned to a dead generatingSessionId.
        if (this.app.generatingSessionId === sessionId) {
            this.app.prompt?.forceClearGenerating?.();
        }

        if (switchNeeded) {
            if (this.sessionManager.sessions.length > 0) {
                this.switchToSession(this.sessionManager.currentSessionId);
            } else {
                this.enterDraft();
            }
        } else {
            this.refreshHistoryUI();
        }
    }

    /**
     * Bulk chat cleanup from the settings panel.
     * The session that is currently generating is always kept, so a cleanup
     * never discards a reply that is still streaming in.
     * @returns {{deletedCount: number, skippedGenerating: boolean}}
     */
    handleDeleteSessions(sessionIds) {
        const requested = (Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean);
        if (requested.length === 0) return { deletedCount: 0, skippedGenerating: false };

        const generatingSessionId = this.app.generatingSessionId;
        const deletable = requested.filter((id) => id !== generatingSessionId);
        const skippedGenerating = deletable.length !== requested.length;
        if (deletable.length === 0) return { deletedCount: 0, skippedGenerating };

        const { deletedCount, wasCurrent } = this.sessionManager.deleteSessions(deletable);
        saveSessionsToStorage(this.sessionManager.getPersistableSessions(), {
            type: 'deleteSessions',
            sessionIds: deletable,
        });

        if (wasCurrent) {
            if (this.sessionManager.sessions.length > 0) {
                this.switchToSession(this.sessionManager.currentSessionId);
            } else {
                this.enterDraft();
            }
        } else {
            this.refreshHistoryUI();
        }

        return { deletedCount, skippedGenerating };
    }

    handleRenameSession(sessionId, title) {
        if (!this.sessionManager.updateSessionTitle(sessionId, title)) return;

        saveSessionsToStorage(this.sessionManager.getPersistableSessions(), {
            type: 'updateSessionMetadata',
            sessionId,
            fields: ['title'],
        });
        this.refreshHistoryUI();
    }

    handleTogglePinSession(sessionId) {
        if (!this.sessionManager.toggleSessionPinned(sessionId)) return;

        saveSessionsToStorage(this.sessionManager.getPersistableSessions(), {
            type: 'updateSessionMetadata',
            sessionId,
            fields: ['isPinned'],
        });
        this.refreshHistoryUI();
    }

    handleDuplicateSession(sessionId) {
        const duplicated = this.sessionManager.duplicateSession(sessionId, (title) => {
            const template = t('duplicateChatTitle');
            return template.includes('{title}')
                ? template.replace('{title}', title)
                : `${title} copy`;
        });
        if (!duplicated) return;

        saveSessionsToStorage(this.sessionManager.getPersistableSessions(), {
            type: 'upsertSession',
            sessionId: duplicated.id,
        });
        this.refreshHistoryUI();
    }

    async handleShareSession(sessionId) {
        const session = this.sessionManager.getSessionById(sessionId);
        if (!session) return;

        try {
            await copyToClipboard(
                buildSessionTextExport(session, {
                    labels: this.getExportTextLabels(),
                    exportedAt: new Date().toISOString(),
                })
            );
            this.ui.updateStatus?.(t('shareChatCopied'));
            setTimeout(() => this.ui.updateStatus?.(''), 2000);
        } catch (error) {
            console.error('Failed to copy share text', error);
            this.ui.updateStatus?.(t('shareChatFailed'));
            setTimeout(() => this.ui.updateStatus?.(''), 3000);
        }
    }

    handleExportSession(sessionId, format) {
        const session = this.sessionManager.getSessionById(sessionId);
        if (!session) return;

        const exportFormat = format === 'json' ? 'json' : 'txt';
        const exportDate = new Date();
        const filename = buildSessionExportFilename(session, exportFormat, exportDate);
        if (exportFormat === 'json') {
            downloadTextFile(
                JSON.stringify(
                    serializeSessionForExport(session, exportDate.toISOString()),
                    null,
                    2
                ),
                filename,
                'application/json'
            );
            return;
        }

        downloadTextFile(
            buildSessionTextExport(session, {
                labels: this.getExportTextLabels(),
                exportedAt: exportDate.toISOString(),
            }),
            filename,
            'text/plain'
        );
    }

    getExportTextLabels() {
        return {
            userRole: t('exportRoleUser'),
            assistantRole: t('exportRoleAssistant'),
            title: t('exportTitle'),
            exportedAt: t('exportedAt'),
            messages: t('exportMessages'),
            attachments: t('exportAttachments'),
            generatedImages: t('exportGeneratedImages'),
            sources: t('exportSources'),
            thoughts: t('exportThoughts'),
        };
    }

    handleAddNewGroup() {
        this.sessionManager.createGroup(t('newGroupTitle'));
        saveGroupsToStorage(this.sessionManager.getPersistableGroups());
        this.refreshHistoryUI();
    }

    handleDeleteGroup(groupId) {
        if (!this.sessionManager.deleteGroup(groupId)) return;

        saveGroupsToStorage(this.sessionManager.getPersistableGroups());
        saveSessionsToStorage(this.sessionManager.getPersistableSessions(), {
            type: 'updateSessionGroups',
        });
        this.refreshHistoryUI();
    }

    handleRenameGroup(groupId, title) {
        if (!this.sessionManager.updateGroupTitle(groupId, title)) return;

        saveGroupsToStorage(this.sessionManager.getPersistableGroups());
        this.refreshHistoryUI();
    }

    handleMoveSessionToGroup(sessionId, groupId) {
        if (!this.sessionManager.moveSessionToGroup(sessionId, groupId)) return;

        saveSessionsToStorage(this.sessionManager.getPersistableSessions(), {
            type: 'updateSessionGroups',
        });
        this.refreshHistoryUI();
    }

    handleToggleGroupExpansion(groupId) {
        if (!this.sessionManager.toggleGroupExpansion(groupId)) return;

        saveGroupsToStorage(this.sessionManager.getPersistableGroups());
        this.refreshHistoryUI();
    }
}
