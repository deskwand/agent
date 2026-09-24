/**
 * Pre-build validation script for electron-builder.
 *
 * Verifies that all required build artifacts and resources exist before
 * electron-builder packages the application. Exits 0 on success, 1 on failure.
 *
 * Supports a testable API via module.exports.runChecks(rootDir, platform).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ANSI color codes
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

/**
 * @typedef {'fatal' | 'warn'} Severity
 * @typedef {{ label: string; relPath: string; type: 'file' | 'dir'; severity: Severity }} CheckSpec
 * @typedef {{ label: string; relPath: string; passed: boolean; severity: Severity }} CheckResult
 */

/**
 * Note the argument shape: --platform takes a bare platform here, because this
 * script validates per-platform. prepare-bin's --target takes a
 * `<platform>-<arch>` key, because it stages per-arch assets.
 */
const PLATFORM_USAGE =
  'Usage: node scripts/pre-build-check.js [--platform <darwin|win32|linux>]\n' +
  'Defaults to the host platform; pass --platform to validate a cross-build target.\n';

/**
 * Resolve which platform's resources to validate.
 *
 * Defaults to the host platform, but the release flow cross-builds Windows and
 * Linux from macOS, and electron-builder only logs a warning when an
 * extraResources source is missing (app-builder-lib/out/fileMatcher.js).
 * Without an explicit target, a cross-build would validate the host's
 * resources, pass, and silently ship an installer with no bundled binaries.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @param {string} fallback - usually process.platform
 * @returns {string} one of 'darwin' | 'win32' | 'linux'
 */
function resolveTargetPlatform(argv, fallback) {
  const SUPPORTED = ['darwin', 'win32', 'linux'];
  let target = fallback;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--platform') {
      const value = argv[i + 1];
      if (!value) throw new Error(`--platform requires a value\n\n${PLATFORM_USAGE}`);
      target = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${PLATFORM_USAGE}`);
    }
  }

  if (!SUPPORTED.includes(target)) {
    // Point at the difference rather than making the caller guess: these two
    // scripts take differently shaped values for the same-looking flag.
    const hint = target.includes('-')
      ? `\nDid you mean --platform ${target.split('-')[0]}? ` +
        '(the -<arch> form belongs to prepare-bin --target)'
      : '';
    throw new Error(
      `Unsupported platform: ${target}. Expected one of ${SUPPORTED.join(', ')}.${hint}\n\n${PLATFORM_USAGE}`,
    );
  }
  return target;
}

/**
 * Build the list of checks for the given platform and arch.
 *
 * @param {string} platform - Node.js process.platform value
 * @param {string} arch - Node.js process.arch value
 * @returns {CheckSpec[]}
 */
function buildCheckList(platform, arch) {
  /** @type {CheckSpec[]} */
  const checks = [
    // Common checks (all platforms, FATAL)
    {
      label: 'GUI Operate MCP server bundle',
      relPath: '.bundle-resources/mcp/gui-operate-server.js',
      type: 'file',
      severity: 'fatal',
    },
    {
      label: 'Software Dev MCP server bundle',
      relPath: '.bundle-resources/mcp/software-dev-server-example.js',
      type: 'file',
      severity: 'fatal',
    },
    {
      label: 'Electron main process output (dist-electron/)',
      relPath: 'dist-electron',
      type: 'dir',
      severity: 'fatal',
    },
    {
      // pi SDK 把 photon 的 Emscripten glue 打进主进程 bundle，glue 只从
      // path.join(__dirname, "photon_rs_bg.wasm") 读 wasm。少了它 loadPhoton() 返回 null，
      // 所有图片会被替换成 "[Image omitted: could not be resized …]"。
      label: 'Photon WASM for image resize (dist-electron/main/photon_rs_bg.wasm)',
      relPath: 'dist-electron/main/photon_rs_bg.wasm',
      type: 'file',
      severity: 'fatal',
    },
    {
      label: 'Renderer output (dist/)',
      relPath: 'dist',
      type: 'dir',
      severity: 'fatal',
    },
    {
      label: 'Built-in skills directory (.deskwand/skills/)',
      relPath: '.deskwand/skills',
      type: 'dir',
      severity: 'fatal',
    },
  ];

  if (platform === 'darwin') {
    checks.push(
      {
        label: `Node.js binary for macOS ${arch}`,
        relPath: `resources/node/darwin-${arch}/bin/node`,
        type: 'file',
        severity: 'fatal',
      },
      {
        label: 'Lima sandbox agent bundle (dist-lima-agent/index.js)',
        relPath: 'dist-lima-agent/index.js',
        type: 'file',
        severity: 'fatal',
      },
      {
        label: `Python runtime for macOS ${arch} (GUI automation)`,
        relPath: `resources/python/darwin-${arch}`,
        type: 'dir',
        severity: 'warn',
      },
      {
        label: `Bundled officecli for macOS ${arch}`,
        relPath: `resources/bin/darwin-${arch}/officecli`,
        type: 'file',
        severity: 'fatal',
      },
      {
        label: `Bundled cliclick for macOS ${arch}`,
        relPath: `resources/bin/darwin-${arch}/cliclick`,
        type: 'file',
        severity: 'fatal',
      }
    );
  } else if (platform === 'win32') {
    checks.push(
      {
        label: 'Node.js binary for Windows x64',
        relPath: 'resources/node/win32-x64/node.exe',
        type: 'file',
        severity: 'fatal',
      },
      {
        label: 'WSL sandbox agent bundle (dist-wsl-agent/index.js)',
        relPath: 'dist-wsl-agent/index.js',
        type: 'file',
        severity: 'fatal',
      },
      {
        label: 'Bundled officecli for Windows x64',
        relPath: 'resources/bin/win32-x64/officecli.exe',
        type: 'file',
        severity: 'fatal',
      }
    );
  } else if (platform === 'linux') {
    checks.push({
      label: 'Node.js directory for Linux x64',
      relPath: 'resources/node/linux-x64',
      type: 'dir',
      severity: 'fatal',
    });
    checks.push({
      label: `Python runtime for Linux ${arch} (GUI automation)`,
      relPath: `resources/python/linux-${arch}`,
      type: 'dir',
      severity: 'warn',
    });
    checks.push({
      label: 'Bundled officecli for Linux x64',
      relPath: 'resources/bin/linux-x64/officecli',
      type: 'file',
      severity: 'fatal',
    });
  }

  return checks;
}

/**
 * Run all pre-build checks and return results.
 *
 * @param {string} rootDir - Absolute path to the project root to check against
 * @param {string} platform - Node.js platform string (e.g. 'darwin', 'win32', 'linux')
 * @param {string} [arch] - Node.js arch string (e.g. 'x64', 'arm64'); defaults to process.arch
 * @returns {{ results: CheckResult[]; passed: number; warnings: number; failed: number; hasFatal: boolean }}
 */
function runChecks(rootDir, platform, arch) {
  const resolvedArch = arch || process.arch;
  const checks = buildCheckList(platform, resolvedArch);

  let passed = 0;
  let warnings = 0;
  let failed = 0;

  /** @type {CheckResult[]} */
  const results = [];

  for (const check of checks) {
    const absolutePath = path.join(rootDir, check.relPath);
    let exists = false;

    try {
      const stat = fs.statSync(absolutePath);
      exists = check.type === 'dir' ? stat.isDirectory() : stat.isFile();
    } catch {
      exists = false;
    }

    if (exists) {
      passed += 1;
      console.log(`${GREEN}[pass]${RESET} ${check.label}`);
      console.log(`       ${check.relPath}`);
    } else if (check.severity === 'warn') {
      warnings += 1;
      console.log(`${YELLOW}[warn]${RESET} ${check.label}`);
      console.log(`       ${check.relPath}`);
    } else {
      failed += 1;
      console.log(`${RED}[fail]${RESET} ${check.label}`);
      console.log(`       ${check.relPath}`);
    }

    results.push({
      label: check.label,
      relPath: check.relPath,
      passed: exists,
      severity: check.severity,
    });
  }

  const hasFatal = failed > 0;
  return { results, passed, warnings, failed, hasFatal };
}

/**
 * CLI entry point: run checks against the project root and exit with appropriate code.
 */
function main() {
  const PROJECT_ROOT = path.join(__dirname, '..');

  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(PLATFORM_USAGE.trimEnd());
    process.exit(0);
  }

  let targetPlatform;
  try {
    targetPlatform = resolveTargetPlatform(process.argv.slice(2), process.platform);
  } catch (err) {
    console.error(`\n${RED}${err.message}${RESET}\n`);
    process.exit(1);
    return;
  }

  console.log('\nRunning pre-build checks...\n');

  if (targetPlatform !== process.platform) {
    console.log(`Cross-build target: ${targetPlatform} (host is ${process.platform})\n`);
  }

  // The arch to validate is the arch electron-builder will PACKAGE, not the
  // host arch. macOS is arm64-only (electron-builder.yml mac.target.arch), so an
  // Intel build host must still find resources/bin/darwin-arm64. win/linux
  // targets are x64, which equals process.arch on the machines that build them.
  const targetArch = targetPlatform === 'darwin' ? 'arm64' : 'x64';

  const { results, passed, warnings, failed, hasFatal } = runChecks(
    PROJECT_ROOT,
    targetPlatform,
    targetArch,
  );

  console.log(
    `\nPre-build check: ${passed} passed, ${warnings} warnings, ${failed} failed`
  );

  if (hasFatal) {
    // Naming the exact remedy matters here: a missing bundled binary is the one
    // failure a fresh checkout hits, and "Bundled officecli for Windows x64"
    // does not tell you which command produces it.
    const missingBundled = results.some(
      (r) => !r.passed && r.relPath.startsWith('resources/bin/')
    );
    if (missingBundled) {
      console.log(
        `${YELLOW}Bundled helper binaries are missing. Prepare them with:${RESET}\n` +
          `  npm run prepare:bin -- --target ${targetPlatform}-${targetArch}\n` +
          `  (or 'npm run prepare:bin' for every shipped platform)\n`
      );
    }
    console.log(
      `\n${RED}Build aborted. Fix the above issues before running electron-builder.${RESET}\n`
    );
    process.exit(1);
  }

  console.log('');
  process.exit(0);
}

module.exports = { runChecks, buildCheckList, resolveTargetPlatform };

if (require.main === module) {
  main();
}
