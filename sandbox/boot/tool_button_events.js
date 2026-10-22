import { sendToBackground } from '../../shared/messaging/index.js';
import { t } from '../core/i18n.js';

function positionFixedMenu(menu, trigger) {
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 200;
    const menuHeight = menu.offsetHeight || 120;
    const spaceAbove = rect.top;
    const openBelow = spaceAbove < menuHeight + 12;
    const top = openBelow ? rect.bottom + 6 : rect.top - menuHeight - 6;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
        left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) left = 8;
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
}

function closeMenu(menuId, triggerId) {
    const menu = document.getElementById(menuId);
    const trigger = document.getElementById(triggerId);
    if (!menu || !trigger) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
}

function toggleMenu(menuId, triggerId) {
    const menu = document.getElementById(menuId);
    const trigger = document.getElementById(triggerId);
    if (!menu || !trigger) return;
    const willOpen = menu.hidden;
    // Only one composer menu open at a time.
    closeMenu('capture-menu', 'capture-menu-btn');
    closeMenu('tools-more-menu', 'tools-more-btn');
    if (willOpen) {
        menu.hidden = false;
        requestAnimationFrame(() => positionFixedMenu(menu, trigger));
        trigger.setAttribute('aria-expanded', 'true');
    }
}

function bindCaptureButton(buttonId, app, ui, mode, getStatusText) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.addEventListener('click', () => {
        app.setCaptureMode(mode);
        sendToBackground({ action: 'INITIATE_CAPTURE', mode, source: 'sidepanel' });
        ui.updateStatus(getStatusText());
        closeMenu('capture-menu', 'capture-menu-btn');
        closeMenu('tools-more-menu', 'tools-more-btn');
    });
}

function bindDropdownMenus() {
    const captureTrigger = document.getElementById('capture-menu-btn');
    if (captureTrigger) {
        captureTrigger.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMenu('capture-menu', 'capture-menu-btn');
        });
    }

    const moreTrigger = document.getElementById('tools-more-btn');
    if (moreTrigger) {
        moreTrigger.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMenu('tools-more-menu', 'tools-more-btn');
        });
    }

    document.addEventListener('click', (event) => {
        const inCapture = event.target.closest?.('#capture-dropdown');
        const inMore = event.target.closest?.('#tools-more-dropdown');
        if (!inCapture) closeMenu('capture-menu', 'capture-menu-btn');
        if (!inMore) closeMenu('tools-more-menu', 'tools-more-btn');
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        const captureMenu = document.getElementById('capture-menu');
        const moreMenu = document.getElementById('tools-more-menu');
        const captureOpen = captureMenu && !captureMenu.hidden;
        const moreOpen = moreMenu && !moreMenu.hidden;
        if (!captureOpen && !moreOpen) return;

        // Consume Escape so generation is not cancelled while menus are open.
        event.preventDefault();
        event.stopPropagation();
        closeMenu('capture-menu', 'capture-menu-btn');
        closeMenu('tools-more-menu', 'tools-more-btn');
    });

    window.addEventListener('resize', () => {
        const captureMenu = document.getElementById('capture-menu');
        const moreMenu = document.getElementById('tools-more-menu');
        if (captureMenu && !captureMenu.hidden) {
            positionFixedMenu(captureMenu, document.getElementById('capture-menu-btn'));
        }
        if (moreMenu && !moreMenu.hidden) {
            positionFixedMenu(moreMenu, document.getElementById('tools-more-btn'));
        }
    });
}

export function bindToolButtonEvents(app, ui) {
    bindDropdownMenus();

    const browserControlBtn = document.getElementById('browser-control-btn');
    if (browserControlBtn) {
        browserControlBtn.addEventListener('click', () => {
            app.toggleBrowserControl();
            if (ui.inputFn) ui.inputFn.focus();
        });
    }

    const liveArtifactsBtn = document.getElementById('live-artifacts-btn');
    if (liveArtifactsBtn) {
        liveArtifactsBtn.addEventListener('click', () => {
            app.toggleLiveArtifacts();
            if (ui.inputFn) ui.inputFn.focus();
        });
    }

    const quoteBtn = document.getElementById('quote-btn');
    if (quoteBtn) {
        quoteBtn.addEventListener('click', () => {
            sendToBackground({ action: 'GET_ACTIVE_SELECTION' });
            closeMenu('tools-more-menu', 'tools-more-btn');
            if (ui.inputFn) ui.inputFn.focus();
        });
    }

    bindCaptureButton('ocr-btn', app, ui, 'ocr', () => t('selectOcr'));
    bindCaptureButton('screenshot-translate-btn', app, ui, 'screenshot_translate', () =>
        t('selectTranslate')
    );

    const screenCaptureBtn = document.getElementById('screen-capture-btn');
    if (screenCaptureBtn) {
        screenCaptureBtn.addEventListener('click', () => {
            app.setCaptureMode('screen_capture');
            // Chrome extension sandbox: postMessage target must be '*'
            window.parent.postMessage({ action: 'REQUEST_SCREEN_CAPTURE' }, '*');
            ui.updateStatus(t('selectScreenCapture'));
            closeMenu('tools-more-menu', 'tools-more-btn');
        });
    }

    bindCaptureButton('snip-btn', app, ui, 'snip', () => t('selectSnip'));
}
