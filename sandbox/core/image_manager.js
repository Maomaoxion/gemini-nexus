export class ImageManager {
    constructor(elements, callbacks = {}) {
        this.imageInput = elements.imageInput;
        this.imagePreview = elements.imagePreview;
        this.inputWrapper = elements.inputWrapper;
        this.inputFn = elements.inputFn;

        this.onUrlDrop = callbacks.onUrlDrop;
        this.onFilesChanged =
            typeof callbacks.onFilesChanged === 'function' ? callbacks.onFilesChanged : null;

        this.files = []; // Array of { base64, type, name }

        this.initListeners();
    }

    initListeners() {
        this.imageInput.addEventListener('change', (changeEvent) => {
            const files = changeEvent.target.files;
            if (files && files.length > 0) {
                Array.from(files).forEach((file) => this.handleFile(file));
                // Reset input so same file can be selected again
                this.imageInput.value = '';
            }
        });

        // Paste can provide real files, HTML image references, and plain text together.
        document.addEventListener('paste', (pasteEvent) => {
            const clipboardData =
                pasteEvent.clipboardData || pasteEvent.originalEvent.clipboardData;
            const items = clipboardData.items;
            const html = clipboardData.getData('text/html');
            const text = clipboardData.getData('text/plain');

            let handledFiles = false;
            let handledHtmlImages = false;

            for (const clipboardItem of items) {
                if (clipboardItem.kind === 'file') {
                    const file = clipboardItem.getAsFile();
                    if (file) {
                        this.handleFile(file);
                        handledFiles = true;
                    }
                }
            }

            // Only inspect HTML images when no direct files were provided, avoiding duplicates.
            if (!handledFiles && html) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const images = doc.querySelectorAll('img');

                images.forEach((imageElement) => {
                    const src = imageElement.src;
                    if (!src) return;

                    if (src.startsWith('data:')) {
                        const match = src.match(/^data:(.+);base64,(.+)$/);
                        if (match) {
                            this.addFile(src, match[1], 'pasted_image.png');
                            handledHtmlImages = true;
                        }
                    } else if (src.startsWith('http')) {
                        if (this.onUrlDrop) {
                            this.onUrlDrop(src);
                            handledHtmlImages = true;
                        }
                    }
                });
            }

            // Preserve pasted text manually when image handling requires preventDefault().
            if (handledFiles || handledHtmlImages) {
                pasteEvent.preventDefault();
                if (text) {
                    this._insertTextAtCursor(text);
                }
            }
        });

        const dropZone = document.body;
        let dragCounter = 0;

        dropZone.addEventListener('dragenter', (dragEvent) => {
            dragEvent.preventDefault();
            dragEvent.stopPropagation();
            dragCounter++;
            this.inputWrapper.classList.add('dragging');
        });

        dropZone.addEventListener('dragleave', (dragEvent) => {
            dragEvent.preventDefault();
            dragEvent.stopPropagation();
            dragCounter--;
            if (dragCounter === 0) {
                this.inputWrapper.classList.remove('dragging');
            }
        });

        dropZone.addEventListener('dragover', (dragEvent) => {
            dragEvent.preventDefault();
            dragEvent.stopPropagation();
        });

        dropZone.addEventListener('drop', (dropEvent) => {
            dropEvent.preventDefault();
            dropEvent.stopPropagation();
            dragCounter = 0;
            this.inputWrapper.classList.remove('dragging');

            const dt = dropEvent.dataTransfer;
            const files = dt.files;
            const html = dt.getData('text/html');
            const text = dt.getData('text/plain');

            let handledFiles = false;
            let handledHtmlImages = false;

            if (files && files.length > 0) {
                Array.from(files).forEach((file) => this.handleFile(file));
                handledFiles = true;
            }

            if (!handledFiles && html) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const images = doc.querySelectorAll('img');

                images.forEach((imageElement) => {
                    const src = imageElement.src;
                    if (!src) return;

                    // Filter out likely spacers or tracking pixels
                    if (
                        imageElement.width > 0 &&
                        imageElement.width < 50 &&
                        imageElement.height > 0 &&
                        imageElement.height < 50
                    )
                        return;

                    if (src.startsWith('data:')) {
                        const match = src.match(/^data:(.+);base64,(.+)$/);
                        if (match) {
                            this.addFile(src, match[1], 'dragged_image.png');
                            handledHtmlImages = true;
                        }
                    } else if (src.startsWith('http')) {
                        if (this.onUrlDrop) {
                            this.onUrlDrop(src);
                            handledHtmlImages = true;
                        }
                    }
                });
            }

            if (text) {
                // If we handled images, avoid inserting text if it looks like the URL of the image we just added
                // (Browsers often provide the image URL as text/plain when dragging an image)
                let skipText = false;
                if (handledHtmlImages || handledFiles) {
                    if (text.match(/^https?:\/\//) || text.startsWith('data:')) {
                        skipText = true;
                    }
                }

                if (!skipText) {
                    this._insertTextAtCursor(text);
                }
            }
        });
    }

    _insertTextAtCursor(text) {
        const input = this.inputFn;
        if (!input) return;

        if (input.selectionStart || input.selectionStart === 0) {
            const startPos = input.selectionStart;
            const endPos = input.selectionEnd;
            input.value =
                input.value.substring(0, startPos) +
                text +
                input.value.substring(endPos, input.value.length);

            input.selectionStart = startPos + text.length;
            input.selectionEnd = startPos + text.length;
        } else {
            input.value += text;
        }
        // Trigger resize/input event
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }

    handleFile(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            this.addFile(event.target.result, file.type, file.name);
        };
        reader.readAsDataURL(file);
    }

    // Used by background response handler or direct file input
    setFile(base64, type, name) {
        this.addFile(base64, type, name);
    }

    addFile(base64, type, name) {
        this.files.push({ base64, type, name });
        this._render();
        this.inputFn.focus();
    }

    removeFile(index) {
        this.files.splice(index, 1);
        this._render();
    }

    clearFile() {
        this.files = [];
        this._render();
    }

    setFiles(files) {
        this.files = Array.isArray(files)
            ? files.filter((file) => file && typeof file.base64 === 'string')
            : [];
        this._render();
    }

    getFiles() {
        return [...this.files];
    }

    _notifyFilesChanged() {
        if (this.onFilesChanged) {
            this.onFilesChanged(this.files.length > 0, this.getFiles());
        }
    }

    _render() {
        this.imagePreview.innerHTML = '';

        if (this.files.length === 0) {
            this.imagePreview.classList.remove('has-image');
            this._notifyFilesChanged();
            return;
        }

        this.imagePreview.classList.add('has-image');

        this.files.forEach((file, index) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'preview-remove-btn';
            removeButton.textContent = '✕';
            removeButton.setAttribute('aria-label', 'Remove attachment');
            removeButton.onclick = (clickEvent) => {
                clickEvent.stopPropagation();
                this.removeFile(index);
            };
            previewItem.appendChild(removeButton);

            if (file.type && file.type.startsWith('image/')) {
                const imageElement = document.createElement('img');
                imageElement.src = file.base64;
                previewItem.appendChild(imageElement);
            } else {
                const card = document.createElement('div');
                card.className = 'file-item-card';

                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                Object.entries({
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    'stroke-width': '2',
                    'stroke-linecap': 'round',
                    'stroke-linejoin': 'round',
                }).forEach(([key, value]) => icon.setAttribute(key, value));

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute(
                    'd',
                    'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z'
                );
                const fold = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                fold.setAttribute('points', '14 2 14 8 20 8');
                icon.append(path, fold);

                const name = document.createElement('span');
                name.textContent = file.name || 'attachment';

                card.append(icon, name);
                previewItem.appendChild(card);
            }

            this.imagePreview.appendChild(previewItem);
        });

        this._notifyFilesChanged();
    }
}
