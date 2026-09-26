import { describe, expect, it } from 'vitest';

import {
    collectI18nKeysFromSource,
    collectProjectSourceFiles,
    readProjectFile,
} from './project-structure/helpers.js';

function isSandboxI18nSourceFile(sourcePath) {
    if (sourcePath.endsWith('.test.js')) return false;
    if (sourcePath.startsWith('scripts/')) return false;
    if (sourcePath.startsWith('test/')) return false;
    if (sourcePath === 'sandbox/core/translations.js') return false;

    return ['sandbox/', 'settings/'].some((runtimeRoot) => sourcePath.startsWith(runtimeRoot));
}

describe('project i18n', () => {
    it('keeps i18n dictionaries free of untranslated orphan keys', async () => {
        const runtimeFiles = (await collectProjectSourceFiles()).filter(isSandboxI18nSourceFile);
        const i18n = await readProjectFile('sandbox/core/translations.js');
        const usedKeys = new Set();

        for (const runtimeFile of runtimeFiles) {
            const source = await readProjectFile(runtimeFile);
            for (const key of collectI18nKeysFromSource(source)) {
                usedKeys.add(key);
            }
        }

        for (const match of i18n.matchAll(/^\s{8}([A-Za-z][A-Za-z0-9_]*):/gm)) {
            expect(usedKeys.has(match[1]), match[1]).toBe(true);
        }
    });
});

describe('project i18n referenced keys', () => {
    it('defines every key the runtime asks for', async () => {
        // t() falls back to returning the key itself, so a missing entry does not
        // throw — it renders the raw identifier as a visible label or tooltip.
        const { translations } = await import('../sandbox/core/translations.js');
        const runtimeFiles = (await collectProjectSourceFiles()).filter(isSandboxI18nSourceFile);
        const usedKeys = new Set();

        for (const runtimeFile of runtimeFiles) {
            const source = await readProjectFile(runtimeFile);
            for (const key of collectI18nKeysFromSource(source)) {
                usedKeys.add(key);
            }
        }

        for (const language of Object.keys(translations)) {
            const dictionary = translations[language];
            for (const key of usedKeys) {
                expect(dictionary[key], `${language}.${key}`).toBeTypeOf('string');
            }
        }
    });
});
