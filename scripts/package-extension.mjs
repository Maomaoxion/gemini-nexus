// @ts-check
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_SCRIPT_ORDER, YOUTUBE_SCRIPT_ORDER } from './content-script-order.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const artifactsDir = path.join(rootDir, 'artifacts');
const packageDir = path.join(artifactsDir, 'chrome-extension');

const localDependencyAssets = [
    {
        source: 'node_modules/katex/dist/katex.min.css',
        target: 'vendor/katex/katex.min.css',
    },
    {
        source: 'node_modules/katex/dist/fonts',
        target: 'vendor/katex/fonts',
    },
    {
        source: 'node_modules/highlight.js/styles/atom-one-dark.min.css',
        target: 'vendor/highlight.js/atom-one-dark.min.css',
    },
    {
        source: 'node_modules/highlight.js/styles/atom-one-light.min.css',
        target: 'vendor/highlight.js/atom-one-light.min.css',
    },
];

const requiredPaths = [
    'manifest.json',
    'logo.png',
    'assets/icons',
    'assets/cursors',
    'content/cursor',
    'background',
    'shared',
    'services',
    'dist/assets',
    'dist/sidepanel/index.html',
    'dist/sidepanel/preload.js',
    'dist/sandbox/index.html',
    'dist/settings/index.html',
    'vendor/gemini-watermark-remover',
];
const directoryCopiedRuntimePrefixes = ['vendor/gemini-watermark-remover/'];

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
export function shouldExcludeFromPackage(relativePath) {
    const normalized = relativePath.split(path.sep).join('/');
    const basename = path.basename(normalized);
    return basename.endsWith('.test.js') || basename.endsWith('.test.ts');
}

/**
 * @param {{ content_scripts?: Array<Record<string, unknown> & { js?: string[] }> } & Record<string, unknown>} manifest
 */
export function createPackagedManifest(manifest) {
    let hasWrittenContentBundleEntry = false;
    const contentScripts = [];

    for (const entry of manifest.content_scripts ?? []) {
        if (
            entry.world === 'MAIN' ||
            entry.all_frames === true ||
            entry.js?.includes('content/gemini_watermark_bridge.js')
        ) {
            contentScripts.push(entry);
            continue;
        }

        if (entry.js?.includes('content/youtube_summary.js')) {
            contentScripts.push({ ...entry, js: ['content/youtube_summary_bundle.js'] });
            continue;
        }

        if (hasWrittenContentBundleEntry) continue;
        hasWrittenContentBundleEntry = true;
        contentScripts.push({
            ...entry,
            js: ['content/index.js'],
        });
    }

    return {
        ...manifest,
        content_scripts: contentScripts,
    };
}

/**
 * @param {Array<{ relativePath: string, source: string }>} segments
 */
export function formatContentBundle(segments) {
    return (
        segments
            .map(({ relativePath, source }) =>
                [`// ----- ${relativePath} -----`, source.trimEnd()].join('\n')
            )
            .join('\n\n') + '\n'
    );
}

/**
 * @param {{ content_scripts?: Array<{ world?: string, all_frames?: boolean, js?: string[] }> }} manifest
 * @returns {string[]}
 */
export function getUnbundledContentScriptFiles(manifest) {
    return [
        ...new Set(
            (manifest.content_scripts ?? [])
                .filter(
                    (entry) =>
                        entry.world === 'MAIN' ||
                        entry.all_frames === true ||
                        entry.js?.includes('content/gemini_watermark_bridge.js')
                )
                .flatMap((entry) => entry.js ?? [])
                .filter(
                    (relativePath) =>
                        !directoryCopiedRuntimePrefixes.some((prefix) =>
                            relativePath.startsWith(prefix)
                        )
                )
        ),
    ];
}

/**
 * Normalize an HTML asset reference to a package-root-relative path.
 * Accepts `/assets/x`, `./assets/x`, `../assets/x`, `assets/x`.
 * @param {string} reference
 * @returns {string | null}
 */
export function normalizePackagedAssetReference(reference) {
    if (!reference || typeof reference !== 'string') return null;
    if (/^(?:https?:|data:|chrome-extension:)/i.test(reference)) return null;
    let clean = reference.split(/[?#]/)[0];
    clean = clean.replace(/\\/g, '/');
    // Strip leading ./ and any number of ../ so package-root assets resolve.
    clean = clean
        .replace(/^(?:\.\.\/)+/, '')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '');
    if (!clean.startsWith('assets/')) return null;
    return clean;
}

/**
 * @param {string} html
 * @returns {string[]}
 */
export function collectPackagedAssetReferences(html) {
    const references = new Set();
    const attributePattern = /\b(?:href|src)=["']([^"']+)["']/g;

    for (const match of html.matchAll(attributePattern)) {
        const assetReference = normalizePackagedAssetReference(match[1]);
        if (assetReference) references.add(assetReference);
    }

    return [...references].sort();
}

/**
 * Rewrite absolute `/assets/...` references in packaged HTML to relative paths
 * based on the HTML file's directory depth (sidepanel/ → ../assets/...).
 * @param {string} html
 * @param {string} htmlRelativePath e.g. 'sandbox/index.html'
 * @returns {string}
 */
export function rewriteHtmlAssetPathsToRelative(html, htmlRelativePath) {
    const depth = htmlRelativePath.split(/[/\\]/).length - 1;
    const prefix = depth > 0 ? `${'../'.repeat(depth)}assets/` : 'assets/';
    return html.replace(
        /\b(href|src)=["']\/assets\/([^"']+)["']/g,
        (_match, attr, rest) => `${attr}="${prefix}${rest}"`
    );
}

/**
 * @param {string} packageRoot
 * @param {string[]} htmlRelativePaths
 * @returns {Promise<string[]>}
 */
export async function findMissingPackagedAssetReferences(packageRoot, htmlRelativePaths) {
    const missingReferences = [];

    for (const htmlRelativePath of htmlRelativePaths) {
        const html = await readFile(path.join(packageRoot, htmlRelativePath), 'utf8');
        const assetReferences = collectPackagedAssetReferences(html);

        for (const assetReference of assetReferences) {
            try {
                await stat(path.join(packageRoot, assetReference));
            } catch {
                missingReferences.push(`${htmlRelativePath} -> ${assetReference}`);
            }
        }
    }

    return missingReferences;
}

async function rewritePackagedHtmlAssetPaths() {
    const htmlRelativePaths = ['sidepanel/index.html', 'sandbox/index.html', 'settings/index.html'];
    for (const htmlRelativePath of htmlRelativePaths) {
        const absolutePath = path.join(packageDir, htmlRelativePath);
        const original = await readFile(absolutePath, 'utf8');
        const rewritten = rewriteHtmlAssetPathsToRelative(original, htmlRelativePath);
        if (rewritten !== original) {
            await writeFile(absolutePath, rewritten, 'utf8');
        }
    }
}

async function ensurePackagedHtmlAssetReferences() {
    await rewritePackagedHtmlAssetPaths();

    const missingReferences = await findMissingPackagedAssetReferences(packageDir, [
        'sidepanel/index.html',
        'sandbox/index.html',
        'settings/index.html',
    ]);

    if (missingReferences.length > 0) {
        throw new Error(
            [
                'Packaged HTML references missing asset files:',
                ...missingReferences.map((reference) => `- ${reference}`),
            ].join('\n')
        );
    }
}

/**
 * @param {string} relativePath
 */
async function ensureExists(relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    try {
        await stat(absolutePath);
    } catch {
        throw new Error(`Missing required build input: ${relativePath}`);
    }
}

/**
 * @param {string} sourceRelativePath
 * @param {string} [targetRelativePath]
 */
async function copyIntoPackage(sourceRelativePath, targetRelativePath = sourceRelativePath) {
    const source = path.join(rootDir, sourceRelativePath);
    const target = path.join(packageDir, targetRelativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, {
        recursive: true,
        filter: (sourcePath) => {
            const relativePath = path.relative(rootDir, sourcePath);
            return !shouldExcludeFromPackage(relativePath);
        },
    });
}

async function copyLocalDependencyAssets() {
    await Promise.all(
        localDependencyAssets.map((asset) => copyIntoPackage(asset.source, asset.target))
    );
}

async function writePackagedManifest() {
    const manifest = JSON.parse(await readFile(path.join(rootDir, 'manifest.json'), 'utf8'));
    await writeFile(
        path.join(packageDir, 'manifest.json'),
        JSON.stringify(createPackagedManifest(manifest), null, 2) + '\n',
        'utf8'
    );
}

/**
 * Concatenate one manifest script order into a single bundled classic script.
 * @param {string[]} scriptOrder
 * @param {string} targetRelativePath
 */
async function writeContentBundle(scriptOrder, targetRelativePath) {
    const segments = await Promise.all(
        scriptOrder.map(async (relativePath) => ({
            relativePath,
            source: await readFile(path.join(rootDir, relativePath), 'utf8'),
        }))
    );

    const target = path.join(packageDir, targetRelativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, formatContentBundle(segments), 'utf8');
}

async function copyUnbundledContentScripts() {
    /** @type {{ content_scripts?: Array<{ world?: string, all_frames?: boolean, js?: string[] }> }} */
    const manifest = JSON.parse(await readFile(path.join(rootDir, 'manifest.json'), 'utf8'));
    const files = getUnbundledContentScriptFiles(manifest);

    await Promise.all(files.map((relativePath) => copyIntoPackage(relativePath)));
}

/**
 * @param {string} directory
 */
async function removeJunkFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });

    await Promise.all(
        entries.map(async (entry) => {
            const fullPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                await removeJunkFiles(fullPath);
                return;
            }

            if (entry.name === '.DS_Store') {
                await rm(fullPath, { force: true });
            }
        })
    );
}

async function main() {
    for (const relativePath of requiredPaths) {
        await ensureExists(relativePath);
    }
    for (const relativePath of CONTENT_SCRIPT_ORDER) {
        await ensureExists(relativePath);
    }
    for (const asset of localDependencyAssets) {
        await ensureExists(asset.source);
    }

    await rm(packageDir, { recursive: true, force: true });
    await mkdir(packageDir, { recursive: true });

    await Promise.all([
        writePackagedManifest(),
        copyIntoPackage('logo.png'),
        copyIntoPackage('assets/icons'),
        copyIntoPackage('assets/cursors'),
        copyIntoPackage('background'),
        writeContentBundle(CONTENT_SCRIPT_ORDER, 'content/index.js'),
        writeContentBundle(YOUTUBE_SCRIPT_ORDER, 'content/youtube_summary_bundle.js'),
        copyUnbundledContentScripts(),
        copyIntoPackage('content/cursor'),
        copyIntoPackage('shared'),
        copyIntoPackage('services'),
        copyIntoPackage('vendor/gemini-watermark-remover'),
        copyLocalDependencyAssets(),
        copyIntoPackage('dist/assets', 'assets'),
        copyIntoPackage('dist/sidepanel/index.html', 'sidepanel/index.html'),
        copyIntoPackage('dist/sidepanel/preload.js', 'sidepanel/preload.js'),
        copyIntoPackage('dist/sandbox/index.html', 'sandbox/index.html'),
        copyIntoPackage('dist/settings/index.html', 'settings/index.html'),
    ]);

    await removeJunkFiles(packageDir);
    await ensurePackagedHtmlAssetReferences();

    const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
    await writeFile(
        path.join(packageDir, 'build-info.json'),
        JSON.stringify(
            {
                name: packageJson.name,
                version: packageJson.version,
                builtAt: new Date().toISOString(),
            },
            null,
            2
        ) + '\n',
        'utf8'
    );

    console.log(`Extension package prepared at ${path.relative(rootDir, packageDir)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
