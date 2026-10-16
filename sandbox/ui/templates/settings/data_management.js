import { TemplateIcons } from '../icons.js';

export const DataManagementSettingsTemplate = `
<div class="setting-group data-management-group">
    <h4 data-i18n="dataManagement">Data Management</h4>

    <div class="data-management-shell">
        <div class="data-management-card">
            <div class="data-management-card-main">
                <span class="data-management-card-icon">${TemplateIcons.HISTORY}</span>
                <div class="data-management-card-copy">
                    <h5 data-i18n="historyDataTitle">Chat History</h5>
                    <p class="data-management-card-meta" id="session-storage-summary" data-i18n="sessionStorageLoading">Calculating…</p>
                </div>
            </div>
            <div class="data-management-card-actions">
                <button id="manage-sessions" type="button" class="data-action-btn data-action-btn-secondary" data-i18n-title="manageSessions" title="Manage sessions" aria-expanded="false" aria-controls="session-storage-panel">
                    <span class="data-action-icon">${TemplateIcons.SETTINGS}</span>
                    <span data-i18n="manageSessions">Manage</span>
                </button>
                <button id="export-history-data" type="button" class="data-action-btn data-action-btn-primary" data-i18n-title="exportHistoryData" title="Export History">
                    <span class="data-action-icon">${TemplateIcons.DOWNLOAD}</span>
                    <span data-i18n="exportHistoryData">Export History</span>
                </button>
                <button id="import-history-data" type="button" class="data-action-btn data-action-btn-danger" data-i18n-title="importHistoryData" title="Import History">
                    <span class="data-action-icon">${TemplateIcons.UPLOAD}</span>
                    <span data-i18n="importHistoryData">Import History</span>
                </button>
            </div>
        </div>

        <div class="session-storage-panel" id="session-storage-panel" hidden>
            <div class="session-storage-toolbar">
                <label class="session-storage-select-all">
                    <input type="checkbox" id="session-storage-select-all">
                    <span data-i18n="selectAllSessions">Select all</span>
                </label>
                <div class="session-storage-toolbar-actions">
                    <button id="cleanup-old-sessions" type="button" class="data-action-btn data-action-btn-secondary" data-i18n="cleanupOldSessions">Older than 90 days</button>
                    <button id="delete-selected-sessions" type="button" class="data-action-btn data-action-btn-danger" data-i18n="deleteSelectedSessions" disabled>Delete selected</button>
                </div>
            </div>
            <p class="session-storage-status" id="session-storage-status" role="status" aria-live="polite" hidden></p>
            <p class="session-storage-empty" id="session-storage-empty" data-i18n="noSavedSessions" hidden>No saved chats.</p>
            <ul class="session-storage-list" id="session-storage-list"></ul>
        </div>

        <div class="data-management-card">
            <div class="data-management-card-main">
                <span class="data-management-card-icon">${TemplateIcons.SETTINGS}</span>
                <div class="data-management-card-copy">
                    <h5 data-i18n="settingsDataTitle">Settings Backup</h5>
                </div>
            </div>
            <div class="data-management-card-actions">
                <button id="export-settings-data" type="button" class="data-action-btn data-action-btn-primary" data-i18n-title="exportSettingsData" title="Export Settings">
                    <span class="data-action-icon">${TemplateIcons.DOWNLOAD}</span>
                    <span data-i18n="exportSettingsData">Export Settings</span>
                </button>
                <button id="import-settings-data" type="button" class="data-action-btn data-action-btn-danger" data-i18n-title="importSettingsData" title="Import Settings">
                    <span class="data-action-icon">${TemplateIcons.UPLOAD}</span>
                    <span data-i18n="importSettingsData">Import Settings</span>
                </button>
            </div>
        </div>

        <div class="data-management-card data-management-card-muted">
            <div class="data-management-card-main">
                <span class="data-management-card-icon">${TemplateIcons.DOWNLOAD}</span>
                <div class="data-management-card-copy">
                    <h5 data-i18n="debugLogs">Debug Logs</h5>
                </div>
            </div>
            <div class="data-management-card-actions">
                <button id="download-logs" type="button" class="data-action-btn data-action-btn-secondary" data-i18n-title="downloadLogs" title="Download Logs">
                    <span class="data-action-icon">${TemplateIcons.DOWNLOAD}</span>
                    <span data-i18n="downloadLogs">Download Logs</span>
                </button>
            </div>
        </div>
    </div>

    <input id="import-history-file" type="file" accept="application/json,.json" hidden>
    <input id="import-settings-file" type="file" accept="application/json,.json" hidden>
</div>`;
