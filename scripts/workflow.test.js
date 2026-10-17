import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// The release workflow runs the project checks as explicit steps (rather than
// `npm run check`) so a failure names the exact gate. Keep the ordering
// guarantee: every check must run before the extension is packaged.
const CHECK_COMMANDS = [
    'npm run format:check',
    'npm run build',
    'npm exec tsc -- --noEmit',
    'npm run lint:unused',
    'npx vitest run',
];

describe('release workflow', () => {
    it('runs the full project check before packaging the extension', async () => {
        const source = await readFile('.github/workflows/package-extension.yml', 'utf8');
        const packageIndex = source.indexOf('run: npm run package:extension');

        expect(packageIndex).toBeGreaterThan(-1);
        for (const command of CHECK_COMMANDS) {
            const checkIndex = source.indexOf(command);
            expect(checkIndex, `missing check step: ${command}`).toBeGreaterThan(-1);
            expect(checkIndex, `check step runs after packaging: ${command}`).toBeLessThan(
                packageIndex
            );
        }
    });
});
