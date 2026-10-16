import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const ignoredProjectScanPaths = [
    '.git',
    'node_modules',
    'dist',
    'artifacts',
    '.superpowers',
    '.trellis',
    'assets/logo-concepts',
];

const IGNORED_PATHS = new Set(ignoredProjectScanPaths);

function normalizeProjectPath(relativePath) {
    return relativePath.split(path.sep).join('/');
}

function isIgnoredProjectPath(relativePath) {
    return IGNORED_PATHS.has(normalizeProjectPath(relativePath));
}

function projectPath(relativePath) {
    return path.join(process.cwd(), relativePath);
}

export async function exists(relativePath) {
    try {
        await stat(projectPath(relativePath));
        return true;
    } catch {
        return false;
    }
}

export async function readProjectFile(relativePath) {
    return readFile(projectPath(relativePath), 'utf8');
}

export async function readJson(relativePath) {
    return JSON.parse(await readProjectFile(relativePath));
}

export async function collectSiblingModuleDirectoryConflicts(relativePath = '.') {
    const entries = await readdir(projectPath(relativePath), { withFileTypes: true });
    const directoryNames = new Set(
        entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    );
    const conflicts = [];

    for (const entry of entries) {
        const entryPath = path.join(relativePath, entry.name);

        if (entry.isDirectory() && !isIgnoredProjectPath(entryPath)) {
            conflicts.push(...(await collectSiblingModuleDirectoryConflicts(entryPath)));
        }

        if (entry.isFile() && entry.name.endsWith('.js')) {
            const moduleName = entry.name.slice(0, -'.js'.length);
            if (directoryNames.has(moduleName)) {
                conflicts.push(path.join(relativePath, entry.name));
            }
        }
    }

    return conflicts;
}

export async function collectSharedRootModules() {
    const entries = await readdir(projectPath('shared'), { withFileTypes: true });

    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => path.join('shared', entry.name))
        .sort();
}

export async function collectUnexpectedSourceFilenames(relativePath = '.') {
    const entries = await readdir(projectPath(relativePath), { withFileTypes: true });
    const violations = [];
    const rootConfigFiles = new Set(['vite.config.ts']);

    for (const entry of entries) {
        const entryPath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
            if (!isIgnoredProjectPath(entryPath)) {
                violations.push(...(await collectUnexpectedSourceFilenames(entryPath)));
            }
            continue;
        }

        if (!entry.isFile() || !entry.name.match(/\.(js|mjs|ts)$/)) continue;

        const normalizedPath = entryPath.split(path.sep).join('/');
        const basename = entry.name.replace(/\.(js|mjs|ts)$/, '');
        const moduleName = basename.replace(/\.test$/, '');

        if (rootConfigFiles.has(normalizedPath)) continue;
        if (moduleName === 'index') continue;
        if (/^[a-z0-9_]+$/.test(moduleName)) continue;
        if (normalizedPath.startsWith('scripts/') && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(moduleName)) {
            continue;
        }

        violations.push(normalizedPath);
    }

    return violations.sort();
}

export async function collectProjectSourceFiles(
    relativePath = '.',
    filePattern = /\.(js|mjs|ts)$/
) {
    const entries = await readdir(projectPath(relativePath), { withFileTypes: true });
    const sourceFiles = [];

    for (const entry of entries) {
        const entryPath = path.join(relativePath, entry.name);
        const normalizedPath = normalizeProjectPath(entryPath);

        if (entry.isDirectory()) {
            if (!isIgnoredProjectPath(normalizedPath)) {
                sourceFiles.push(...(await collectProjectSourceFiles(entryPath, filePattern)));
            }
            continue;
        }

        if (entry.isFile() && entry.name.match(filePattern)) {
            sourceFiles.push(normalizedPath);
        }
    }

    return sourceFiles.sort();
}

export function countCodeLines(source) {
    return source.split('\n').filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('//');
    }).length;
}

export function collectI18nKeysFromSource(source) {
    const keys = new Set();
    const patterns = [
        /data-i18n(?:-title|-placeholder)?="([^"]+)"/g,
        // (?<![\w$.]) keeps plain import(...) from reading as t(...)
        /(?<![\w$.])t\(\s*['"]([^'"]+)['"]\s*\)/g,
        /formatT\(\s*['"]([^'"]+)['"]\s*,/g,
        /createSettingsHelpButton\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            // Skip dynamic keys such as data-i18n="${key}"; the literal is not a key.
            if (match[1].includes('${')) continue;
            keys.add(match[1]);
        }
    }

    return keys;
}
