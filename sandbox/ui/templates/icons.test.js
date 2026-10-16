import { describe, expect, it } from 'vitest';

import { TemplateIcons } from './icons.js';

describe('TemplateIcons', () => {
    it('centralizes common viewer and project link icons', () => {
        expect(TemplateIcons.DOWNLOAD).toContain('<svg');
        expect(TemplateIcons.BROWSER_TAB).toContain('<svg');
        expect(TemplateIcons.GITHUB).toContain('<svg');
        expect(TemplateIcons.RELEASES).toContain('<svg');
        expect(TemplateIcons.ZOOM_IN).toContain('<svg');
        expect(TemplateIcons.ZOOM_OUT).toContain('<svg');
        expect(TemplateIcons.CHECK).toContain('<svg');
        expect(TemplateIcons.COPY).toContain('<svg');
        expect(TemplateIcons.EDIT).toContain('<svg');
        expect(TemplateIcons.PIN).toContain('<svg');
        expect(TemplateIcons.PIN_OFF).toContain('<svg');
        expect(TemplateIcons.SEND).toContain('<svg');
        expect(TemplateIcons.SHARE).toContain('<svg');
        expect(TemplateIcons.STOP).toContain('<svg');
        expect(TemplateIcons.SUMMARY).toContain('<svg');
        expect(TemplateIcons.ACTIVE_TAB).toContain('<svg');
        expect(TemplateIcons.KEY).toContain('<svg');
        expect(TemplateIcons.CODE).toContain('<svg');
        expect(TemplateIcons.ARTIFACTS).toContain('<svg');
        expect(TemplateIcons.CAPTURE_IMAGE).toContain('<svg');
        expect(TemplateIcons.TERMINAL).toContain('<svg');
        expect(TemplateIcons.KEY).toContain(
            'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'
        );
        expect(TemplateIcons.KEY).toContain(
            '<circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle>'
        );
    });

    it('keeps the retry icon as a complete two-arrow refresh cycle', () => {
        expect(TemplateIcons.REFRESH).toContain(
            'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'
        );
        expect(TemplateIcons.REFRESH).toContain('M21 3v5h-5');
        expect(TemplateIcons.REFRESH).toContain(
            'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'
        );
        expect(TemplateIcons.REFRESH).toContain('M8 16H3v5');
    });

    it('keeps the new group icon aligned with AMC lucide Folders', () => {
        expect(TemplateIcons.NEW_GROUP).toContain(
            'M20 17a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.9a2 2 0 0 1-1.69-.9l-.81-1.2a2 2 0 0 0-1.67-.9H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z'
        );
        expect(TemplateIcons.NEW_GROUP).toContain('M2 8v11a2 2 0 0 0 2 2h14');
    });

    it('uses a release tag icon for the GitHub releases link', () => {
        expect(TemplateIcons.RELEASES).toContain('M12.586 2.586A2 2 0 0 0 11.172 2H4');
        expect(TemplateIcons.RELEASES).toContain(
            '<circle cx="7.5" cy="7.5" r=".5" fill="currentColor"></circle>'
        );
        expect(TemplateIcons.RELEASES).not.toContain('M18 8h1a4 4 0 0 1 0 8h-1');
        expect(TemplateIcons.RELEASES).not.toContain('M2 8h16v9a4 4 0 0 1-4 4H6');
    });

    it('uses semantic icons for composer tools', () => {
        // Browser control: mask span colored by currentColor (asset wired in CSS).
        expect(TemplateIcons.BROWSER_CONTROL).toContain('tool-icon-browser-control');
        expect(TemplateIcons.BROWSER_CONTROL).toContain('role="img"');
        expect(TemplateIcons.BROWSER_CONTROL).toContain('<span');
        expect(TemplateIcons.BROWSER_CONTROL).not.toContain('<img');
        // Page context: document with text lines (not a sidebar panel).
        expect(TemplateIcons.PAGE_CONTEXT).toContain('M15 2H6a2 2 0 0 0-2 2v16');
        expect(TemplateIcons.PAGE_CONTEXT).toContain('M16 13H8');
        expect(TemplateIcons.PAGE_CONTEXT).not.toContain('x1="9" y1="3" x2="9" y2="21"');
        // Artifacts: Wand sparkles aligned with AMC (not window panes).
        expect(TemplateIcons.ARTIFACTS).toContain('m21.64 3.64');
        expect(TemplateIcons.ARTIFACTS).toContain('m14 7 3 3');
        expect(TemplateIcons.ARTIFACTS).not.toContain('M3 9h18');
        // Capture-as-image is distinct from the crop menu trigger.
        expect(TemplateIcons.CAPTURE_IMAGE).toContain('m21 15-3.086-3.086');
        expect(TemplateIcons.SNIP).toContain('M6 2v14a2 2 0 0 0 2 2h14');
        expect(TemplateIcons.CAPTURE_IMAGE).not.toBe(TemplateIcons.SNIP);
    });

    it('uses stacked browser tabs for the tab switcher trigger', () => {
        expect(TemplateIcons.TAB_STACK).toContain(
            '<rect x="7" y="3" width="14" height="12" rx="2"></rect>'
        );
        expect(TemplateIcons.TAB_STACK).toContain('M7 7h14');
        expect(TemplateIcons.TAB_STACK).toContain('M3 8v11a2 2 0 0 0 2 2h12');
        expect(TemplateIcons.TAB_STACK).not.toContain('M2 6h20v13a2 2 0 0 1-2 2H4');
        expect(TemplateIcons.TAB_STACK).not.toContain('M2 6l2.5-3.5A2 2 0 0 1');
    });

    it('uses a webpage window icon for the active tab trigger', () => {
        expect(TemplateIcons.ACTIVE_TAB).toContain(
            '<rect x="3" y="4" width="18" height="16" rx="2"></rect>'
        );
        expect(TemplateIcons.ACTIVE_TAB).toContain('M3 9h18');
        expect(TemplateIcons.ACTIVE_TAB).toContain('M7 6.5h.01');
        expect(TemplateIcons.ACTIVE_TAB).toContain('M10 6.5h.01');
        expect(TemplateIcons.ACTIVE_TAB).toContain('M7 13h10');
        expect(TemplateIcons.ACTIVE_TAB).toContain('M7 17h6');
        expect(TemplateIcons.ACTIVE_TAB).not.toContain('m11 13 5.5 7');
        expect(TemplateIcons.ACTIVE_TAB).not.toContain('M3 8v11a2 2 0 0 0 2 2h12');
    });
});
