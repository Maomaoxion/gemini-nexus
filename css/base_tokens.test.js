import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readCss = (file) => readFile(new URL(`./${file}`, import.meta.url), 'utf8');

// WCAG 2.x relative luminance for a #rrggbb color.
function luminance(hex) {
    const channels = [0, 2, 4]
        .map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(fgHex, bgHex) {
    const fg = luminance(fgHex);
    const bg = luminance(bgHex);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

// Pull one token value out of a specific custom-property block.
function tokenIn(block, name) {
    const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
    if (!match) throw new Error(`token --${name} not found as a hex value`);
    return match[1];
}

describe('base theme tokens', () => {
    it('keeps input placeholders readable in both themes', async () => {
        const baseCss = await readCss('base.css');

        const rootBlock = baseCss.match(/:root\s*{([^}]*)}/s)?.[1] || '';
        const darkBlock = baseCss.match(/\[data-theme='dark'\]\s*{([^}]*)}/s)?.[1] || '';

        const placeholderLight = tokenIn(rootBlock, 'input-placeholder');
        const placeholderDark = tokenIn(darkBlock, 'input-placeholder');
        const bgInputLight = tokenIn(rootBlock, 'bg-input');
        const bgInputFocusLight = tokenIn(rootBlock, 'bg-input-focus');
        const bgInputDark = tokenIn(darkBlock, 'bg-input');
        const bgInputFocusDark = tokenIn(darkBlock, 'bg-input-focus');

        // Placeholders must meet AA on every surface they sit on. The two
        // themes declare separate values so brightening one background
        // cannot silently drag the other below the threshold.
        expect(contrast(placeholderLight, bgInputLight)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(placeholderLight, bgInputFocusLight)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(placeholderDark, bgInputDark)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(placeholderDark, bgInputFocusDark)).toBeGreaterThanOrEqual(4.5);

        // A placeholder must still read as a hint, not as body copy.
        expect(placeholderLight).not.toBe(tokenIn(rootBlock, 'text-primary'));
        expect(placeholderDark).not.toBe(tokenIn(darkBlock, 'text-primary'));
    });

    it('keeps semantic colors readable against their theme surfaces', async () => {
        const baseCss = await readCss('base.css');

        const rootBlock = baseCss.match(/:root\s*{([^}]*)}/s)?.[1] || '';
        const darkBlock = baseCss.match(/\[data-theme='dark'\]\s*{([^}]*)}/s)?.[1] || '';

        const bgBodyLight = tokenIn(rootBlock, 'bg-body');
        const bgBodyDark = tokenIn(darkBlock, 'bg-body');

        const dangerLight = tokenIn(rootBlock, 'danger');
        const dangerDark = tokenIn(darkBlock, 'danger');
        const successLight = tokenIn(rootBlock, 'success');
        const successDark = tokenIn(darkBlock, 'success');
        const warningLight = tokenIn(rootBlock, 'warning');
        const warningDark = tokenIn(darkBlock, 'warning');

        expect(contrast(dangerLight, bgBodyLight)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(dangerDark, bgBodyDark)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(successLight, bgBodyLight)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(successDark, bgBodyDark)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(warningLight, bgBodyLight)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(warningDark, bgBodyDark)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('code block header tokens', () => {
    // Composite a translucent veil over an opaque surface, returning #rrggbb.
    function blendHex(alpha, fgHex, bgHex) {
        const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
        return (
            '#' +
            [0, 1, 2]
                .map((i) => Math.round(channel(fgHex, i) * alpha + channel(bgHex, i) * (1 - alpha)))
                .map((v) => v.toString(16).padStart(2, '0'))
                .join('')
        );
    }

    it('keeps code header label readable on both header surfaces', async () => {
        const baseCss = await readCss('base.css');

        const rootBlock = baseCss.match(/:root\s*{([^}]*)}/s)?.[1] || '';
        const darkBlock = baseCss.match(/\[data-theme='dark'\]\s*{([^}]*)}/s)?.[1] || '';

        const lightText = tokenIn(rootBlock, 'code-header-text');
        const darkText = tokenIn(darkBlock, 'code-header-text');

        // Light theme: solid tinted strip used by the scoped header override.
        expect(contrast(lightText, '#e9eef6')).toBeGreaterThanOrEqual(4.5);
        // Dark theme: 3% white veil over the dark --code-bg surface.
        const darkHeaderBg = blendHex(0.03, '#ffffff', '#28292a');
        expect(contrast(darkText, darkHeaderBg)).toBeGreaterThanOrEqual(4.5);

        // One theme brightening its surface must not drag the other down.
        expect(lightText).not.toBe(darkText);
    });
});
