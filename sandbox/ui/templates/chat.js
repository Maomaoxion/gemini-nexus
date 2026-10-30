import { TemplateIcons } from './icons.js';

export const ChatTemplate = `
    <!-- CHAT AREA -->
    <div id="chat-history"></div>
    <div id="chat-empty" class="chat-empty">
        <div class="chat-empty-content">
            <div class="chat-empty-mark" aria-hidden="true">
                <img class="chat-empty-logo" src="../logo.png" alt="" width="48" height="48">
            </div>
            <div class="chat-empty-title" data-i18n="chatEmptyTitle">Gemini Nexus</div>
            <div class="chat-empty-hint" data-i18n="chatEmptyHint">Ready when you are.</div>
            <ul class="chat-empty-tips">
                <li>
                    <button type="button" class="chat-empty-tip" data-empty-action="mention-tab">
                        <span class="chat-empty-tip-icon" aria-hidden="true">${TemplateIcons.PAGE_CONTEXT}</span>
                        <span class="chat-empty-tip-text" data-i18n="chatEmptyTip1">Type @ to reference a tab</span>
                    </button>
                </li>
                <li>
                    <button type="button" class="chat-empty-tip" data-empty-action="capture">
                        <span class="chat-empty-tip-icon" aria-hidden="true">${TemplateIcons.SNIP}</span>
                        <span class="chat-empty-tip-text" data-i18n="chatEmptyTip2">Use Capture for OCR, translate, or image ask</span>
                    </button>
                </li>
                <li>
                    <button type="button" class="chat-empty-tip" data-empty-action="browser-control">
                        <span class="chat-empty-tip-icon" aria-hidden="true">${TemplateIcons.BROWSER_CONTROL}</span>
                        <span class="chat-empty-tip-text" data-i18n="chatEmptyTip3">Enable Control to let the model browse for you</span>
                    </button>
                </li>
            </ul>
        </div>
    </div>
`;
