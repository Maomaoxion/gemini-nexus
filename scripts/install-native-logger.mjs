#!/usr/bin/env node
// Installs the Gemini Nexus native logger host: copies host.js to a stable
// path under ~/.gemini-nexus/ and writes the Chrome NativeMessagingHosts
// manifest whose allowed_origins pins this extension's ID. Run with --uninstall
// to remove. Run from the project root so manifest.json's key can be read.

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.gemini_nexus.logger';
export const DEFAULT_HOST_DIR = join(homedir(), '.gemini-nexus');
export const DEFAULT_HOST_SCRIPT = join(DEFAULT_HOST_DIR, 'native-logger.js');
export const DEFAULT_SOURCE_HOST = fileURLToPath(
    new URL('./native-logger/host.js', import.meta.url)
);
export const DEFAULT_MANIFEST_DIR = join(
    homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts'
);

/**
 * Derive a Chrome extension ID from a manifest "key" (base64 SPKI).
 * Chrome maps each of the first 16 SHA-256 bytes to two a-p characters
 * (high nibble, then low nibble) → 32-char id. An earlier half-byte map
 * produced a 16-char id that never matched real Chrome IDs.
 */
export function extensionIdFromKey(keyBase64) {
    const der = Buffer.from(keyBase64, 'base64');
    const hash = createHash('sha256').update(der).digest();
    let id = '';
    for (let i = 0; i < 16; i++) {
        id += String.fromCharCode(97 + ((hash[i] >> 4) & 0xf));
        id += String.fromCharCode(97 + (hash[i] & 0xf));
    }
    return id;
}

export function buildHostManifest({
    extensionId,
    hostScriptPath,
    name = HOST_NAME,
    description = 'Gemini Nexus action logger',
}) {
    return {
        name,
        description,
        type: 'stdio',
        path: hostScriptPath,
        allowed_origins: [`chrome-extension://${extensionId}/`],
    };
}

function readManifestKey(manifestPath) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest.key) {
        throw new Error(`${manifestPath} has no "key" field; pass an explicit --extension-id.`);
    }
    return manifest.key;
}

export function resolveNodeBinary() {
    const candidates = [
        process.execPath,
        '/opt/homebrew/bin/node',
        '/usr/local/bin/node',
        '/usr/bin/node',
    ];
    for (const candidate of candidates) {
        if (candidate && existsSync(candidate)) return candidate;
    }
    return process.execPath || '/usr/bin/env node';
}

// Chrome native-messaging hosts inherit a minimal PATH on macOS
// (/usr/bin:/bin:/usr/sbin:/sbin), so `#!/usr/bin/env node` fails when Node lives
// only under Homebrew. Rewrite the shebang to an absolute node path.
function writeHostScript(sourceHost, hostScriptPath, nodeBinary = resolveNodeBinary()) {
    const source = readFileSync(sourceHost, 'utf8');
    const rewritten = source.replace(/^#!.*\n/, `#!${nodeBinary}\n`);
    writeFileSync(
        hostScriptPath,
        rewritten.startsWith('#!') ? rewritten : `#!${nodeBinary}\n${source}`,
        'utf8'
    );
    chmodSync(hostScriptPath, 0o755);
}

export function install({
    extensionId,
    hostScriptPath = DEFAULT_HOST_SCRIPT,
    manifestDir = DEFAULT_MANIFEST_DIR,
    sourceHost = DEFAULT_SOURCE_HOST,
    manifestPath = join(process.cwd(), 'manifest.json'),
    nodeBinary = resolveNodeBinary(),
} = {}) {
    if (!extensionId) {
        extensionId = extensionIdFromKey(readManifestKey(manifestPath));
    }
    mkdirSync(dirname(hostScriptPath), { recursive: true });
    writeHostScript(sourceHost, hostScriptPath, nodeBinary);
    mkdirSync(manifestDir, { recursive: true });
    const writtenPath = join(manifestDir, `${HOST_NAME}.json`);
    writeFileSync(
        writtenPath,
        `${JSON.stringify(buildHostManifest({ extensionId, hostScriptPath }), null, 2)}\n`,
        'utf8'
    );
    return { extensionId, hostScriptPath, manifestPath: writtenPath, nodeBinary };
}

export function uninstall({
    manifestDir = DEFAULT_MANIFEST_DIR,
    hostScriptPath = DEFAULT_HOST_SCRIPT,
} = {}) {
    rmSync(join(manifestDir, `${HOST_NAME}.json`), { force: true });
    rmSync(hostScriptPath, { force: true });
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--uninstall')) {
        uninstall();
        console.log('Native logger host uninstalled.');
        return;
    }
    const idIdx = args.indexOf('--extension-id');
    const result = install({ extensionId: idIdx !== -1 ? args[idIdx + 1] : undefined });
    console.log('Installed native logger host + local HTTP debug bridge.');
    console.log(`  Extension ID:  ${result.extensionId}`);
    console.log(`  Host script:   ${result.hostScriptPath}`);
    console.log(`  Node binary:   ${result.nodeBinary}`);
    console.log(`  Host manifest: ${result.manifestPath}`);
    console.log('  Log file:      ~/Library/Logs/gemini-nexus.log');
    console.log('  HTTP bridge:   http://127.0.0.1:17321  (starts when extension connects)');
    console.log('    GET  /health          bridge + extension status');
    console.log('    GET  /logs?limit=100  recent logs');
    console.log('    GET  /logs/stream     SSE real-time stream');
    console.log('    GET  /status          live extension status (RPC)');
    console.log('    GET  /sessions        chat session list / search');
    console.log('    GET  /sessions/:id    full session messages');
    console.log('    GET  /records         sessions + groups + logs');
    console.log('    GET  /groups          chat groups');
    console.log('    GET  /storage/keys    storage key inventory');
    console.log('    POST /rpc             {"method","params"} → extension');
    console.log('  Env: GEMINI_NEXUS_BRIDGE_HOST / _PORT / _TOKEN');
    console.log(
        '  Enable in extension: chrome.storage.local.set({ geminiNativeLogEnabled: true })'
    );
    console.log('  Then reload the extension so connectNative starts the host.');
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) main();
