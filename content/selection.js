(function () {
    class SelectionObserver {
        constructor(callbacks) {
            this.callbacks = callbacks || {}; // { onSelection, onClear, onClick }
            this.selectionTimer = null;
            this.clearDownPointTimer = null;
            this.pendingMousePoint = null;
            this.pointerDownPoint = null;
            this.pendingIsDrag = false;
            this.isPointerDown = false;
            this.onSelectionEnd = this.onSelectionEnd.bind(this);
            this.onMouseDown = this.onMouseDown.bind(this);
            this.onSelectionChange = this.onSelectionChange.bind(this);
            this.init();
        }

        init() {
            document.addEventListener('mouseup', this.onSelectionEnd, true);
            document.addEventListener('pointerup', this.onSelectionEnd, true);
            document.addEventListener('touchend', this.onSelectionEnd, true);
            document.addEventListener('mousedown', this.onMouseDown, true);
            document.addEventListener('pointerdown', this.onMouseDown, true);
            document.addEventListener('touchstart', this.onMouseDown, true);
            document.addEventListener('selectionchange', this.onSelectionChange);
        }

        _isContextValid() {
            if (window.GeminiNexusPageGuard?.isContextValid) {
                return window.GeminiNexusPageGuard.isContextValid();
            }
            try {
                if (typeof chrome === 'undefined' || !chrome.runtime) return true;
                if ('id' in chrome.runtime && !chrome.runtime.id) {
                    return false;
                }
                return true;
            } catch {
                return false;
            }
        }

        onMouseDown(pointerEvent) {
            if (!this._isContextValid()) {
                this.disconnect();
                return;
            }
            this.isPointerDown = true;
            const point = this.getEventPoint(pointerEvent);
            if (point) {
                this.pointerDownPoint = point;
            }
            if (this.callbacks.onClick) {
                this.callbacks.onClick(pointerEvent);
            }
        }

        onSelectionEnd(pointerEvent) {
            if (!this._isContextValid()) {
                this.disconnect();
                return;
            }
            this.isPointerDown = false;
            const pointerUpPoint = this.getEventPoint(pointerEvent);
            const isDrag = Boolean(
                this.pointerDownPoint &&
                pointerUpPoint &&
                (Math.abs(pointerUpPoint.x - this.pointerDownPoint.x) > 3 ||
                    Math.abs(pointerUpPoint.y - this.pointerDownPoint.y) > 3)
            );
            if (this.clearDownPointTimer) {
                clearTimeout(this.clearDownPointTimer);
            }
            this.clearDownPointTimer = setTimeout(() => {
                this.pointerDownPoint = null;
                this.clearDownPointTimer = null;
            }, 50);

            this.scheduleSelectionCheck(pointerEvent, isDrag);
        }

        onSelectionChange() {
            if (!this._isContextValid()) {
                this.disconnect();
                return;
            }
            if (this.isPointerDown) return;
            this.scheduleSelectionCheck(null, false);
        }

        scheduleSelectionCheck(pointerEvent, isDrag = false) {
            const mousePoint = this.getEventPoint(pointerEvent);
            if (mousePoint || !this.pendingMousePoint) {
                this.pendingMousePoint = mousePoint;
            }
            this.pendingIsDrag = this.pendingIsDrag || isDrag;

            if (this.selectionTimer) {
                clearTimeout(this.selectionTimer);
            }

            // Delay slightly to let native selection state settle.
            this.selectionTimer = setTimeout(() => {
                this.selectionTimer = null;
                const selectionData = this.readSelection(this.pendingMousePoint);
                const wasDrag = this.pendingIsDrag;
                this.pendingMousePoint = null;
                this.pendingIsDrag = false;

                if (selectionData && selectionData.text.length > 0) {
                    selectionData.isDrag = wasDrag;
                    if (this.callbacks.onSelection) {
                        this.callbacks.onSelection(selectionData);
                    }
                } else if (this.callbacks.onClear) {
                    this.callbacks.onClear();
                }
            }, 10);
        }

        readSelection(mousePoint) {
            const inputSelection = this.readInputSelection(mousePoint);
            if (inputSelection) return inputSelection;

            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) return null;

            const text = selection.toString().trim();
            if (!text) return null;

            const range = selection.getRangeAt(0);
            const rect =
                typeof range.getBoundingClientRect === 'function'
                    ? range.getBoundingClientRect()
                    : this.emptyRect();

            return {
                text,
                range,
                rect,
                mousePoint,
            };
        }

        readInputSelection(mousePoint) {
            const element = this.getActiveElement();
            if (!this.isTextInput(element)) return null;

            const start = element.selectionStart;
            const end = element.selectionEnd;
            if (typeof start !== 'number' || typeof end !== 'number' || start === end) {
                return null;
            }

            const text = element.value.slice(start, end).trim();
            if (!text) return null;

            const rect =
                typeof element.getBoundingClientRect === 'function'
                    ? element.getBoundingClientRect()
                    : this.emptyRect();

            return {
                text,
                rect,
                mousePoint,
            };
        }

        getActiveElement() {
            let element = document.activeElement;
            while (element && element.shadowRoot && element.shadowRoot.activeElement) {
                element = element.shadowRoot.activeElement;
            }
            return element;
        }

        isTextInput(element) {
            if (!element || typeof element.value !== 'string') return false;
            const tagName = element.tagName;
            if (tagName === 'TEXTAREA') return true;
            if (tagName !== 'INPUT') {
                // contenteditable elements are handled via window.getSelection path
                return false;
            }
            const allowedInputTypes = new Set([
                'text',
                'search',
                'url',
                'tel',
                'password',
                'number',
                'email',
            ]);
            const type = String(element.type || 'text').toLowerCase();
            return allowedInputTypes.has(type);
        }

        getEventPoint(pointerEvent) {
            if (!pointerEvent) return null;

            const source =
                pointerEvent.changedTouches && pointerEvent.changedTouches.length > 0
                    ? pointerEvent.changedTouches[0]
                    : pointerEvent.touches && pointerEvent.touches.length > 0
                      ? pointerEvent.touches[0]
                      : pointerEvent;

            if (typeof source.clientX !== 'number' || typeof source.clientY !== 'number') {
                return null;
            }

            return { x: source.clientX, y: source.clientY };
        }

        emptyRect() {
            return {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                width: 0,
                height: 0,
            };
        }

        disconnect() {
            if (this.selectionTimer) {
                clearTimeout(this.selectionTimer);
                this.selectionTimer = null;
            }
            if (this.clearDownPointTimer) {
                clearTimeout(this.clearDownPointTimer);
                this.clearDownPointTimer = null;
            }
            this.pendingMousePoint = null;
            this.pointerDownPoint = null;
            this.pendingIsDrag = false;

            document.removeEventListener('mouseup', this.onSelectionEnd, true);
            document.removeEventListener('pointerup', this.onSelectionEnd, true);
            document.removeEventListener('touchend', this.onSelectionEnd, true);
            document.removeEventListener('mousedown', this.onMouseDown, true);
            document.removeEventListener('pointerdown', this.onMouseDown, true);
            document.removeEventListener('touchstart', this.onMouseDown, true);
            document.removeEventListener('selectionchange', this.onSelectionChange);
        }
    }

    window.GeminiSelectionObserver = SelectionObserver;
})();
