// @ts-check
/**
 * Sync the packaged extension onto the local APFS volume so chrome://extensions
 * "Reload" is less likely to crash Chrome (EXC_BREAKPOINT / CrBrowserMain).
 *
 * Loading unpacked from an external disk (e.g. /Volumes/WD_BLACK/...) has been
 * correlated with full-browser crashes on developer reload under macOS beta +
 * Chrome 150. Prefer ~/Extensions/gemini-nexus for day-to-day Load unpacked.
 *
 * Usage:
 *   node scripts/package-local.mjs
 *   LOCAL_EXTENSION_DIR=~/dev/gemini-nexus-ext node scripts/package-local.mjs
 *
 * Does not package by itself — run package:extension first, or use npm run package:local.
 */
import { access, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'artifacts', 'chrome-extension');

const defaultTarget = path.join(os.homedir(), 'Extensions', 'gemini-nexus');
const targetDir = path.resolve(
    process.env.LOCAL_EXTENSION_DIR?.replace(/^~(?=$|[/\\])/, os.homedir()) || defaultTarget
);

async function main() {
    try {
        await access(path.join(sourceDir, 'manifest.json'));
    } catch {
        console.error(
            `[package-local] Missing ${sourceDir}/manifest.json\n` +
                'Run `npm run package:extension` first (or use `npm run package:local`).'
        );
        process.exit(1);
    }

    // An external source (/Volumes/...) copying into a local target is the
    // expected shape; only an identical source and target is a no-op.
    if (path.resolve(sourceDir) === path.resolve(targetDir)) {
        console.error('[package-local] Source and target are the same path; nothing to do.');
        process.exit(1);
    }

    await mkdir(targetDir, { recursive: true });

    // Trailing slash: copy contents of package into targetDir
    const result = spawnSync(
        'rsync',
        ['-a', '--delete', '--exclude', '.DS_Store', `${sourceDir}/`, `${targetDir}/`],
        { stdio: 'inherit' }
    );

    if (result.status !== 0) {
        console.error('[package-local] rsync failed.');
        process.exit(result.status ?? 1);
    }

    console.log('');
    console.log('[package-local] Synced extension to local disk:');
    console.log(`  ${targetDir}`);
    console.log('');
    console.log('Chrome setup (once):');
    console.log(
        '  1. chrome://extensions → remove the old unpacked path if it points at /Volumes/…'
    );
    console.log('  2. Load unpacked → select the folder above');
    console.log('');
    console.log('Safer than clicking Reload when the browser is crashy:');
    console.log('  • Close the Gemini Nexus side panel first');
    console.log('  • Stop browser control if the “debugging this browser” bar is showing');
    console.log('  • Prefer Disable → Enable, or Service Worker console: chrome.runtime.reload()');
    console.log('');
}

main().catch((error) => {
    console.error('[package-local]', error);
    process.exit(1);
});
