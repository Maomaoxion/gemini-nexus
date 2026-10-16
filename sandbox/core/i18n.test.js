// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { applyTranslations, formatT, setLanguagePreference, t } from './i18n.js';
import translationsSource from './translations.js?raw';

function getLocaleBlock(locale) {
    const match = translationsSource.match(
        new RegExp(`\\n    ${locale}: \\{([\\s\\S]*?)\\n    \\}`, 'm')
    );
    return match ? match[1] : '';
}

function getDeclaredKeys(locale) {
    return [...getLocaleBlock(locale).matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((match) => match[1]);
}

describe('i18n translations', () => {
    it('keeps locale keys unique and separated by meaning', () => {
        for (const locale of ['en', 'zh']) {
            const keys = getDeclaredKeys(locale);
            expect(keys).toHaveLength(new Set(keys).size);
        }

        setLanguagePreference('zh');
        expect(t('dataManagement')).toBe('数据管理');
        expect(t('systemDefault')).toBe('跟随系统');
    });

    it('keeps locale key order aligned for easy review', () => {
        expect(getDeclaredKeys('zh')).toEqual(getDeclaredKeys('en'));
    });

    it('localizes dynamic UI copy used outside data-i18n templates', () => {
        setLanguagePreference('zh');

        expect(formatT('mcpSummarySelected', { mode: '已选择', count: 1, total: 2 })).toBe(
            '模式：已选择。已暴露工具：1/2。'
        );
        expect(t('copyCode')).toBe('复制代码');
        expect(t('screenCapture')).toBe('屏幕截图');
        expect(t('toolStatusRunning').replace('{name}', 'browser')).toBe('正在使用 browser...');
    });

    it('keeps side-panel image prompts precise and injection-resistant', () => {
        setLanguagePreference('en');
        expect(t('ocrPrompt')).toContain('following reading order');
        expect(t('ocrPrompt')).toContain('No text detected');
        expect(t('screenshotTranslatePrompt')).toContain('Output ONLY the translation');
        expect(t('screenshotTranslatePrompt')).toContain('No text detected');

        setLanguagePreference('zh');
        expect(t('ocrPrompt')).toContain('按阅读顺序');
        expect(t('ocrPrompt')).toContain('未检测到文字');
        expect(t('screenshotTranslatePrompt')).toContain('仅输出翻译结果');
        expect(t('screenshotTranslatePrompt')).toContain('未检测到文字');
    });

    it('mirrors localized titles into aria labels for icon-only controls', () => {
        setLanguagePreference('zh');
        document.body.innerHTML = `
            <button data-i18n-title="newChatTooltip" title="New Chat"></button>
            <button data-i18n-title="close" title="Close" aria-label="Close"></button>
        `;

        applyTranslations();

        const [newChat, close] = document.querySelectorAll('button');
        expect(newChat.title).toBe('新对话 (Alt+N)');
        expect(newChat.getAttribute('aria-label')).toBe('新对话 (Alt+N)');
        expect(close.title).toBe('关闭');
        expect(close.getAttribute('aria-label')).toBe('关闭');
    });
});
