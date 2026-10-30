import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readCss = (file) => readFile(new URL(`./${file}`, import.meta.url), 'utf8');

describe('center column readability and markdown rhythm', () => {
    it('caps the wide-mode conversation column to the composer measure', async () => {
        const chatCss = await readCss('chat.css');

        // The legacy rule let AI prose run the full pane (~117 CPL at 1280px).
        // Rows must mirror the centered composer instead: content shares its
        // --composer-max-width measure, rows add rail(32px)+gap(16px) travel.
        expect(chatCss).not.toMatch(
            /body\.layout-wide \.msg\.user,\s*body\.layout-wide \.msg\.ai\s*{[^}]*max-width:\s*100%/s
        );
        expect(chatCss).toMatch(
            /body\.layout-wide \.msg\.user,\s*body\.layout-wide \.msg\.ai\s*{[^}]*max-width:\s*calc\(var\(--composer-max-width\)\s*\+\s*48px\)/s
        );
        expect(chatCss).toMatch(
            /body\.layout-wide \.msg\.user,\s*body\.layout-wide \.msg\.ai\s*{[^}]*margin-inline:\s*auto/s
        );
        expect(chatCss).toMatch(
            /body\.layout-wide \.msg\.ai \.message-content-container\s*{[^}]*max-width:\s*min\(var\(--composer-max-width\),\s*100%\)/s
        );
    });

    it('pins markdown headings to an explicit in-panel scale', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        // UA-default h1/h2 (32/24px) overwhelm a ~420px sidepanel column;
        // every rung must be pinned, with tightened vertical rhythm.
        expect(markdownCss).toMatch(/\.msg\.ai h1\s*{[^}]*font-size:\s*20px/s);
        expect(markdownCss).toMatch(/\.msg\.ai h2\s*{[^}]*font-size:\s*18px/s);
        expect(markdownCss).toMatch(/\.msg\.ai h3\s*{[^}]*font-size:\s*16px/s);
        expect(markdownCss).toMatch(
            /\.msg\.ai h1,\s*\.msg\.ai h2,\s*\.msg\.ai h3\s*{[^}]*margin:\s*20px 0 8px 0/s
        );
    });

    it('trims the trailing margin of the final block in a message', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        // One universal last-child rule keeps bottom rhythm identical whether
        // a message ends in prose, a list, a table, a quote, or code.
        expect(markdownCss).toMatch(
            /\.message-content-container \.msg-content > :last-child\s*{[^}]*margin-bottom:\s*0/s
        );
    });

    it('constrains bare markdown images to the message column', async () => {
        const mediaCss = await readCss('chat_media.css');

        // Only .chat-image was constrained; raw ![](url) output had no rule.
        expect(mediaCss).toMatch(/\.msg-content img\s*{[^}]*max-width:\s*100%/s);
        expect(mediaCss).toMatch(/\.msg-content img\s*{[^}]*height:\s*auto/s);
    });
});

describe('empty state styling', () => {
    const tipDecls = async () => {
        const chatCss = await readCss('chat.css');
        return chatCss.match(/\.chat-empty-tip\s*{([^}]+(?:\{[^}]*\}[^}]*)*)}/s)?.[1] || '';
    };

    it('sizes tips as comfortable touch targets with icon+text layout', async () => {
        const decls = await tipDecls();
        expect(decls).toMatch(/min-height:\s*44px/);
        expect(decls).toMatch(/display:\s*flex/);
        expect(decls).toMatch(/align-items:\s*flex-start/);
    });

    it('replaces painted dots with real icon slots', async () => {
        const chatCss = await readCss('chat.css');

        // The old ::before dot carried no meaning; icons live in markup now.
        expect(chatCss).not.toMatch(/\.chat-empty-tip::before/);
        expect(chatCss).toMatch(/\.chat-empty-tip-icon\s*{[^}]*flex:\s*0 0 auto/s);
    });

    it('unifies focus rings with the two-layer app language', async () => {
        const chatCss = await readCss('chat.css');

        const rule = chatCss.match(/\.chat-empty-tip:focus-visible\s*{([^}]*)}/s)?.[1] || '';
        expect(rule).toContain('0 0 0 2px var(--bg-body)');
        expect(rule).toContain('0 0 0 4px var(--border-focus)');
    });
});

describe('chat message layout styles', () => {
    it('keeps message entrance animation from trapping opacity at 0', async () => {
        const chatCss = await readCss('chat.css');

        // Base rule must not hard-set opacity (invisible if animation never runs).
        expect(chatCss).toMatch(/\.msg\s*{[^}]*animation:\s*fadeIn[^;]*both/s);
        const msgRule = chatCss.match(/\.msg\s*{([^}]+(?:\{[^}]*\}[^}]*)*)}/s)?.[1] || '';
        // Strip comments before asserting — prose may mention opacity.
        const msgDecls = msgRule.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(msgDecls).not.toMatch(/\bopacity\s*:/);
        expect(msgDecls).not.toMatch(/\btransform\s*:/);
        expect(chatCss).toMatch(/@keyframes\s+fadeIn\s*{[\s\S]*?from\s*{[\s\S]*?opacity:\s*0/s);
        expect(chatCss).toMatch(/prefers-reduced-motion:\s*reduce/);
        expect(chatCss).toMatch(
            /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.msg[\s\S]*?animation:\s*none/s
        );
    });

    it('keeps normal bubbles close to AMC message presentation', async () => {
        const chatCss = await readCss('chat.css');
        const markdownCss = await readCss('chat_markdown.css');

        expect(chatCss).toMatch(/\.msg-row\s*{[^}]*display:\s*flex/s);
        expect(chatCss).toMatch(/\.msg-row\s*{[^}]*gap:\s*16px/s);
        expect(chatCss).toMatch(/\.message-content-container\s*{[^}]*min-width:\s*0/s);
        expect(chatCss).toMatch(/\.message-content-container\s*{[^}]*transition/s);
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.message-content-container\s*{[^}]*max-width:\s*80%/s
        );
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.message-content-container\s*{[^}]*padding:\s*12px 16px/s
        );
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.message-content-container\s*{[^}]*border-radius:\s*(?:16px|var\(--radius-bubble\))/s
        );
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.message-content-container\s*{[^}]*box-shadow:\s*var\(--shadow-sm\)/s
        );
        expect(chatCss).toMatch(/\.msg\.ai\s+\.message-content-container\s*{[^}]*width:\s*100%/s);
        expect(chatCss).toMatch(
            /\.msg\.ai\s+\.message-content-container\s*{[^}]*background:\s*transparent/s
        );
        expect(chatCss).toMatch(/\.message-action-rail\s*{[^}]*width:\s*32px/s);
        // Coarse pointers keep actions visible; fine+hover may hide until hover.
        expect(chatCss).toMatch(/\.message-actions\s*{[^}]*opacity:\s*1/s);
        expect(chatCss).toMatch(
            /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*\.message-actions\s*{[^}]*opacity:\s*0/s
        );
        expect(chatCss).toMatch(/\.msg:hover\s+\.message-actions/s);
        expect(chatCss).toMatch(
            /#chat-history\s*>\s*:not\(\[hidden\]\)\s*\+\s*\.msg\.msg-grouped\s*{[^}]*margin-top:\s*6px/s
        );
        expect(chatCss).toMatch(
            /\.msg\.msg-grouped\s+\.message-avatar\s*{[^}]*visibility:\s*hidden/s
        );
        expect(markdownCss).toContain('.message-content-container .msg-content');
        expect(markdownCss).toMatch(
            /\.message-content-container\s+\.msg-content\s*{[^}]*overflow-wrap:\s*anywhere/s
        );
    });

    it('reads message body text at the composer size', async () => {
        const chatCss = await readCss('chat.css');

        // Message prose shares the textarea's 16px size so reading and writing
        // feel like the same surface; line-height scales proportionally.
        const msgRule = chatCss.match(/\.msg\s*{([^}]+(?:\{[^}]*\}[^}]*)*)}/s)?.[1] || '';
        expect(msgRule).toMatch(/font-size:\s*16px/);
        expect(msgRule).toMatch(/line-height:\s*1\.65/);
    });

    it('tokenizes empty-state tip motion', async () => {
        const chatCss = await readCss('chat.css');

        // Every duration in .chat-empty-tip must come from a motion token;
        // raw second values drift out of sync with --duration-fast.
        const tipRule =
            chatCss.match(/\.chat-empty-tip\s*{([^}]+(?:\{[^}]*\}[^}]*)*)}/s)?.[1] || '';
        const tipDecls = tipRule.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(tipDecls).toMatch(/transition:/);
        expect(tipDecls).toMatch(/transform\s+var\(--duration-fast\)\s+var\(--ease-standard\)/);
        expect(tipDecls).not.toMatch(/\b\d*\.?\d+m?s\b/);
    });

    it('keeps generated images constrained to the message width', async () => {
        const mediaCss = await readCss('chat_media.css');

        expect(mediaCss).toMatch(
            /\.generated-images-grid\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
        );
        expect(mediaCss).toMatch(/\.generated-images-grid\s*{[^}]*min-width:\s*0/s);
        expect(mediaCss).toMatch(/\.generated-images-grid\s*{[^}]*max-width:\s*100%/s);
        expect(mediaCss).toMatch(/\.generated-image\s*{[^}]*display:\s*block/s);
        expect(mediaCss).toMatch(/\.generated-image\s*{[^}]*width:\s*100%/s);
        expect(mediaCss).toMatch(/\.generated-image\s*{[^}]*max-width:\s*100%/s);
        expect(mediaCss).toMatch(/\.generated-image\s*{[^}]*box-sizing:\s*border-box/s);
    });

    it('aligns tool process cards with the assistant content column', async () => {
        const chatCss = await readCss('chat.css');

        expect(chatCss).toMatch(/\.msg\.user\.msg-tool-status\s*{[^}]*background:\s*transparent/s);
        expect(chatCss).toMatch(/\.msg\.user\.msg-tool-status\s*{[^}]*padding:\s*0/s);
        expect(chatCss).toMatch(
            /\.msg\.user\s+\.tool-message-row\s*{[^}]*justify-content:\s*flex-start/s
        );
        expect(chatCss).toMatch(
            /\.tool-message-content-container\s*{[^}]*background:\s*transparent/s
        );
        expect(chatCss).toMatch(/\.tool-message-rail\s*{[^}]*visibility:\s*hidden/s);
    });

    it('keeps diagram previews expanded and compact on errors', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        expect(markdownCss).toMatch(
            /\.live-artifact-preview\[data-live-artifact-kind='html'\]\s*{[^}]*background:\s*transparent/s
        );
        expect(markdownCss).toMatch(/\.live-artifact-body-html\s*{[^}]*min-height:\s*0/s);
        expect(markdownCss).toMatch(/\.live-artifact-body-html\s*{[^}]*background:\s*transparent/s);
        expect(markdownCss).toMatch(
            /\.live-artifact-body-html\s+\.live-artifact-frame\s*{[^}]*min-height:\s*120px/s
        );
        expect(markdownCss).toMatch(
            /\.live-artifact-body-mermaid,[\s\S]*\.live-artifact-body-graphviz\s*{[^}]*max-height:\s*none/s
        );
        expect(markdownCss).toMatch(
            /\.live-artifact-body-mermaid svg,[\s\S]*\.live-artifact-body-graphviz svg\s*{[^}]*max-width:\s*100%/s
        );
        expect(markdownCss).toMatch(/\.live-artifact-body-error\s*{[^}]*min-height:\s*72px/s);
        expect(markdownCss).toMatch(/\.live-artifact-error\s*{[^}]*overflow-wrap:\s*anywhere/s);
        expect(markdownCss).toMatch(/\.live-artifact-error\s*{[^}]*white-space:\s*pre-wrap/s);
        expect(markdownCss).toMatch(
            /\[data-theme=['"]dark['"]\]\s+\.live-artifact-body\s*{[^}]*background:\s*var\(--code-bg\)/s
        );
        expect(markdownCss).toMatch(
            /\[data-theme=['"]dark['"]\]\s+\.live-artifact-body-loading,\s*\[data-theme=['"]dark['"]\]\s+\.live-artifact-error\s*{[^}]*color:\s*var\(--text-secondary\)/s
        );
    });
});

describe('code header theme scoping and targets', () => {
    it('scopes light-theme code overrides without requiring data-theme="light"', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        // The sandbox boot only ever sets data-theme="dark"; light mode is the
        // attribute-less default, so [data-theme='light'] selectors are dead.
        expect(markdownCss).not.toMatch(/\[data-theme='light'\]/);
        const lightScoped = markdownCss.match(/html:not\(\[data-theme='dark'\]\)/g) || [];
        expect(lightScoped.length).toBeGreaterThanOrEqual(4);
    });

    it('drives code header text from a shared readable token', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        expect(markdownCss).toMatch(/\.code-lang\s*{[^}]*color:\s*var\(--code-header-text\)/s);
        expect(markdownCss).toMatch(/\.copy-code-btn\s*{[^}]*color:\s*var\(--code-header-text\)/s);
    });

    it('keeps the copy-code button at least 28px tall', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        expect(markdownCss).toMatch(/\.copy-code-btn\s*{[^}]*min-height:\s*28px/s);
    });
});

describe('thoughts toggle ergonomics', () => {
    it('gives the thoughts toggle a 28px minimum touch target', async () => {
        const referencesCss = await readCss('chat_references.css');

        expect(referencesCss).toMatch(/\.thoughts-toggle\s*{[^}]*min-height:\s*28px/s);
    });
});

describe('markdown extras', () => {
    it('themes horizontal rules with tokens', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        expect(markdownCss).toMatch(/\.msg-content hr\s*{[^}]*border:\s*none/s);
        expect(markdownCss).toMatch(
            /\.msg-content hr\s*{[^}]*border-top:\s*1px solid var\(--border-color\)/s
        );
    });

    it('keeps display math from overflowing the column', async () => {
        const markdownCss = await readCss('chat_markdown.css');

        expect(markdownCss).toMatch(/\.msg-content \.katex-display\s*{[^}]*overflow-x:\s*auto/s);
    });

    it('suppresses entrance animations while history is restoring', async () => {
        const chatCss = await readCss('chat.css');

        expect(chatCss).toMatch(/#chat-history\[data-restoring\] \.msg\s*{[^}]*animation:\s*none/s);
        expect(chatCss).toMatch(
            /#chat-history\[data-restoring\] \.context-compression-notice\s*{[^}]*animation:\s*none/s
        );
    });
});
