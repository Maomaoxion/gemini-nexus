(function () {
    // Image-editing toolbar actions and the edit mode each one sends to the model.
    const IMAGE_EDIT_MODES = {
        image_upscale: 'upscale',
        image_remove_bg: 'remove_bg',
        image_remove_watermark: 'remove_watermark',
        image_expand: 'expand',
        image_remove_text: 'remove_text',
    };

    class ToolbarDispatcher {
        constructor(controller) {
            this.controller = controller;
        }

        get ui() {
            return this.controller.ui;
        }
        get actions() {
            return this.controller.actions;
        }
        get inputManager() {
            return this.controller.inputManager;
        }
        get imageDetector() {
            return this.controller.imageDetector;
        }

        /**
         * Image actions all start from the hovered image: resolve the URL to send
         * and the rect the ask-window anchors to, then dismiss the hover button and
         * drop the session link so the next run starts a fresh conversation.
         * Returns null when no image is under the cursor.
         */
        async _beginImageAction() {
            const currentImage = this.imageDetector.getCurrentImage();
            if (!currentImage) return null;

            const imageUrl = await this._resolveImageUrl(currentImage);
            const imageRect = currentImage.getBoundingClientRect();

            this.ui.hideImageButton();
            this.controller.lastSessionId = null;

            return { imageUrl, imageRect };
        }

        async dispatch(actionType, actionPayload) {
            const currentModel = this.ui.getSelectedModel();

            try {
                switch (actionType) {
                    case 'copy_selection':
                        if (this.controller.currentSelection) {
                            navigator.clipboard
                                .writeText(this.controller.currentSelection)
                                .then(() => this.ui.showCopySelectionFeedback(true))
                                .catch((clipboardError) => {
                                    console.error('Failed to copy text:', clipboardError);
                                    this.ui.showCopySelectionFeedback(false);
                                });
                        }
                        break;

                    case 'image_analyze':
                    case 'image_describe':
                        {
                            const imageAction = await this._beginImageAction();
                            if (!imageAction) return;
                            this.actions.handleImagePrompt(
                                imageAction.imageUrl,
                                imageAction.imageRect,
                                'analyze',
                                currentModel
                            );
                        }
                        break;

                    case 'image_chat':
                        {
                            const imageAction = await this._beginImageAction();
                            if (!imageAction) return;
                            this.actions.handleImageChat(
                                imageAction.imageUrl,
                                imageAction.imageRect
                            );
                        }
                        break;

                    case 'image_extract':
                        {
                            const imageAction = await this._beginImageAction();
                            if (!imageAction) return;
                            this.actions.handleImagePrompt(
                                imageAction.imageUrl,
                                imageAction.imageRect,
                                'ocr',
                                currentModel
                            );
                        }
                        break;

                    case 'image_translate':
                        {
                            const imageAction = await this._beginImageAction();
                            if (!imageAction) return;
                            this.actions.handleImagePrompt(
                                imageAction.imageUrl,
                                imageAction.imageRect,
                                'translate',
                                currentModel
                            );
                        }
                        break;

                    case 'image_remove_bg':
                    case 'image_remove_text':
                    case 'image_remove_watermark':
                    case 'image_upscale':
                    case 'image_expand':
                        {
                            const imageAction = await this._beginImageAction();
                            if (!imageAction) return;

                            this.actions.handleImagePrompt(
                                imageAction.imageUrl,
                                imageAction.imageRect,
                                IMAGE_EDIT_MODES[actionType],
                                currentModel
                            );
                        }
                        break;

                    case 'ask':
                        if (this.controller.currentSelection) {
                            this.controller.hide();
                            this.ui.showAskWindow(
                                this.controller.lastRect,
                                this.controller.currentSelection,
                                window.GeminiToolbarStrings?.ask || 'Ask Gemini',
                                this.controller.lastMousePoint
                            );
                            this.controller.visible = true;
                        }
                        break;

                    case 'translate':
                    case 'explain':
                    case 'summarize':
                        if (!this.controller.currentSelection) return;
                        this.controller.lastSessionId = null;
                        this.actions.handleQuickAction(
                            actionType,
                            this.controller.currentSelection,
                            this.controller.lastRect,
                            currentModel,
                            this.controller.lastMousePoint
                        );
                        break;

                    case 'generate_image':
                        if (!this.controller.currentSelection) return;
                        this.controller.lastSessionId = null;
                        this.actions.handleGenerateImage(
                            this.controller.currentSelection,
                            this.controller.lastRect,
                            currentModel,
                            this.controller.lastMousePoint
                        );
                        break;

                    case 'read_selection':
                        if (!this.controller.currentSelection) return;
                        this.controller.readSelectionAloud();
                        break;

                    case 'read_page':
                        this.controller.readPageAloud();
                        break;

                    case 'grammar':
                        if (!this.controller.currentSelection) return;
                        this.ui.setGrammarMode(
                            true,
                            this.inputManager.source,
                            this.inputManager.range
                        );
                        this.controller.lastSessionId = null;
                        this.actions.handleQuickAction(
                            actionType,
                            this.controller.currentSelection,
                            this.controller.lastRect,
                            currentModel,
                            this.controller.lastMousePoint
                        );
                        break;

                    case 'custom_selection_tool':
                        if (!this.controller.currentSelection || !actionPayload) return;
                        this.controller.lastSessionId = null;
                        this.actions.handleCustomSelectionTool(
                            actionPayload,
                            this.controller.currentSelection,
                            this.controller.lastRect,
                            currentModel,
                            this.controller.lastMousePoint
                        );
                        break;

                    case 'insert_result':
                        this._handleInsert(actionPayload, false);
                        break;

                    case 'replace_result':
                        this._handleInsert(actionPayload, true);
                        break;

                    case 'submit_ask':
                        const question = actionPayload;
                        const context = this.controller.currentSelection;
                        if (question) {
                            this.actions.handleSubmitAsk(
                                question,
                                context,
                                this.controller.lastSessionId,
                                currentModel
                            );
                        }
                        break;

                    case 'retry_ask':
                        this.actions.handleRetry();
                        break;

                    case 'cancel_ask':
                        this.actions.handleCancel();
                        this.ui.hideAskWindow();
                        this.controller.visible = false;
                        this.controller.lastSessionId = null;
                        break;

                    case 'stop_ask':
                        this.actions.handleCancel();
                        this.ui.stopLoading();
                        break;

                    case 'continue_chat':
                        this.actions.handleContinueChat(this.controller.lastSessionId);
                        this.ui.hideAskWindow();
                        this.controller.visible = false;
                        this.controller.lastSessionId = null;
                        break;
                }
            } catch (error) {
                if (this._isImageAction(actionType)) {
                    await this._showImageLoadError();
                    return;
                }
                throw error;
            }
        }

        _isImageAction(actionType) {
            return typeof actionType === 'string' && actionType.startsWith('image_');
        }

        async _showImageLoadError() {
            const currentImage = this.imageDetector.getCurrentImage();
            const imageRect = currentImage?.getBoundingClientRect?.() || this.controller.lastRect;
            if (!imageRect) return;

            this.ui.hideImageButton();
            await this.ui.showAskWindow(
                imageRect,
                null,
                window.GeminiToolbarStrings?.imageTools || 'Image tools'
            );
            this.ui.showError(
                window.GeminiToolbarStrings?.errors?.imageLoadFailed ||
                    'Could not read this image. Try opening the original image or choose another one.'
            );
        }

        async _resolveImageUrl(imageElement) {
            const url = imageElement?.currentSrc || imageElement?.src || '';
            if (url.startsWith('blob:')) {
                return await this._blobUrlToDataUrl(url);
            }
            return url;
        }

        async _blobUrlToDataUrl(url) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to load blob image: ${response.status}`);
            }
            const blob = await response.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        _handleInsert(text, replace) {
            if (!this.inputManager.hasSource()) {
                navigator.clipboard
                    .writeText(text)
                    .then(() => {
                        this.ui.showError('Text copied to clipboard (not in editable field)');
                    })
                    .catch(() => {
                        this.ui.showError('Cannot insert: not in editable field');
                    });
                return;
            }

            const success = this.inputManager.insert(text, replace);
            if (success) {
                this.ui.showInsertReplaceButtons(false);
            } else {
                this.ui.showError('Failed to insert text');
            }
        }
    }

    window.GeminiToolbarDispatcher = ToolbarDispatcher;
})();
