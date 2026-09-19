/**
 * Write the in-app release notes into release/latest*.yml.
 *
 * electron-updater's generic provider only yaml.load()s the manifest, so a
 * `releaseNotes` key arrives at the renderer untouched — no extra request at
 * runtime. The text is authored by the release process (the long GitHub notes
 * are compressed into zh/en) and lives in .tmp/update-notes-<version>.json.
 *
 *   node scripts/inject-release-notes.js [releaseDir]
 *
 * Missing or malformed notes are fatal: shipping a build whose manifest has no
 * notes is silent for users, and a merge of two generations would be worse.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const MANIFEST_PATTERN = /^latest.*\.yml$/;
const LOCALES = ["zh", "en"];

/**
 * Every manifest in the release directory, not a fixed three-name list: a
 * fourth channel file (e.g. an arm64 manifest) would otherwise ship without
 * notes and nobody would notice.
 */
function findManifests(releaseDir) {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`release directory not found: ${releaseDir}`);
  }
  return fs
    .readdirSync(releaseDir)
    .filter((name) => MANIFEST_PATTERN.test(name))
    .sort();
}

function readNotes(notesPath) {
  if (!fs.existsSync(notesPath)) {
    throw new Error(`release notes not found: ${notesPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(notesPath, "utf-8"));
  } catch (error) {
    throw new Error(
      `release notes are not valid JSON (${notesPath}): ${error.message}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`release notes must be a JSON object (${notesPath})`);
  }
  for (const locale of LOCALES) {
    const value = parsed[locale];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(
        `release notes need a non-empty "${locale}" string (${notesPath})`,
      );
    }
  }
  return { zh: parsed.zh, en: parsed.en };
}

/** Drop an existing releaseNotes block — it is always the last key we wrote. */
function stripReleaseNotes(manifest) {
  const lines = manifest.split("\n");
  const start = lines.findIndex((line) => /^releaseNotes:/.test(line));
  return start === -1 ? manifest : lines.slice(0, start).join("\n");
}

function releaseNotesBlock(notes) {
  const body = JSON.stringify(notes, null, 2)
    .split("\n")
    .map((line) => `  ${line}`);
  return `releaseNotes: |\n${body.join("\n")}\n`;
}

function injectReleaseNotes(releaseDir, notesPath) {
  const notes = readNotes(notesPath);
  const injected = [];
  for (const name of findManifests(releaseDir)) {
    const manifestPath = path.join(releaseDir, name);
    if (!fs.existsSync(manifestPath)) continue;
    const stripped = stripReleaseNotes(
      fs.readFileSync(manifestPath, "utf-8"),
    ).replace(/\n*$/, "\n");
    fs.writeFileSync(manifestPath, `${stripped}${releaseNotesBlock(notes)}`);
    injected.push(name);
  }
  return { injected, notes };
}

module.exports = { injectReleaseNotes, findManifests };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const releaseDir = path.resolve(
    process.argv[2] || path.join(root, "release"),
  );
  const { version } = require(path.join(root, "package.json"));
  const notesPath = path.join(root, ".tmp", `update-notes-${version}.json`);

  try {
    const { injected } = injectReleaseNotes(releaseDir, notesPath);
    if (injected.length === 0) {
      throw new Error(`no manifests found in ${releaseDir}`);
    }
    console.log(`✅ v${version} release notes → ${injected.join(", ")}`);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}
