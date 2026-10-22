import { TemplateIcons } from './icons.js';

export const FooterTemplate = `
    <!-- FOOTER -->
    <div class="footer">
        <div id="status"></div>

        <div class="input-wrapper">
            <!-- Dynamic Image Preview Container -->
            <div id="image-preview" class="image-preview"></div>

            <div id="tab-reference-bar" class="tab-reference-bar" aria-live="polite" hidden></div>

            <div class="composer-textarea-shell">
                <textarea id="prompt" data-i18n-placeholder="askPlaceholder" rows="1"></textarea>
            </div>

            <div id="tab-mention-menu" class="tab-mention-menu" role="listbox" hidden></div>

            <div class="composer-actions">
                <div class="composer-actions-left">
                    <button id="new-chat-composer-btn" type="button" data-i18n-title="newChatTooltip" title="New Chat (Alt+N)" aria-label="New Chat">
                        ${TemplateIcons.NEW_CHAT}
                    </button>

                    <label id="upload-btn" tabindex="0" role="button" data-i18n-title="uploadImageTooltip" title="Upload File" aria-label="Upload File">
                        ${TemplateIcons.PAPERCLIP}
                        <input type="file" id="image-input" class="file-input-hidden" tabindex="-1" multiple accept="image/*, .pdf, .txt, .js, .py, .html, .css, .json, .csv, .md">
                    </label>

                    <div class="tools-container">
                        <!-- Primary toggles: always visible, no horizontal scroll -->
                        <div class="tools-primary" id="tools-row">
                            <button id="browser-control-btn" class="tool-btn tool-toggle" data-i18n-title="browserControlTooltip" title="Allow model to control browser" aria-pressed="false">
                                ${TemplateIcons.BROWSER_CONTROL}
                                <span data-i18n="browserControl">Control</span>
                            </button>
                            <button id="debug-tools-btn" class="tool-btn tool-toggle" data-i18n-title="debugToolsTooltip" title="Toggle browser debugging tools" aria-pressed="false" disabled>
                                ${TemplateIcons.TERMINAL}
                                <span data-i18n="debugTools">Debug</span>
                            </button>
                            <button id="live-artifacts-btn" class="tool-btn tool-toggle" data-i18n-title="liveArtifactsTooltip" title="Toggle Live Artifacts responses" aria-pressed="false">
                                ${TemplateIcons.ARTIFACTS}
                                <span data-i18n="liveArtifacts">Live Artifacts</span>
                            </button>
                        </div>

                        <!-- Secondary actions -->
                        <div class="tools-more-dropdown" id="tools-more-dropdown">
                            <button id="tools-more-btn" class="tool-btn" data-i18n-title="toolsMoreTooltip" title="More tools" aria-haspopup="menu" aria-expanded="false" aria-controls="tools-more-menu">
                                ${TemplateIcons.MORE_HORIZONTAL}
                                <span data-i18n="toolsMore">More</span>
                            </button>
                            <div id="tools-more-menu" class="tools-menu" role="menu" hidden>
                                <button id="quote-btn" class="tools-menu-item context-aware" role="menuitem" data-i18n-title="quoteTooltip" title="Quote selected text from page">
                                    ${TemplateIcons.QUOTE}
                                    <span data-i18n="quote">Quote</span>
                                </button>
                                <button id="screen-capture-btn" class="tools-menu-item" role="menuitem" data-i18n-title="screenCaptureTooltip" title="Capture another screen or app window">
                                    ${TemplateIcons.SCREEN_CAPTURE}
                                    <span data-i18n="screenCapture">Screen</span>
                                </button>
                            </div>
                        </div>

                        <div class="capture-dropdown" id="capture-dropdown">
                            <button id="capture-menu-btn" class="tool-btn" data-i18n-title="captureMenuTooltip" title="Capture area of the page" aria-haspopup="menu" aria-expanded="false" aria-controls="capture-menu">
                                ${TemplateIcons.SNIP}
                                <span data-i18n="captureMenu">Capture</span>
                                ${TemplateIcons.CHEVRON_DOWN}
                            </button>
                            <div id="capture-menu" class="tools-menu capture-menu" role="menu" hidden>
                                <button id="ocr-btn" class="tools-menu-item" role="menuitem" data-i18n-title="ocrTooltip" title="Capture area and extract text">
                                    ${TemplateIcons.OCR}
                                    <span data-i18n="ocrLabel">Extract text (OCR)</span>
                                </button>
                                <button id="screenshot-translate-btn" class="tools-menu-item" role="menuitem" data-i18n-title="screenshotTranslateTooltip" title="Capture area and translate text">
                                    ${TemplateIcons.TRANSLATE}
                                    <span data-i18n="screenshotTranslateLabel">Translate screenshot</span>
                                </button>
                                <button id="snip-btn" class="tools-menu-item" role="menuitem" data-i18n-title="snipTooltip" title="Capture area to input (Alt+S)">
                                    ${TemplateIcons.CAPTURE_IMAGE}
                                    <span data-i18n="snipLabel">Capture as image</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="composer-actions-right">
                    <button id="send" type="button" data-i18n-title="sendMessageTooltip" title="Send message (Enter)" class="is-empty" aria-disabled="true">
                        ${TemplateIcons.SEND}
                    </button>
                </div>
            </div>
        </div>
    </div>
`;
