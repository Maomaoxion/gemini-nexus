import { formatT, t } from '../core/i18n.js';
import { TemplateIcons } from './templates/icons.js';
import { normalizeComposerDraftTabs } from '../../shared/text/composer_draft.js';

const MENTION_PATTERN = /(?:^|\s)@([^\s@]*)$/;
const MAX_STACKED_ICONS = 3;
const CANDIDATE_REQUEST_TIMEOUT_MS = 5000;

export class TabMentionController {
    constructor({ inputFn, referenceBar, menu, onRequestTabs, onChange } = {}) {
        this.inputFn = inputFn || null;
        this.referenceBar = referenceBar || null;
        this.menu = menu || null;
        this.onRequestTabs = typeof onRequestTabs === 'function' ? onRequestTabs : null;
        this.onChange = typeof onChange === 'function' ? onChange : null;

        this.references = [];
        this.candidates = [];
        this.visibleCandidates = [];
        this.currentTabId = null;
        this.query = '';
        this.mentionStart = -1;
        this.activeIndex = 0;
        this.menuOpen = false;
        this.composing = false;
        this.requesting = false;
        this.requestTimer = null;
        this.expanded = false;

        this.bindEvents();
        this.renderReferences();
    }

    setCallbacks({ onRequestTabs, onChange } = {}) {
        if (typeof onRequestTabs === 'function') this.onRequestTabs = onRequestTabs;
        if (typeof onChange === 'function') this.onChange = onChange;
    }

    bindEvents() {
        if (this.inputFn) {
            this.inputFn.addEventListener('input', (event) => {
                if (event.isComposing) return;
                this.syncMentionFromCursor();
            });
            this.inputFn.addEventListener('keydown', (event) => this.handleKeyDown(event), true);
            this.inputFn.addEventListener('keyup', (event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    this.syncMentionFromCursor();
                }
            });
            this.inputFn.addEventListener('click', () => this.syncMentionFromCursor());
            this.inputFn.addEventListener('compositionstart', () => {
                this.composing = true;
            });
            this.inputFn.addEventListener('compositionend', () => {
                this.composing = false;
                this.syncMentionFromCursor();
            });
        }

        if (this.menu) {
            // Keep the textarea focused while clicking a candidate so the
            // caret position used for removing "@query" stays valid.
            this.menu.addEventListener('mousedown', (event) => event.preventDefault());
            this.menu.addEventListener('click', (event) => this.handleMenuClick(event));
        }

        if (this.referenceBar) {
            this.referenceBar.addEventListener('click', (event) =>
                this.handleReferenceClick(event)
            );
        }

        document.addEventListener('click', (event) => {
            if (!this.menuOpen) return;
            if (this.menu?.contains(event.target) || this.inputFn?.contains(event.target)) return;
            this.closeMenu();
        });

        window.addEventListener('resize', () => {
            if (this.menuOpen) this.positionMenu();
        });
    }

    syncMentionFromCursor() {
        if (!this.inputFn || this.composing) return;

        const value = this.inputFn.value;
        const cursor =
            typeof this.inputFn.selectionStart === 'number'
                ? this.inputFn.selectionStart
                : value.length;
        const before = value.slice(0, cursor);
        const match = before.match(MENTION_PATTERN);

        if (!match) {
            this.closeMenu();
            return;
        }

        this.query = match[1];
        this.mentionStart = cursor - this.query.length - 1;
        this.openMenu();
    }

    openMenu() {
        if (!this.menu) return;

        if (!this.menuOpen) {
            this.menuOpen = true;
            this.activeIndex = 0;
            this.menu.hidden = false;
            this.requestCandidates();
        }

        this.renderMenu();
        this.positionMenu();
    }

    closeMenu() {
        this.menuOpen = false;
        this.query = '';
        this.mentionStart = -1;
        this.visibleCandidates = [];
        this.activeIndex = 0;
        if (this.menu) this.menu.hidden = true;
    }

    isMenuOpen() {
        return this.menuOpen;
    }

    requestCandidates() {
        if (this.requesting || typeof this.onRequestTabs !== 'function') return;

        this.requesting = true;
        this.clearRequestTimer();
        this.requestTimer = setTimeout(() => {
            this.requesting = false;
            this.requestTimer = null;
            if (this.menuOpen) this.renderMenu();
        }, CANDIDATE_REQUEST_TIMEOUT_MS);

        this.onRequestTabs();
    }

    clearRequestTimer() {
        if (this.requestTimer) {
            clearTimeout(this.requestTimer);
            this.requestTimer = null;
        }
    }

    setCandidates(tabs, currentTabId = null) {
        this.requesting = false;
        this.clearRequestTimer();
        if (Number.isInteger(currentTabId) && currentTabId > 0) {
            this.currentTabId = currentTabId;
        }
        this.candidates = this.withCurrentTabFirst(Array.isArray(tabs) ? tabs : []);
        if (this.menuOpen) {
            this.activeIndex = 0;
            this.renderMenu();
            this.positionMenu();
        }
    }

    withCurrentTabFirst(tabs) {
        const index = tabs.findIndex((tab) => tab.id === this.currentTabId);
        if (index <= 0) return tabs;
        return [tabs[index], ...tabs.slice(0, index), ...tabs.slice(index + 1)];
    }

    setCurrentTabId(tabId) {
        this.currentTabId = Number.isInteger(tabId) && tabId > 0 ? tabId : null;
        if (this.references.length > 0) this.renderReferences();
    }

    hasReference(tabId) {
        return this.references.some((tab) => tab.id === tabId);
    }

    addReference(tab) {
        const id = Number(tab?.id);
        if (!Number.isInteger(id) || id <= 0 || this.hasReference(id)) return false;

        this.references.push({
            id,
            title: typeof tab.title === 'string' ? tab.title : '',
            url: typeof tab.url === 'string' ? tab.url : '',
            favIconUrl: typeof tab.favIconUrl === 'string' ? tab.favIconUrl : '',
        });
        this.renderReferences();
        this.notifyChange();
        return true;
    }

    removeReference(tabId) {
        const next = this.references.filter((tab) => tab.id !== tabId);
        if (next.length === this.references.length) return false;

        this.references = next;
        if (this.references.length < 2) this.expanded = false;
        this.renderReferences();
        this.notifyChange();
        return true;
    }

    setReferences(tabs, { silent = false } = {}) {
        this.references = normalizeComposerDraftTabs(tabs);
        this.expanded = false;
        this.renderReferences();
        if (!silent) this.notifyChange();
    }

    getReferences() {
        return this.references.map((tab) => ({ ...tab }));
    }

    notifyChange() {
        if (typeof this.onChange === 'function') this.onChange();
    }

    handleKeyDown(event) {
        if (!this.menuOpen || this.composing) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            this.moveActive(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            this.moveActive(-1);
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            const tab = this.visibleCandidates[this.activeIndex];
            if (tab) {
                this.selectCandidate(tab);
            } else {
                // Nothing to pick: consume Enter so it cannot send the
                // half-written prompt while the picker still owns the input.
                this.closeMenu();
            }
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.closeMenu();
        }
    }

    moveActive(direction) {
        if (this.visibleCandidates.length === 0) return;
        const count = this.visibleCandidates.length;
        this.activeIndex = (this.activeIndex + direction + count) % count;
        this.renderMenu();
        this.scrollActiveIntoView();
    }

    scrollActiveIntoView() {
        const active = this.menu?.querySelector?.('.tab-mention-item.is-active');
        active?.scrollIntoView?.({ block: 'nearest' });
    }

    handleMenuClick(event) {
        const item = event.target.closest?.('[data-tab-id]');
        if (!item || item.classList.contains('is-selected')) return;

        const tabId = Number(item.dataset.tabId);
        const tab = this.candidates.find((candidate) => candidate.id === tabId);
        if (tab) this.selectCandidate(tab);
    }

    selectCandidate(tab) {
        if (!this.inputFn || !tab) return;

        const start = this.mentionStart >= 0 ? this.mentionStart : this.inputFn.selectionStart;
        const value = this.inputFn.value;
        const cursor =
            typeof this.inputFn.selectionStart === 'number'
                ? this.inputFn.selectionStart
                : value.length;

        this.inputFn.value = value.slice(0, start) + value.slice(cursor);
        const nextCaret = Math.max(0, Math.min(start, this.inputFn.value.length));
        this.inputFn.setSelectionRange?.(nextCaret, nextCaret);

        this.addReference(tab);
        this.closeMenu();
        this.inputFn.focus();
        this.inputFn.dispatchEvent(new Event('input', { bubbles: true }));
    }

    handleReferenceClick(event) {
        const remove = event.target.closest?.('[data-remove-tab-id]');
        if (remove) {
            event.preventDefault();
            this.removeReference(Number(remove.dataset.removeTabId));
            return;
        }

        const toggle = event.target.closest?.('.tab-reference-toggle');
        if (toggle) {
            event.preventDefault();
            this.expanded = !this.expanded;
            this.renderReferences();
        }
    }

    filteredCandidates() {
        const query = this.query.trim().toLowerCase();
        return this.candidates.filter((tab) => {
            if (!query) return true;
            const haystack = `${tab.title || ''} ${tab.url || ''}`.toLowerCase();
            return haystack.includes(query);
        });
    }

    renderMenu() {
        if (!this.menu) return;

        this.visibleCandidates = this.filteredCandidates();
        this.menu.innerHTML = '';

        if (this.visibleCandidates.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'tab-mention-empty';
            empty.textContent = this.requesting ? t('tabMentionLoading') : t('tabMentionNoMatch');
            this.menu.appendChild(empty);
            return;
        }

        if (this.activeIndex >= this.visibleCandidates.length) this.activeIndex = 0;

        this.visibleCandidates.forEach((tab, index) => {
            const selected = this.hasReference(tab.id);
            const item = document.createElement('div');
            item.className = 'tab-mention-item';
            item.dataset.tabId = String(tab.id);
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(index === this.activeIndex));
            item.classList.toggle('is-active', index === this.activeIndex);
            item.classList.toggle('is-selected', selected);
            item.classList.toggle('is-disabled', tab.controllable === false);

            item.appendChild(this.createFavicon(tab, 'tab-mention-favicon'));

            const title = document.createElement('span');
            title.className = 'tab-mention-title';
            title.textContent = tab.title || tab.url || `Tab ${tab.id}`;
            item.appendChild(title);

            if (tab.id === this.currentTabId) {
                const badge = document.createElement('span');
                badge.className = 'tab-mention-current';
                badge.textContent = t('currentTabSuffix');
                item.appendChild(badge);
            }

            if (selected) {
                const check = document.createElement('span');
                check.className = 'tab-mention-check';
                check.innerHTML = TemplateIcons.CHECK;
                item.appendChild(check);
            }

            this.menu.appendChild(item);
        });
    }

    positionMenu() {
        if (!this.menu || !this.inputFn) return;

        const rect = this.inputFn.getBoundingClientRect();
        const menuHeight = this.menu.offsetHeight || 0;
        const spaceAbove = rect.top - 8;
        const openBelow = menuHeight > 0 && spaceAbove < menuHeight;
        const width = Math.max(160, Math.min(rect.width, window.innerWidth - 16));
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));

        this.menu.style.width = `${width}px`;
        this.menu.style.left = `${left}px`;
        this.menu.style.top = openBelow
            ? `${rect.bottom + 8}px`
            : `${Math.max(8, rect.top - 6 - menuHeight)}px`;
    }

    renderReferences() {
        if (!this.referenceBar) return;

        this.referenceBar.innerHTML = '';
        this.referenceBar.hidden = this.references.length === 0;
        if (this.references.length === 0) return;

        if (this.references.length === 1) {
            this.referenceBar.appendChild(this.createSingleReference(this.references[0]));
            return;
        }

        this.referenceBar.appendChild(this.createMultiHeader());
        const list = document.createElement('div');
        list.className = 'tab-reference-list';
        list.hidden = !this.expanded;
        this.references.forEach((tab) => list.appendChild(this.createReferenceRow(tab)));
        this.referenceBar.appendChild(list);
    }

    createSingleReference(tab) {
        const row = document.createElement('div');
        row.className = 'tab-reference tab-reference-single';
        row.appendChild(this.createFavicon(tab, 'tab-reference-icon'));

        const label = document.createElement('span');
        label.className = 'tab-reference-label';
        label.textContent = formatT('sharingSingleTab', {
            title: tab.title || tab.url || '',
        });
        row.appendChild(label);
        row.appendChild(this.createRemoveButton(tab, 'tab-reference-remove'));
        return row;
    }

    createMultiHeader() {
        const row = document.createElement('div');
        row.className = 'tab-reference tab-reference-multi';

        const stack = document.createElement('span');
        stack.className = 'tab-reference-stack';
        this.references
            .slice(0, MAX_STACKED_ICONS)
            .forEach((tab) =>
                stack.appendChild(this.createFavicon(tab, 'tab-reference-stack-icon'))
            );
        row.appendChild(stack);

        const label = document.createElement('span');
        label.className = 'tab-reference-label';
        label.textContent = formatT('sharingMultipleTabs', {
            count: this.references.length,
        });
        row.appendChild(label);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'tab-reference-toggle';
        toggle.setAttribute('aria-expanded', String(this.expanded));
        toggle.title = this.expanded ? t('tabMentionCollapse') : t('tabMentionExpand');
        toggle.setAttribute('aria-label', toggle.title);
        toggle.innerHTML = TemplateIcons.CHEVRON_DOWN;
        row.appendChild(toggle);

        return row;
    }

    createReferenceRow(tab) {
        const row = document.createElement('div');
        row.className = 'tab-reference-row';
        row.dataset.tabId = String(tab.id);
        row.appendChild(this.createFavicon(tab, 'tab-reference-row-icon'));

        const title = document.createElement('span');
        title.className = 'tab-reference-row-title';
        title.textContent = tab.title || tab.url || `Tab ${tab.id}`;
        if (tab.id === this.currentTabId) {
            const badge = document.createElement('span');
            badge.className = 'tab-reference-current';
            badge.textContent = t('currentTabSuffix');
            title.appendChild(badge);
        }
        row.appendChild(title);
        row.appendChild(this.createRemoveButton(tab, 'tab-reference-row-remove'));
        return row;
    }

    createFavicon(tab, className) {
        const wrap = document.createElement('span');
        wrap.className = className;

        if (tab.favIconUrl) {
            const image = document.createElement('img');
            image.src = tab.favIconUrl;
            image.alt = '';
            image.addEventListener('error', () => {
                image.hidden = true;
            });
            wrap.appendChild(image);
        } else {
            wrap.innerHTML = TemplateIcons.BROWSER_TAB;
        }

        return wrap;
    }

    createRemoveButton(tab, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.dataset.removeTabId = String(tab.id);
        button.title = t('tabMentionRemove');
        button.setAttribute('aria-label', t('tabMentionRemove'));
        button.textContent = '×';
        return button;
    }
}
