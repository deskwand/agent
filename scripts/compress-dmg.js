#!/usr/bin/env node

/**
 * electron-builder afterAllArtifactBuild hook.
 *
 * Creates ULMO (LZMA) compressed DMG files from the `dir` target output.
 * We bypass electron-builder's built-in dmgbuild because it has two issues:
 * 1. Temporary DMG size estimation is too small for large apps
 * 2. Spotlight indexing causes "resource busy" on unmount
 *
 * Using `hdiutil create -srcfolder -format ULMO` directly is more reliable.
 * LZMA achieves ~85-87% compression ratio vs ~79% for zlib.
 *
 * The DMG includes an Applications symlink for drag-to-install UX.
 *
 * Requirements:
 * - macOS only (uses hdiutil)
 * - macOS 10.15 Catalina+ for ULMO support (already met by this project)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * @param {import('electron-builder').BuildResult} buildResult
 * @returns {string[]} Additional artifact paths
 */
module.exports = async function afterAllArtifactBuild(buildResult) {
  // Only run on macOS — hdiutil is macOS-only
  if (process.platform !== 'darwin') {
    return [];
  }

  const { outDir, configuration } = buildResult;
  const productName = configuration.productName || 'DeskWand';
  const version = buildResult.configuration.buildVersion ||
    require(path.join(process.cwd(), 'package.json')).version;

  // Find the .app directory in the dir target output
  const macOutDirs = fs.readdirSync(outDir)
    .filter(d => d.startsWith('mac-'))
    .map(d => path.join(outDir, d));

  const createdDmgs = [];
  const artifacts = [];

  for (const macDir of macOutDirs) {
    const arch = path.basename(macDir).replace('mac-', ''); // e.g. "arm64"
    const appName = `${productName}.app`;
    const appPath = path.join(macDir, appName);

    if (!fs.existsSync(appPath)) {
      console.log(`[create-dmg] No .app found in ${macDir}, skipping.`);
      continue;
    }

    const dmgName = `${productName}-${version}-mac-${arch}.dmg`;
    const dmgPath = path.join(outDir, dmgName);
    const applicationsLink = path.join(macDir, 'Applications');

    console.log(`\n[create-dmg] Creating ULMO DMG: ${dmgName}`);

    try {
      // Add Applications symlink for drag-to-install (temporary, removed after DMG creation)
      if (!fs.existsSync(applicationsLink)) {
        fs.symlinkSync('/Applications', applicationsLink);
        console.log(`  Added Applications symlink for drag-to-install UX`);
      }

      // Create ULMO DMG directly (no intermediate UDZO → convert step)
      // Safe: all paths are build-time artifact paths from electron-builder
      console.log(`  Creating ULMO DMG (this may take a few minutes)...`);
      execSync(
        `hdiutil create -volname "${productName}" -srcfolder "${macDir}" ` +
        `-ov -format ULMO -imagekey lzma-level=5 "${dmgPath}"`,
        { stdio: 'inherit' }
      );

      const dmgSize = fs.statSync(dmgPath).size;
      console.log(`  ✓ DMG created: ${(dmgSize / 1024 / 1024).toFixed(1)}MB (ULMO/LZMA compressed)`);

      createdDmgs.push(dmgPath);
      artifacts.push(dmgPath);
    } catch (err) {
      console.error(`[create-dmg] Failed: ${err.message}`);
      if (fs.existsSync(dmgPath)) fs.unlinkSync(dmgPath);
    } finally {
      // Remove temporary Applications symlink from the dir output
      if (fs.existsSync(applicationsLink) && fs.lstatSync(applicationsLink).isSymbolicLink()) {
        fs.unlinkSync(applicationsLink);
      }
    }
  }

  // Generate latest-mac.yml for electron-updater (macOS)
  // electron-builder skips this when mac target is "dir" instead of "dmg"
  if (createdDmgs.length > 0) {
    const crypto = require("crypto");
    const archiver = require("archiver");
    const latestYml = path.join(outDir, "latest-mac.yml");
    const lines = [`version: ${version}`, "files:"];
    const createdZips = [];

    for (const dmgPath of createdDmgs) {
      const dmgName = path.basename(dmgPath);
      const dmgBuf = fs.readFileSync(dmgPath);
      const sha512 = crypto.createHash("sha512").update(dmgBuf).digest("base64");
      const size = dmgBuf.length;

      // Extract arch from dmg filename: DeskWand-1.0.3-mac-arm64.dmg → arm64
      const dmgArch = dmgName.replace(`${productName}-${version}-mac-`, "").replace(".dmg", "");

      lines.push(`  - url: ${dmgName}`);
      lines.push(`    sha512: ${sha512}`);
      lines.push(`    size: ${size}`);

      // Create a .zip of the .app bundle for MacUpdater
      // electron-updater on macOS uses Squirrel.Mac, which requires a .zip containing
      // the .app bundle directly (ShipIt looks for ${CFBundleIdentifier}.app inside the zip).
      // See MacUpdater.findFile("zip", ["pkg", "dmg"]) — it looks for .zip first.
      // Zipping the DMG does NOT work because Squirrel.Mac can't extract a DMG.
      // We zip the .app directory from the mac-${arch} build output, not the DMG.
      const zipName = `${productName}-${version}-mac-${dmgArch}.zip`;
      const zipPath = path.join(outDir, zipName);
      // Zip the .app directory from the mac-<arch> build output
      const appFolder = path.join(outDir, `mac-${dmgArch}`, `${productName}.app`);

      console.log(`  Creating .app zip for MacUpdater: ${zipName}`);
      try {
        await new Promise((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver("zip", { zlib: { level: 9 } });
          output.on("close", () => {
            const zipBuf = fs.readFileSync(zipPath);
            const zipSha512 = crypto.createHash("sha512").update(zipBuf).digest("base64");
            const zipSize = zipBuf.length;
            lines.push(`  - url: ${zipName}`);
            lines.push(`    sha512: ${zipSha512}`);
            lines.push(`    size: ${zipSize}`);
            createdZips.push(zipPath);
            artifacts.push(zipPath);
            console.log(`  ✓ ${zipName} created: ${(zipSize / 1024 / 1024).toFixed(1)}MB`);
            resolve(null);
          });
          archive.on("error", reject);
          archive.pipe(output);
          archive.directory(appFolder, `${productName}.app`);
          archive.finalize();
        });
      } catch (err) {
        console.error(`  ✗ Failed to create zip for ${dmgName}: ${err.message}`);
        console.error(`    MacUpdater will not be able to update on macOS — ensure a .zip is uploaded manually.`);
        // Remove stale zip file if archiver left a partial one
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      }
    }

    // Top-level path/sha512 from the first DMG (electron-updater uses these)
    const firstDmgBuf = fs.readFileSync(createdDmgs[0]);
    const firstSha512 = crypto.createHash("sha512").update(firstDmgBuf).digest("base64");
    lines.push(`path: ${path.basename(createdDmgs[0])}`);
    lines.push(`sha512: ${firstSha512}`);

    lines.push(`releaseDate: '${new Date().toISOString()}'`);
    fs.writeFileSync(latestYml, lines.join("\n") + "\n");
    console.log(`\n  ✓ latest-mac.yml generated for ${createdDmgs.length} DMG(s) + ${createdZips.length} zip(s)`);

  }

  // Also handle any pre-existing DMGs (if `dmg` target is used on other platforms/configs)
  const existingDmgs = (buildResult.artifactPaths || []).filter(f => f.endsWith('.dmg'));
  for (const dmgPath of existingDmgs) {
    if (!fs.existsSync(dmgPath) || createdDmgs.includes(dmgPath)) continue;

    const tmpPath = dmgPath.replace('.dmg', '.ulmo.dmg');
    const originalSize = fs.statSync(dmgPath).size;

    console.log(`\n[compress-dmg] Converting existing DMG to ULMO: ${path.basename(dmgPath)}`);
    try {
      execSync(
        `hdiutil convert "${dmgPath}" -format ULMO -imagekey lzma-level=5 -o "${tmpPath}"`,
        { stdio: 'inherit' }
      );
      fs.unlinkSync(dmgPath);
      fs.renameSync(tmpPath, dmgPath);
      const newSize = fs.statSync(dmgPath).size;
      console.log(`  ✓ ${(originalSize / 1024 / 1024).toFixed(1)}MB → ${(newSize / 1024 / 1024).toFixed(1)}MB`);
    } catch (err) {
      console.error(`[compress-dmg] Failed: ${err.message}`);
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  return artifacts;
};
