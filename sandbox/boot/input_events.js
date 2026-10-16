import { resizeSelectToSelectedOption } from '../ui/model_select_width.js';
import { initModelPicker, syncModelPicker } from '../ui/model_picker.js';
import { t } from '../core/i18n.js';

const IME_PROCESS_KEY_CODE = 229;
const ACTIVE_MODAL_SELECTOR = [
    '.settings-modal.visible',
    '.settings-page.visible',
    '.image-viewer.visible',
    '[role="dialog"].visible',
    '[aria-modal="true"].visible',
].join(', ');

// Overlays that should consume Escape before canceling generation.
const DISMISSIBLE_OVERLAY_SELECTOR = [
    ACTIVE_MODAL_SELECTOR,
    '.msg.editing',
    '.history-item.menu-open',
    '.history-group.menu-open',
    '#capture-menu:not([hidden])',
    '#tools-more-menu:not([hidden])',
    '#model-picker-menu:not([hidden])',
    '#collapsed-recent-popover:not([hidden])',
].join(', ');

function isEditableTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;

    const element = target;
    const tagName = element.tagName;

    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return true;
    }

    if (element.isContentEditable) {
        return true;
    }

    return Boolean(
        element.closest?.(
            '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
        )
    );
}

function isImeEvent(keyEvent) {
    return (
        keyEvent.isComposing ||
        keyEvent.key === 'Process' ||
        keyEvent.keyCode === IME_PROCESS_KEY_CODE ||
        keyEvent.which === IME_PROCESS_KEY_CODE
    );
}

function hasActiveModal() {
    return Boolean(document.querySelector(ACTIVE_MODAL_SELECTOR));
}

function hasDismissibleOverlay() {
    return Boolean(document.querySelector(DISMISSIBLE_OVERLAY_SELECTOR));
}

/** Model cycling focus target helper (prompt or model picker wrapper). */
function isModelCycleFocusTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
    if (target.id === 'prompt') return true;
    return Boolean(target.closest?.('.model-select-wrapper'));
}

function focusInputAtEnd(inputFn, delayMs = 0) {
    if (!inputFn) return;

    const focusNow = () => {
        inputFn.focus();
        const textLength = inputFn.value.length;
        inputFn.setSelectionRange?.(textLength, textLength);
        inputFn.scrollTop = inputFn.scrollHeight;
    };

    if (delayMs > 0) {
        setTimeout(focusNow, delayMs);
        return;
    }

    focusNow();
}

function insertTextAtCursor(inputFn, text) {
    if (!inputFn || !text) return;

    const startPos =
        typeof inputFn.selectionStart === 'number' ? inputFn.selectionStart : inputFn.value.length;
    const endPos = typeof inputFn.selectionEnd === 'number' ? inputFn.selectionEnd : startPos;

    inputFn.value =
        inputFn.value.slice(0, startPos) + text + inputFn.value.slice(endPos, inputFn.value.length);

    const nextPosition = startPos + text.length;
    inputFn.setSelectionRange?.(nextPosition, nextPosition);
    inputFn.dispatchEvent(new Event('input', { bubbles: true }));
    inputFn.focus();
}

function appendTypedKey(inputFn, key) {
    if (!inputFn || !key) return;

    inputFn.focus();
    inputFn.value += key;
    inputFn.dispatchEvent(new Event('input', { bubbles: true }));
    focusInputAtEnd(inputFn);
}

function clipboardHasFiles(clipboardData) {
    if (!clipboardData) return false;

    if (clipboardData.files && clipboardData.files.length > 0) {
        return true;
    }

    return Array.from(clipboardData.items || []).some((item) => item.kind === 'file');
}

function bindModelSelect(app, ui, setResizeRef, inputFn) {
    const modelSelect = document.getElementById('model-select');
    const modelPicker = initModelPicker(modelSelect);
    let resizeModelSelectFrame = null;
    const resizeModelSelect = () => {
        if (resizeModelSelectFrame !== null) return;

        resizeModelSelectFrame = window.requestAnimationFrame(() => {
            resizeModelSelectFrame = null;

            if (ui?.resizeModelSelect) {
                ui.resizeModelSelect();
                return;
            }

            resizeSelectToSelectedOption(modelSelect);
            syncModelPicker(modelSelect);
        });
    };

    if (setResizeRef) setResizeRef(resizeModelSelect);

    let cleanup = () => {};
    if (modelSelect) {
        const handleModelChange = (changeEvent) => {
            app.handleModelChange(changeEvent.target.value);
            modelPicker?.sync();
            resizeModelSelect();
            focusInputAtEnd(inputFn, 50);
        };

        modelSelect.addEventListener('change', handleModelChange);
        setTimeout(resizeModelSelect, 50);
        cleanup = () => modelSelect.removeEventListener('change', handleModelChange);
    }

    return { modelSelect, cleanup };
}

function cycleModelSelect(modelSelect, keyEvent, inputFn) {
    if (!modelSelect || modelSelect.length === 0) return;
    const direction = keyEvent.shiftKey ? -1 : 1;
    const newIndex =
        (modelSelect.selectedIndex + direction + modelSelect.length) % modelSelect.length;
    modelSelect.selectedIndex = newIndex;
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    focusInputAtEnd(inputFn, 50);
}

function tryCancelGeneration(app, keyEvent) {
    if (!app.isGenerating || hasDismissibleOverlay()) {
        return false;
    }
    keyEvent.preventDefault();
    app.handleCancel();
    return true;
}

// Enter never cancels a running reply, so it must not look like it sent
// anything either: explain the state instead of swallowing the keystroke.
function showSendWhileGeneratingHint(app, ui) {
    if (!app?.isGenerating || typeof ui?.updateStatus !== 'function') return;

    ui.updateStatus(t('sendWhileGeneratingHint'));
    setTimeout(() => {
        if (!app.isGenerating) ui.updateStatus('');
    }, 4000);
}

export function bindInputEvents(app, ui, setResizeRef) {
    const inputFn = ui?.inputFn || document.getElementById('prompt');
    const sendBtn = ui?.sendBtn || document.getElementById('send');
    const { modelSelect, cleanup: cleanupModelSelect } = bindModelSelect(
        app,
        ui,
        setResizeRef,
        inputFn
    );
    const cleanupHandlers = [cleanupModelSelect];

    if (inputFn && sendBtn) {
        const handleInputKeyDown = (keyEvent) => {
            if (isImeEvent(keyEvent)) {
                return;
            }

            if ((keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key.toLowerCase() === 'm') {
                keyEvent.preventDefault();
                cycleModelSelect(modelSelect, keyEvent, inputFn);
                return;
            }

            if (keyEvent.key === 'Escape') {
                tryCancelGeneration(app, keyEvent);
                return;
            }

            if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
                keyEvent.preventDefault();
                // Generation in progress: Stop is the send button, but Enter must
                // not cancel — users often press Enter while drafting the next turn.
                if (app.isGenerating) {
                    showSendWhileGeneratingHint(app, ui);
                    return;
                }
                sendBtn.click();
                return;
            }

            // Shift+Enter inserts a newline so users can write multi-line
            // prompts. The input is a <textarea> (footer template), which
            // supports newlines natively; we just must NOT preventDefault on
            // Shift+Enter (the earlier guard only handled plain Enter, so
            // Shift+Enter already fell through to the browser's default — but
            // only because there was no conflicting handler. Make the intent
            // explicit so future handlers can't accidentally swallow it.
            if (keyEvent.key === 'Enter' && keyEvent.shiftKey) {
                // Let the browser insert the newline natively.
                return;
            }
        };

        const handleSendClick = () => {
            if (app.isGenerating) {
                // Stop path. A draft in the composer means the click is really
                // "send this instead of the running reply": stop the current run
                // and continue to the send below. Without a draft it stays a
                // plain Stop — a swallowed click reads as a broken send button.
                const text = (ui?.inputFn || inputFn)?.value?.trim?.() || '';
                const hasFiles =
                    typeof app.imageManager?.getFiles === 'function'
                        ? app.imageManager.getFiles().length > 0
                        : false;
                app.handleCancel();
                if (!text && !hasFiles) return;
            }
            app.handleSendMessage();
        };

        inputFn.addEventListener('keydown', handleInputKeyDown);
        sendBtn.addEventListener('click', handleSendClick);
        cleanupHandlers.push(() => inputFn.removeEventListener('keydown', handleInputKeyDown));
        cleanupHandlers.push(() => sendBtn.removeEventListener('click', handleSendClick));
    }

    // Keyboard-accessible file upload (label is not focusable by default).
    const uploadBtn = document.getElementById('upload-btn');
    const imageInput = document.getElementById('image-input');
    if (uploadBtn && imageInput) {
        const handleUploadKeyDown = (keyEvent) => {
            if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
            keyEvent.preventDefault();
            imageInput.click();
        };
        uploadBtn.addEventListener('keydown', handleUploadKeyDown);
        cleanupHandlers.push(() => uploadBtn.removeEventListener('keydown', handleUploadKeyDown));
    }

    const handleGlobalPaste = (pasteEvent) => {
        if (
            pasteEvent.defaultPrevented ||
            hasActiveModal() ||
            isEditableTarget(pasteEvent.target)
        ) {
            return;
        }

        const clipboardData = pasteEvent.clipboardData || pasteEvent.originalEvent?.clipboardData;
        if (!clipboardData || clipboardHasFiles(clipboardData)) {
            return;
        }

        const pastedText = clipboardData.getData('text/plain');
        if (!pastedText) {
            return;
        }

        pasteEvent.preventDefault();
        pasteEvent.stopPropagation();
        insertTextAtCursor(inputFn, pastedText);
    };

    const handleGlobalKeyDown = (keyEvent) => {
        if (keyEvent.defaultPrevented) {
            return;
        }

        if (isImeEvent(keyEvent)) {
            return;
        }

        if (hasActiveModal()) {
            return;
        }

        if ((keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key.toLowerCase() === 'p') {
            keyEvent.preventDefault();
            focusInputAtEnd(inputFn);
            return;
        }

        if (
            (keyEvent.altKey &&
                !keyEvent.ctrlKey &&
                !keyEvent.metaKey &&
                keyEvent.key.toLowerCase() === 'n') ||
            ((keyEvent.ctrlKey || keyEvent.metaKey) &&
                keyEvent.shiftKey &&
                keyEvent.key.toLowerCase() === 'o')
        ) {
            keyEvent.preventDefault();
            const newChatBtn =
                document.getElementById('new-chat-composer-btn') ||
                document.getElementById('new-chat-sidebar-btn') ||
                document.getElementById('collapsed-new-chat-btn');
            newChatBtn?.click?.();
            return;
        }

        if (
            keyEvent.altKey &&
            !keyEvent.ctrlKey &&
            !keyEvent.metaKey &&
            keyEvent.key.toLowerCase() === 't'
        ) {
            const thinkingToggle = document.getElementById('web-thinking-toggle');
            if (thinkingToggle && !thinkingToggle.hidden) {
                keyEvent.preventDefault();
                thinkingToggle.click();
                return;
            }
        }

        if (
            keyEvent.altKey &&
            !keyEvent.ctrlKey &&
            !keyEvent.metaKey &&
            keyEvent.key.toLowerCase() === 'h'
        ) {
            keyEvent.preventDefault();
            const historyToggle = document.getElementById('history-toggle');
            historyToggle?.click?.();
            return;
        }

        if (
            keyEvent.altKey &&
            !keyEvent.ctrlKey &&
            !keyEvent.metaKey &&
            !keyEvent.shiftKey &&
            keyEvent.key.toLowerCase() === 's'
        ) {
            keyEvent.preventDefault();
            const snipBtn = document.getElementById('snip-btn');
            snipBtn?.click?.();
            return;
        }

        if (
            (keyEvent.ctrlKey || keyEvent.metaKey) &&
            !keyEvent.altKey &&
            !keyEvent.shiftKey &&
            keyEvent.key.toLowerCase() === 'm'
        ) {
            if (!isEditableTarget(keyEvent.target) || keyEvent.target?.id === 'prompt') {
                keyEvent.preventDefault();
                cycleModelSelect(modelSelect, keyEvent, inputFn);
                return;
            }
        }

        if (keyEvent.key === 'Escape') {
            tryCancelGeneration(app, keyEvent);
            return;
        }

        // Tab cycles models only when focused directly on the model picker trigger/native select
        if (
            keyEvent.key === 'Tab' &&
            isModelCycleFocusTarget(keyEvent.target) &&
            keyEvent.target?.id !== 'prompt'
        ) {
            keyEvent.preventDefault();
            cycleModelSelect(modelSelect, keyEvent, inputFn);
            return;
        }

        if (
            isEditableTarget(keyEvent.target) ||
            keyEvent.ctrlKey ||
            keyEvent.metaKey ||
            keyEvent.altKey ||
            keyEvent.key.length !== 1
        ) {
            return;
        }

        keyEvent.preventDefault();
        appendTypedKey(inputFn, keyEvent.key);
    };

    document.addEventListener('paste', handleGlobalPaste);
    document.addEventListener('keydown', handleGlobalKeyDown);
    cleanupHandlers.push(() => document.removeEventListener('paste', handleGlobalPaste));
    cleanupHandlers.push(() => document.removeEventListener('keydown', handleGlobalKeyDown));

    return () => {
        cleanupHandlers.forEach((cleanup) => cleanup());
    };
}
