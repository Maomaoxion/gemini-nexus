import { formatT, t } from '../../../core/i18n.js';
import { DOM_IDS } from '../constants.js';
import { getSettingsElement } from '../dom.js';
import {
    formatStorageBytes,
    selectSessionsOlderThan,
} from '../../../core/session_storage_report.js';

const CLEANUP_OLD_SESSION_DAYS = 90;

export class DataManagementSection {
    constructor(callbacks) {
        this.callbacks = callbacks || {};
        this.elements = {};
        this.sessionReport = null;
        this.selectedSessionIds = new Set();
        this.managerOpen = false;
        this.queryElements();
        this.bindEvents();
        this.renderSessionStorage();
    }

    queryElements() {
        this.elements = {
            btnDownloadLogs: getSettingsElement(DOM_IDS.DOWNLOAD_LOGS),
            btnExportHistory: getSettingsElement(DOM_IDS.EXPORT_HISTORY_DATA),
            btnImportHistory: getSettingsElement(DOM_IDS.IMPORT_HISTORY_DATA),
            inputImportHistory: getSettingsElement(DOM_IDS.IMPORT_HISTORY_FILE),
            btnExportSettings: getSettingsElement(DOM_IDS.EXPORT_SETTINGS_DATA),
            btnImportSettings: getSettingsElement(DOM_IDS.IMPORT_SETTINGS_DATA),
            inputImportSettings: getSettingsElement(DOM_IDS.IMPORT_SETTINGS_FILE),
            btnManageSessions: getSettingsElement(DOM_IDS.MANAGE_SESSIONS),
            sessionSummary: getSettingsElement(DOM_IDS.SESSION_STORAGE_SUMMARY),
            sessionPanel: getSettingsElement(DOM_IDS.SESSION_STORAGE_PANEL),
            sessionList: getSettingsElement(DOM_IDS.SESSION_STORAGE_LIST),
            sessionEmpty: getSettingsElement(DOM_IDS.SESSION_STORAGE_EMPTY),
            sessionStatus: getSettingsElement(DOM_IDS.SESSION_STORAGE_STATUS),
            sessionSelectAll: getSettingsElement(DOM_IDS.SESSION_STORAGE_SELECT_ALL),
            btnDeleteSelected: getSettingsElement(DOM_IDS.DELETE_SELECTED_SESSIONS),
            btnCleanupOld: getSettingsElement(DOM_IDS.CLEANUP_OLD_SESSIONS),
        };
    }

    bindEvents() {
        if (this.elements.btnDownloadLogs) {
            this.elements.btnDownloadLogs.addEventListener('click', () => {
                if (this.callbacks.onDownloadLogs) this.callbacks.onDownloadLogs();
            });
        }

        if (this.elements.btnExportHistory) {
            this.elements.btnExportHistory.addEventListener('click', () => {
                if (this.callbacks.onExportHistory) this.callbacks.onExportHistory();
            });
        }

        if (this.elements.btnImportHistory && this.elements.inputImportHistory) {
            this.elements.btnImportHistory.addEventListener('click', () => {
                this.elements.inputImportHistory.click();
            });
            this.elements.inputImportHistory.addEventListener('change', () => {
                this.importJsonFile(this.elements.inputImportHistory, (payload) => {
                    if (this.callbacks.onImportHistory) this.callbacks.onImportHistory(payload);
                });
            });
        }

        if (this.elements.btnExportSettings) {
            this.elements.btnExportSettings.addEventListener('click', () => {
                if (this.callbacks.onExportSettings) this.callbacks.onExportSettings();
            });
        }

        if (this.elements.btnImportSettings && this.elements.inputImportSettings) {
            this.elements.btnImportSettings.addEventListener('click', () => {
                this.elements.inputImportSettings.click();
            });
            this.elements.inputImportSettings.addEventListener('change', () => {
                this.importJsonFile(this.elements.inputImportSettings, (payload) => {
                    if (this.callbacks.onImportSettings) this.callbacks.onImportSettings(payload);
                });
            });
        }

        const {
            btnManageSessions,
            sessionSelectAll,
            btnDeleteSelected,
            btnCleanupOld,
            sessionList,
        } = this.elements;

        if (btnManageSessions) {
            btnManageSessions.addEventListener('click', () => this.toggleSessionManager());
        }
        if (sessionSelectAll) {
            sessionSelectAll.addEventListener('change', () => {
                this.setAllSessionsSelected(sessionSelectAll.checked);
            });
        }
        if (btnDeleteSelected) {
            btnDeleteSelected.addEventListener('click', () => this.deleteSelectedSessions());
        }
        if (btnCleanupOld) {
            btnCleanupOld.addEventListener('click', () => this.cleanupOldSessions());
        }
        if (sessionList) {
            sessionList.addEventListener('change', (changeEvent) => {
                this.handleSessionSelectionChange(changeEvent);
            });
        }
    }

    requestSessionStorageReport() {
        if (this.callbacks.onRequestSessionStorageReport) {
            this.callbacks.onRequestSessionStorageReport();
        }
    }

    toggleSessionManager(forceOpen = null) {
        this.managerOpen = forceOpen === null ? !this.managerOpen : forceOpen === true;

        if (this.elements.sessionPanel) {
            this.elements.sessionPanel.hidden = !this.managerOpen;
        }
        if (this.elements.btnManageSessions) {
            this.elements.btnManageSessions.setAttribute(
                'aria-expanded',
                this.managerOpen ? 'true' : 'false'
            );
        }
        if (this.managerOpen) {
            this.setStatus('');
            this.requestSessionStorageReport();
        }

        this.renderSessionStorage();
    }

    setSessionStorageReport(report) {
        this.sessionReport = report && Array.isArray(report.sessions) ? report : null;

        const availableIds = new Set((this.sessionReport?.sessions || []).map((entry) => entry.id));
        for (const sessionId of Array.from(this.selectedSessionIds)) {
            if (!availableIds.has(sessionId)) this.selectedSessionIds.delete(sessionId);
        }

        this.renderSessionStorage();
    }

    getSelectedSessionIds() {
        return Array.from(this.selectedSessionIds);
    }

    setStatus(message) {
        const status = this.elements.sessionStatus;
        if (!status) return;

        status.textContent = message || '';
        status.hidden = !message;
    }

    renderSessionStorage() {
        this.renderSessionSummary();

        if (this.managerOpen) {
            this.renderSessionList();
        }
        this.syncSessionSelectionControls();
    }

    renderSessionSummary() {
        const summary = this.elements.sessionSummary;
        if (!summary) return;

        const totals = this.sessionReport?.totals;
        summary.textContent = totals
            ? formatT('sessionStorageSummary', {
                  count: totals.sessionCount,
                  size: formatStorageBytes(totals.totalBytes),
                  images: formatStorageBytes(totals.imageBytes),
              })
            : t('sessionStorageLoading');
    }

    renderSessionList() {
        const { sessionList, sessionEmpty } = this.elements;
        const entries = this.sessionReport?.sessions || [];

        if (sessionEmpty) {
            sessionEmpty.hidden = entries.length > 0;
        }
        if (sessionList) {
            sessionList.replaceChildren(...entries.map((entry) => this.createSessionRow(entry)));
        }
    }

    createSessionRow(entry) {
        const item = document.createElement('li');
        item.className = 'session-storage-row';

        const label = document.createElement('label');
        label.className = 'session-storage-row-label';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'session-storage-row-check';
        checkbox.value = entry.id;
        checkbox.checked = this.selectedSessionIds.has(entry.id);

        const body = document.createElement('span');
        body.className = 'session-storage-row-body';

        const title = document.createElement('span');
        title.className = 'session-storage-row-title';
        title.textContent = entry.title || t('newChat');

        const meta = document.createElement('span');
        meta.className = 'session-storage-row-meta';
        meta.textContent = this.formatSessionRowMeta(entry);

        body.appendChild(title);
        body.appendChild(meta);
        label.appendChild(checkbox);
        label.appendChild(body);
        item.appendChild(label);

        return item;
    }

    formatSessionRowMeta(entry) {
        const parts = [
            formatT('sessionRowMeta', {
                messages: entry.messageCount,
                size: formatStorageBytes(entry.bytes),
            }),
        ];

        if (entry.imageBytes > 0) {
            parts.push(formatStorageBytes(entry.imageBytes));
        }
        if (entry.updatedAt > 0) {
            parts.push(new Date(entry.updatedAt).toLocaleDateString());
        }

        return parts.join(' · ');
    }

    handleSessionSelectionChange(changeEvent) {
        const target = changeEvent.target;
        if (!target || target.type !== 'checkbox' || !target.value) return;

        if (target.checked) {
            this.selectedSessionIds.add(target.value);
        } else {
            this.selectedSessionIds.delete(target.value);
        }

        this.syncSessionSelectionControls();
    }

    setAllSessionsSelected(selected) {
        this.selectedSessionIds.clear();

        if (selected) {
            for (const entry of this.sessionReport?.sessions || []) {
                this.selectedSessionIds.add(entry.id);
            }
        }

        if (this.managerOpen) {
            this.renderSessionList();
        }
        this.syncSessionSelectionControls();
    }

    syncSessionSelectionControls() {
        const { sessionSelectAll, btnDeleteSelected } = this.elements;
        const sessionCount = this.sessionReport?.sessions?.length || 0;
        const selectedCount = this.selectedSessionIds.size;

        if (sessionSelectAll) {
            sessionSelectAll.checked = sessionCount > 0 && selectedCount === sessionCount;
            sessionSelectAll.indeterminate = selectedCount > 0 && selectedCount < sessionCount;
            sessionSelectAll.disabled = sessionCount === 0;
        }
        if (btnDeleteSelected) {
            btnDeleteSelected.disabled = selectedCount === 0;
        }
    }

    async deleteSelectedSessions() {
        const sessionIds = this.getSelectedSessionIds();
        if (sessionIds.length === 0) return;

        if (!confirm(formatT('sessionDeleteConfirm', { count: sessionIds.length }))) return;

        await this.runSessionDeletion(sessionIds);
    }

    async cleanupOldSessions() {
        const sessionIds = selectSessionsOlderThan(this.sessionReport, CLEANUP_OLD_SESSION_DAYS);
        if (sessionIds.length === 0) {
            this.setStatus(formatT('noOldSessions', { days: CLEANUP_OLD_SESSION_DAYS }));
            return;
        }

        if (!confirm(formatT('cleanupOldConfirm', { days: CLEANUP_OLD_SESSION_DAYS }))) return;

        await this.runSessionDeletion(sessionIds);
    }

    async runSessionDeletion(sessionIds) {
        const result = await Promise.resolve(this.callbacks.onDeleteSessions?.(sessionIds) || {});

        this.selectedSessionIds.clear();

        const messages = [
            formatT('sessionDeletedSummary', {
                count: Number.isFinite(result.deletedCount) ? result.deletedCount : 0,
            }),
        ];
        if (result.skippedGenerating) messages.push(t('sessionDeleteSkipped'));
        this.setStatus(messages.join(' '));

        this.syncSessionSelectionControls();
    }

    importJsonFile(input, onLoaded) {
        const file = input?.files?.[0];
        if (!file) return;

        const resetInput = () => {
            input.value = '';
        };
        const fail = () => {
            alert(t('dataImportFailed'));
            resetInput();
        };

        try {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const payload = JSON.parse(String(reader.result || ''));
                    onLoaded(payload);
                    resetInput();
                } catch {
                    fail();
                }
            };
            reader.onerror = fail;
            reader.readAsText(file);
        } catch {
            fail();
        }
    }
}
