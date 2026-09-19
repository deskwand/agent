#!/usr/bin/env node

/**
 * Prepare/bundle single-file helper binaries for packaging.
 *
 * Everything lands in `resources/bin/<platform>-<arch>/`, which is the single
 * directory that packaging, PATH injection, and pre-build-check all read. To
 * add a future tool, add one entry to BINARIES below — no other file changes.
 *
 * Default is every platform this project ships, NOT just the host platform:
 * the release flow cross-builds macOS + Windows + Linux from one macOS machine
 * (see deskwand-release → build-all.sh). A host-only download would leave the
 * Windows and Linux installers without the binary, and electron-builder only
 * logs a warning when an extraResources source is missing.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const OFFICECLI_VERSION = '1.0.150';

// One-off override for trying a different upstream build without editing the
// manifest. Deliberately a PAIR: a different version has different bytes, so the
// pinned sha256 cannot verify it and a version-only override would either be a
// silent no-op (cache still matches the pin) or bundle an unverified binary.
// Requiring the hash keeps the "every bundled binary is hash-verified"
// invariant intact.
//   OPEN_COWORK_OFFICECLI_VERSION=1.0.151 \
//   OPEN_COWORK_OFFICECLI_SHA256=<hex> \
//   node scripts/prepare-bin.js --target darwin-arm64
const VERSION_OVERRIDE = process.env.OPEN_COWORK_OFFICECLI_VERSION || null;
const SHA_OVERRIDE = process.env.OPEN_COWORK_OFFICECLI_SHA256 || null;

// Abort a download whose socket goes idle for this long. Without it a stalled
// connection hangs the build forever instead of failing with a clear error.
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

const BINARIES = {
  officecli: {
    version: OFFICECLI_VERSION,
    assets: {
      'darwin-arm64': {
        asset: 'officecli-mac-arm64',
        sha256:
          'e669fe5a4a162f8f0f8dc871d8d85e2a15d191ec93f94426a1ecccf9d57978c8',
      },
      'darwin-x64': {
        asset: 'officecli-mac-x64',
        sha256:
          '3af47fd4ea86a31f228f71cf8b2a97f609784031a049aaed4ba6170606d3d0ed',
      },
      'win32-x64': {
        asset: 'officecli-win-x64.exe',
        sha256:
          '5b2712ed8406126da5d6ed08809bc03633dac7ad0574d7a42b0fc9d5aa60baa1',
      },
      'linux-x64': {
        asset: 'officecli-linux-x64',
        sha256:
          'faceb42654004f1fa5c40fb0ce641c42b7dc5a2beb270f25971ea6265b7dc227',
      },
    },
    url: (version, asset) =>
      `https://github.com/iOfficeAI/OfficeCLI/releases/download/v${version}/${asset}`,
    outputName: (platform) =>
      platform === 'win32' ? 'officecli.exe' : 'officecli',
  },
  // Add future single-file tools here. This is the only file that changes.
};

// What the release flow builds. Every entry matches a target in
// electron-builder.yml — this is NOT derived from the host arch.
//
// macOS is packaged for arm64 only (electron-builder.yml mac.target.arch), so an
// Intel build host still needs resources/bin/darwin-arm64. Deriving the darwin
// entry from the host arch would download darwin-x64 on Intel, leave
// darwin-arm64 missing, and let electron-builder emit an installer with no
// officecli while only logging a warning.
const SHIPPED_PLATFORMS = ['darwin-arm64', 'win32-x64', 'linux-x64'];

function currentPlatformKey() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${process.platform}-${arch}`;
}

/**
 * Note the argument shape: --target takes a `<platform>-<arch>` key, because
 * this script stages per-arch assets. pre-build-check's --platform takes a bare
 * platform, because it validates per-platform. The usage text spells this out so
 * the difference is visible rather than something to remember.
 */
const USAGE =
  'Usage: node scripts/prepare-bin.js [options]\n' +
  '  (no options)          stage every shipped platform\n' +
  '  --current            stage only this machine\n' +
  '  --target <p>-<a>     stage one target, repeatable\n' +
  '                       e.g. darwin-arm64, win32-x64, linux-x64\n' +
  '  -h, --help           show this message\n';

function parseArgs(argv) {
  const requested = [];
  let useCurrent = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      throw new Error(USAGE.trimEnd());
    }
    if (arg === '--current') {
      useCurrent = true;
    } else if (arg === '--target') {
      const value = argv[i + 1];
      if (!value) throw new Error(`--target requires a value\n\n${USAGE}`);
      requested.push(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  if (useCurrent && requested.length > 0) {
    throw new Error(`--current and --target are mutually exclusive\n\n${USAGE}`);
  }
  if (useCurrent) return [currentPlatformKey()];
  if (requested.length > 0) return Array.from(new Set(requested));
  return SHIPPED_PLATFORMS;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Download a URL to a file, following redirects (GitHub release assets redirect
 * to release-assets.githubusercontent.com). Writes to `<dest>.part` first so a
 * killed run never leaves a truncated file looking complete.
 */function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': 'deskwand-build' } },
      (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft === 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          download(res.headers.location, destPath, redirectsLeft - 1).then(
            resolve,
            reject,
          );
          return;
        }

        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }

        const partialPath = `${destPath}.part`;
        const cleanupPartial = () => {
          try {
            fs.rmSync(partialPath, { force: true });
          } catch {
            // best effort
          }
        };
        const out = fs.createWriteStream(partialPath);

        // A mid-body network drop surfaces as an error on the RESPONSE stream,
        // not on the file stream. Without this the process would die on an
        // unhandled 'error' event and leave a stale .part file behind.
        res.on('error', (err) => {
          out.destroy();
          cleanupPartial();
          reject(err);
        });

        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            fs.renameSync(partialPath, destPath);
            resolve();
          });
        });
        out.on('error', (err) => {
          cleanupPartial();
          reject(err);
        });
      },
    );
    request.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
      request.destroy(
        new Error(`no data for ${DOWNLOAD_IDLE_TIMEOUT_MS / 1000}s from ${url}`),
      );
    });
    request.on('error', reject);
  });
}

async function prepareOne(toolName, spec, platformKey, outRoot) {
  const assetSpec = spec.assets[platformKey];
  if (!assetSpec) {
    // An explicitly requested platform that has no asset is an error, not a
    // skip: a typo in --platform would otherwise exit 0 and silently produce an
    // installer with no binary.
    throw new Error(
      `no asset for ${platformKey} (known: ${Object.keys(spec.assets).join(', ')})`,
    );
  }

  const platform = platformKey.split('-')[0];
  const outDir = path.join(outRoot, platformKey);
  const outPath = path.join(outDir, spec.outputName(platform));
  const version = VERSION_OVERRIDE || spec.version;
  const expectedSha = VERSION_OVERRIDE ? SHA_OVERRIDE : assetSpec.sha256;

  fs.mkdirSync(outDir, { recursive: true });

  // The cached file belongs to the pinned version, so an override always
  // re-downloads.
  if (fs.existsSync(outPath) && !VERSION_OVERRIDE) {
    const existing = await sha256File(outPath);
    if (existing === assetSpec.sha256) {
      console.log(
        `[prepare-bin] ${toolName} ${platformKey}: already present, sha256 matches.`,
      );
      return { status: 'present' };
    }
    console.log(
      `[prepare-bin] ${toolName} ${platformKey}: sha256 mismatch, re-downloading.`,
    );
    fs.rmSync(outPath, { force: true });
  }

  const url = spec.url(version, assetSpec.asset);
  console.log(`[prepare-bin] ${toolName} ${platformKey}: downloading ${url}`);
  await download(url, outPath);

  const actual = await sha256File(outPath);
  if (actual !== expectedSha) {
    fs.rmSync(outPath, { force: true });
    throw new Error(
      `sha256 mismatch for ${toolName} ${platformKey}\n` +
        `  expected: ${expectedSha}\n` +
        `  actual:   ${actual}`,
    );
  }

  fs.chmodSync(outPath, 0o755);
  console.log(`[prepare-bin] ${toolName} ${platformKey}: OK -> ${outPath}`);
  return { status: 'downloaded' };
}

async function main() {
  const platforms = parseArgs(process.argv.slice(2));

  if (VERSION_OVERRIDE && !SHA_OVERRIDE) {
    throw new Error(
      'OPEN_COWORK_OFFICECLI_VERSION also requires OPEN_COWORK_OFFICECLI_SHA256.\n' +
        'A different upstream build cannot be verified against the pinned hash, and\n' +
        'bundling an unverified binary silently is worse than refusing.',
    );
  }
  if (VERSION_OVERRIDE && platforms.length !== 1) {
    throw new Error(
      `an override needs exactly one --target (got ${platforms.length}); ` +
        'one sha256 cannot cover several platforms.',
    );
  }

  const projectRoot = path.join(__dirname, '..');
  const outRoot = path.join(projectRoot, 'resources', 'bin');

  const failures = [];

  for (const [toolName, spec] of Object.entries(BINARIES)) {
    for (const platformKey of platforms) {
      try {
        await prepareOne(toolName, spec, platformKey, outRoot);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[prepare-bin] FAILED ${toolName} ${platformKey}: ${message}`,
        );
        failures.push({ toolName, platformKey });
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      "\n[prepare-bin] ERROR: could not prepare the following binaries:\n" +
        failures.map((f) => `  ${f.toolName}  ${f.platformKey}`).join("\n") +
        "\n\nCheck network access to github.com, then re-run: npm run prepare:bin\n" +
        "Or place the binaries manually under:\n" +
        `  ${outRoot}/<platform>-<arch>/\n`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('[prepare-bin] All requested binaries are ready.');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // Usage/argument problems are the caller's mistake, not a stack trace.
  if (message.startsWith('Usage:') || message.includes('\nUsage:')) {
    console.error(message);
  } else {
    console.error('[prepare-bin] Unexpected failure:', err);
  }
  process.exitCode = 1;
});
