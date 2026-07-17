#!/usr/bin/env node

/**
 * electron-builder afterPack hook.
 *
 * Runs after the app is packed but before the installer (DMG/NSIS) is created.
 * Removes platform-specific binaries that don't match the build target,
 * strips build artifacts, and cleans up unnecessary locale files.
 *
 * Typical savings: ~140MB (koffi 79MB + ngrok 29MB + locales 32MB)
 */

const fs = require('fs');
const path = require('path');

/**
 * Map electron-builder arch names to koffi directory names.
 * koffi uses: darwin_arm64, darwin_x64, linux_arm64, linux_x64,
 *             win32_ia32, win32_x64, win32_arm64, etc.
 */
function getKoffiPlatformDir(platform, arch) {
  const koffiPlatform = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux';
  const koffiArch = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : arch;
  return `${koffiPlatform}_${koffiArch}`;
}

/**
 * Remove entries from a directory, keeping only those in the whitelist.
 * Returns the count of removed items.
 */
function removeExcept(dir, whitelist) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  const whiteSet = new Set(whitelist.map(w => w.toLowerCase()));
  for (const entry of fs.readdirSync(dir)) {
    if (whiteSet.has(entry.toLowerCase())) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * Recursively find directories matching a name pattern within a base path.
 */
function findDirs(basePath, dirName) {
  const results = [];
  if (!fs.existsSync(basePath)) return results;

  function walk(currentPath, depth) {
    if (depth > 8) return; // Prevent infinite recursion
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(currentPath, entry.name);
        if (entry.name === dirName) {
          results.push(fullPath);
        } else if (!entry.name.startsWith('.')) {
          walk(fullPath, depth + 1);
        }
      }
    } catch {
      // Permission errors, etc.
    }
  }

  walk(basePath, 0);
  return results;
}

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context;
  // electron-builder arch: 0=ia32, 1=x64, 3=arm64
  const archName = arch === 3 ? 'arm64' : arch === 1 ? 'x64' : 'ia32';
  const platform = electronPlatformName; // 'darwin', 'win32', 'linux'

  console.log(`\n🧹 after-pack: cleaning ${platform}-${archName} build...`);

  // Determine the app resources path
  let resourcesDir;
  if (platform === 'darwin') {
    // macOS: DeskWand.app/Contents/Resources/app.asar.unpacked/...
    const appName = `${context.packager.appInfo.productFilename}.app`;
    resourcesDir = path.join(appOutDir, appName, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(appOutDir, 'resources');
  }

  const appAsarUnpacked = path.join(resourcesDir, 'app.asar.unpacked');
  // For files inside asar, electron-builder may also have app/ or node_modules/
  // We primarily work on the unpacked directory
  const nmUnpacked = path.join(appAsarUnpacked, 'node_modules');

  // --- 1. koffi: remove non-target platform binaries ---
  const koffiKeep = getKoffiPlatformDir(platform, archName);
  const koffiBuildDirs = findDirs(resourcesDir, 'koffi');
  for (const koffiDir of koffiBuildDirs) {
    // koffi/build/koffi/ contains per-platform directories
    const buildKoffiDir = path.join(koffiDir, 'build', 'koffi');
    if (fs.existsSync(buildKoffiDir)) {
      const removed = removeExcept(buildKoffiDir, [koffiKeep]);
      if (removed > 0) console.log(`  ✓ koffi: kept ${koffiKeep}, removed ${removed} other platform dirs`);
    }
    // Also check if koffi dir itself has a build/ child
    if (path.basename(koffiDir) === 'koffi' && fs.existsSync(path.join(koffiDir, 'build'))) {
      // Remove source and build-time files
      for (const sub of ['src', 'vendor', 'doc']) {
        const subPath = path.join(koffiDir, sub);
        if (fs.existsSync(subPath)) {
          fs.rmSync(subPath, { recursive: true, force: true });
          console.log(`  ✓ koffi: removed ${sub}/`);
        }
      }
    }
  }

  // Also check the node_modules path directly
  const koffiPkg = path.join(nmUnpacked, 'koffi');
  if (fs.existsSync(koffiPkg)) {
    const buildKoffiDir = path.join(koffiPkg, 'build', 'koffi');
    if (fs.existsSync(buildKoffiDir)) {
      const removed = removeExcept(buildKoffiDir, [koffiKeep]);
      if (removed > 0) console.log(`  ✓ koffi (nm): kept ${koffiKeep}, removed ${removed} other platform dirs`);
    }
    for (const sub of ['src', 'vendor', 'doc']) {
      const subPath = path.join(koffiPkg, sub);
      if (fs.existsSync(subPath)) {
        fs.rmSync(subPath, { recursive: true, force: true });
        console.log(`  ✓ koffi (nm): removed ${sub}/`);
      }
    }
  }

  // --- 2. bufferutil / utf-8-validate: remove non-target platform prebuilds ---
  for (const pkg of ['bufferutil', 'utf-8-validate']) {
    const pkgPath = path.join(nmUnpacked, pkg);
    if (!fs.existsSync(pkgPath)) continue;
    const prebuildsDir = path.join(pkgPath, 'prebuilds');
    if (!fs.existsSync(prebuildsDir)) continue;
    // Keep only the current platform dir (e.g. darwin-arm64)
    const keepDir = `${platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux'}-${archName.replace('arm64', 'arm64').replace('x64', 'x64')}`;
    const removed = removeExcept(prebuildsDir, [keepDir]);
    if (removed > 0) console.log(`  ✓ ${pkg}: kept ${keepDir}, removed ${removed} other prebuild dirs`);
  }

  // --- 3. @mariozechner/clipboard: remove non-target platform native addons (~10MB) ---
  // Package naming: clipboard-{darwin|linux|win32}-{arch}[-gnu|-msvc]
  const clipboardDir = path.join(nmUnpacked, '@mariozechner');
  if (fs.existsSync(clipboardDir)) {
    const clipPlatform = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux';
    // Build the set of clipboard-* packages to keep for this platform
    const keepPrefixes = [`clipboard-${clipPlatform}-${archName}`];
    if (clipPlatform === 'darwin') keepPrefixes.push('clipboard-darwin-universal');

    let removed = 0;
    for (const entry of fs.readdirSync(clipboardDir)) {
      if (!entry.startsWith('clipboard-')) continue;
      const shouldKeep = keepPrefixes.some((prefix) => entry === prefix || entry.startsWith(prefix + '-'));
      if (shouldKeep) continue;
      fs.rmSync(path.join(clipboardDir, entry), { recursive: true, force: true });
      removed++;
    }
    if (removed > 0) console.log(`  ✓ clipboard: kept ${keepPrefixes.join(', ')}, removed ${removed} other platform binaries (~10MB)`);
  }

  // --- 4. ngrok: remove binary (~28MB, it downloads on-demand anyway) ---
  const ngrokPkg = path.join(nmUnpacked, 'ngrok');
  if (fs.existsSync(ngrokPkg)) {
    const ngrokBin = path.join(ngrokPkg, 'bin');
    if (fs.existsSync(ngrokBin)) {
      fs.rmSync(ngrokBin, { recursive: true, force: true });
      console.log(`  ✓ ngrok: removed bin/ (~28MB)`);
    }
  }

  // --- 4. Electron locales: keep only en, zh_CN, zh_TW ---
  if (platform === 'darwin') {
    const appName = `${context.packager.appInfo.productFilename}.app`;
    const frameworkDir = path.join(
      appOutDir, appName, 'Contents', 'Frameworks',
      'Electron Framework.framework', 'Versions', 'A', 'Resources'
    );
    if (fs.existsSync(frameworkDir)) {
      const KEEP_LOCALES = new Set(['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj', 'Base.lproj']);
      let removedLocales = 0;
      for (const entry of fs.readdirSync(frameworkDir)) {
        if (!entry.endsWith('.lproj')) continue;
        if (KEEP_LOCALES.has(entry)) continue;
        fs.rmSync(path.join(frameworkDir, entry), { recursive: true, force: true });
        removedLocales++;
      }
      if (removedLocales > 0) console.log(`  ✓ Electron locales: removed ${removedLocales} .lproj dirs (kept en, zh_CN, zh_TW)`);
    }
  }

  // --- 4b. Linux: trim Electron locale .pak files (~10MB) ---
  if (platform === 'linux') {
    const localesDir = path.join(appOutDir, 'locales');
    if (fs.existsSync(localesDir)) {
      const KEEP_PAK = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);
      let removedPaks = 0;
      for (const entry of fs.readdirSync(localesDir)) {
        if (!entry.endsWith('.pak')) continue;
        if (KEEP_PAK.has(entry)) continue;
        fs.rmSync(path.join(localesDir, entry));
        removedPaks++;
      }
      if (removedPaks > 0) console.log(`  ✓ Electron locales: removed ${removedPaks} .pak files (kept en-US, zh-CN, zh-TW)`);
    }
  }

  // --- 5. Generate app-update.yml for electron-updater (macOS only — Windows/Linux auto-generated by electron-builder) ---
  if (platform === 'darwin') {
    const updaterYmlPath = path.join(resourcesDir, 'app-update.yml');
    // Write inline YAML to avoid a dependency on js-yaml (transitive, not a direct dep)
    const updaterYmlContent = [
      'provider: generic',
      'url: https://file.deskwand.com',
      'channel: latest',
      '',
    ].join('\n');
    fs.writeFileSync(updaterYmlPath, updaterYmlContent, 'utf-8');
    console.log(`  ✓ app-update.yml written to ${updaterYmlPath}`);
  }

  // --- 6. Windows: set .exe icon using resedit (cross-platform, no wine/rcedit needed) ---
  if (platform === 'win32') {
    try {
      const ResEdit = require('resedit');

      const exeName = `${context.packager.appInfo.productFilename}.exe`;
      const exePath = path.join(appOutDir, exeName);

      if (!fs.existsSync(exePath)) {
        console.warn(`  ⚠ icon: .exe not found at ${exePath}, skipping`);
      } else {
        // icon.ico comes from extraResources, already in resourcesDir
        const iconPath = path.join(resourcesDir, 'icon.ico');

        if (!fs.existsSync(iconPath)) {
          console.warn(`  ⚠ icon: ${iconPath} not found, skipping`);
        } else {
          const exeData = fs.readFileSync(exePath);
          const iconData = fs.readFileSync(iconPath);

          const exe = ResEdit.NtExecutable.from(exeData);
          const res = ResEdit.NtExecutableResource.from(exe);
          const iconFile = ResEdit.Data.IconFile.from(iconData);
          const iconItems = iconFile.icons.map((item) => item.data);

          // Find existing icon groups and replace them all
          const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
          if (iconGroups.length > 0) {
            for (const group of iconGroups) {
              ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
                res.entries, group.id, group.lang, iconItems
              );
            }
          } else {
            // No icon group yet, create one (ID=1, lang=0 for neutral)
            ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
              res.entries, 1, 0, iconItems
            );
          }

          res.outputResource(exe);
          fs.writeFileSync(exePath, Buffer.from(exe.generate()));
          console.log(`  ✓ icon: .exe icon replaced (${iconGroups.length || 1} group(s))`);
        }
      }
    } catch (err) {
      console.error(`  ⚠ icon: failed to set .exe icon:`, err.message);
    }
  }

  console.log(`✅ after-pack cleanup complete for ${platform}-${archName}\n`);
};
