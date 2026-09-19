/**
 * Re-hash the entries of release/latest-linux.yml against the files on disk.
 *
 * `npm run build:linux:deb` runs electron-builder (which hashes its own deb into
 * latest-linux.yml) and then scripts/package-linux.sh, which rebuilds the deb
 * from linux-unpacked — with the desktop entry and hicolor icons — at the same
 * path. By then electron-builder has already written the manifest, so it keeps
 * describing a file that no longer exists: the published deb and the manifest
 * disagree, and anything verifying the download against the manifest fails.
 *
 * Supports a testable API via module.exports.syncManifest(releaseDir).
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MANIFEST = "latest-linux.yml";

/** Stream the file rather than buffering it — the AppImage is ~250MB. */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("base64")));
  });
}

/**
 * Rewrite the `files:` entries of latest-linux.yml so each one's size and
 * sha512 match the artifact sitting next to it. Entries whose file is missing
 * are left untouched and reported, so a genuinely absent upload still surfaces.
 */
async function syncManifest(releaseDir) {
  const manifestPath = path.join(releaseDir, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return {
      changed: [],
      missing: [],
      skipped: `no ${MANIFEST} in ${releaseDir}`,
    };
  }

  const lines = fs.readFileSync(manifestPath, "utf8").split("\n");
  const entries = [];
  let insideFiles = false;
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    if (/^files:\s*$/.test(lines[i])) {
      insideFiles = true;
      continue;
    }
    // The block ends at the first top-level key (`path:`, `sha512:`, …).
    if (insideFiles && /^[A-Za-z]/.test(lines[i])) break;
    if (!insideFiles) continue;

    const url = lines[i].match(/^\s+-\s+url:\s*(\S+)\s*$/);
    if (url) {
      current = { url: url[1], shaIndex: -1, sizeIndex: -1 };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    if (/^\s+sha512:/.test(lines[i])) current.shaIndex = i;
    else if (/^\s+size:/.test(lines[i])) current.sizeIndex = i;
  }

  const changed = [];
  const missing = [];

  for (const entry of entries) {
    const filePath = path.join(releaseDir, entry.url);
    if (entry.shaIndex < 0 || entry.sizeIndex < 0 || !fs.existsSync(filePath)) {
      missing.push(entry.url);
      continue;
    }

    const size = fs.statSync(filePath).size;
    const sha512 = await hashFile(filePath);
    const previousSize = lines[entry.sizeIndex]
      .replace(/^\s+size:\s*/, "")
      .trim();
    const previousSha512 = lines[entry.shaIndex]
      .replace(/^\s+sha512:\s*/, "")
      .trim();

    if (previousSize === String(size) && previousSha512 === sha512) continue;

    lines[entry.sizeIndex] = `    size: ${size}`;
    lines[entry.shaIndex] = `    sha512: ${sha512}`;
    changed.push({
      url: entry.url,
      from: { size: Number(previousSize), sha512: previousSha512 },
      to: { size, sha512 },
    });
  }

  if (changed.length > 0) {
    fs.writeFileSync(manifestPath, lines.join("\n"));
  }

  return { changed, missing, skipped: null };
}

module.exports = { syncManifest, MANIFEST };

async function main() {
  const releaseDir = path.resolve(
    process.argv[2] || path.join(__dirname, "..", "release"),
  );
  const { changed, missing, skipped } = await syncManifest(releaseDir);

  if (skipped) {
    console.log(`⚠️  ${skipped} — nothing to sync`);
    return 0;
  }

  for (const entry of missing) {
    console.log(
      `⚠️  ${entry}: listed in ${MANIFEST} but not found in ${releaseDir}`,
    );
  }

  for (const entry of changed) {
    console.log(`🔄 ${entry.url}`);
    console.log(`     size   ${entry.from.size} → ${entry.to.size}`);
    console.log(`     sha512 ${entry.from.sha512} → ${entry.to.sha512}`);
  }

  if (changed.length === 0) {
    console.log(`✅ ${MANIFEST} already matches the artifacts on disk`);
  } else {
    console.log(
      `✅ ${MANIFEST} re-synced (${changed.length} entr${changed.length === 1 ? "y" : "ies"})`,
    );
  }

  return 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`❌ ${MANIFEST} sync failed: ${error.message}`);
      process.exit(1);
    },
  );
}
