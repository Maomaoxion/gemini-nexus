import { TemplateIcons } from './icons.js';

export const SidebarTemplate = `
    <!-- SIDEBAR -->
    <div id="history-sidebar" class="sidebar">
        <div class="sidebar-expanded-pane">
            <div class="sidebar-header">
                <button id="sidebar-brand-toggle" class="sidebar-brand" type="button" data-i18n-title="toggleHistory" title="Chat History (Alt+H)" aria-label="Chat History (Alt+H)">
                    <img class="sidebar-brand-logo" src="../logo.png" alt="" aria-hidden="true">
                    <span class="sidebar-header-title">Gemini Nexus</span>
                </button>
                <button id="close-sidebar" class="sidebar-icon-btn sidebar-toggle-btn" data-i18n-title="toggleHistory" title="Chat History (Alt+H)">
                    ${TemplateIcons.SIDEBAR_TOGGLE}
                </button>
            </div>

            <div class="sidebar-actions">
                <button id="new-chat-sidebar-btn" class="sidebar-action-row" data-i18n-title="newChatTooltip" title="New Chat (Alt+N)">
                    ${TemplateIcons.NEW_CHAT}
                    <span data-i18n="newChat">New Chat</span>
                </button>
                <button id="sidebar-search-toggle" class="sidebar-action-row" data-i18n-title="searchPlaceholder" title="Search for chats">
                    ${TemplateIcons.SEARCH}
                    <span data-i18n="searchPlaceholder">Search for chats</span>
                </button>
                <button id="new-group-sidebar-btn" class="sidebar-action-row" data-i18n-title="newGroupTooltip" title="New Group">
                    ${TemplateIcons.NEW_GROUP}
                    <span data-i18n="newGroup">New Group</span>
                </button>
                <div class="search-container" hidden>
                    ${TemplateIcons.SEARCH}
                    <input type="text" id="history-search" data-i18n-placeholder="searchPlaceholder" autocomplete="off">
                    <button id="history-search-clear" class="search-clear-btn" type="button" data-i18n-title="clearSearch" title="Clear search" aria-label="Clear search">
                        ${TemplateIcons.CLOSE}
                    </button>
                </div>
            </div>

            <div class="sidebar-history">
                <div id="history-list" class="history-list"></div>
            </div>

            <div class="sidebar-footer">
                <button id="settings-btn" class="settings-btn">
                    ${TemplateIcons.SETTINGS}
                    <span data-i18n="settings">Settings</span>
                </button>
            </div>
        </div>

        <div class="collapsed-sidebar-rail">
            <button id="collapsed-sidebar-toggle" class="collapsed-sidebar-button sidebar-toggle-btn" data-i18n-title="toggleHistory" title="Chat History (Alt+H)">
                ${TemplateIcons.SIDEBAR_TOGGLE}
            </button>
            <div class="collapsed-sidebar-separator"></div>
            <button id="collapsed-new-chat-btn" class="collapsed-sidebar-button" data-i18n-title="newChatTooltip" title="New Chat (Alt+N)">
                ${TemplateIcons.NEW_CHAT}
            </button>
            <button id="collapsed-search-btn" class="collapsed-sidebar-button" data-i18n-title="searchPlaceholder" title="Search for chats">
                ${TemplateIcons.SEARCH}
            </button>
            <button id="collapsed-recent-chats-btn" class="collapsed-sidebar-button" data-i18n-title="recentChats" title="Recent chats" aria-haspopup="dialog" aria-expanded="false">
                ${TemplateIcons.HISTORY}
            </button>
            <div class="collapsed-sidebar-spacer"></div>
            <button id="collapsed-settings-btn" class="collapsed-sidebar-button" data-i18n-title="settings" title="Settings">
                ${TemplateIcons.SETTINGS}
            </button>
        </div>
        <div id="collapsed-recent-popover" class="collapsed-recent-popover" role="dialog" aria-label="Recent chats" hidden></div>
    </div>
    <div id="sidebar-overlay" class="sidebar-overlay"></div>
`;
