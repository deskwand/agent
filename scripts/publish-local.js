#!/usr/bin/env node

/**
 * Copy release artifacts to a local publish directory for manual upload.
 *
 * Usage: node scripts/publish-local.js [--dir <path>]
 * Default output: ./publish/
 */

const fs = require("fs");
const path = require("path");

function resolveOutDir() {
  const idx = process.argv.indexOf("--dir");
  if (idx === -1) return path.resolve(process.cwd(), "publish");
  const val = process.argv[idx + 1];
  if (!val || val.startsWith("--")) {
    console.error('ERROR: --dir requires a path, e.g. --dir /tmp/release');
    process.exit(1);
  }
  return path.resolve(val);
}
const outDir = resolveOutDir();

const releaseDir = path.resolve(process.cwd(), "release");

if (!fs.existsSync(releaseDir)) {
  console.error("ERROR: release/ not found. Run a build first.");
  process.exit(1);
}

// Collect latest*.yml files and the artifacts they reference.
// Parsing latest*.yml is more reliable than globbing DeskWand-*,
// because release/ may contain stale old-version artifacts.
const ymlFiles = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.startsWith("latest"))
  .map((d) => d.name);

if (ymlFiles.length === 0) {
  console.error("ERROR: No latest*.yml found in release/. Run a build first.");
  process.exit(1);
}

const referencedFiles = new Set();
for (const ymlName of ymlFiles) {
  referencedFiles.add(ymlName);
  const content = fs.readFileSync(path.join(releaseDir, ymlName), "utf-8");
  // Extract url fields from the files: array (simple line-based parse)
  const lines = content.split("\n");
  let inFiles = false;
  for (const line of lines) {
    if (line.startsWith("files:")) { inFiles = true; continue; }
    if (inFiles && /^[a-z]/.test(line)) { inFiles = false; continue; }
    if (inFiles) {
      const m = line.match(/^\s*-?\s*url:\s*(.+)$/);
      if (m) referencedFiles.add(m[1].trim());
    }
  }
}

const files = [];
const missing = [];
for (const name of referencedFiles) {
  const p = path.join(releaseDir, name);
  if (fs.existsSync(p)) {
    files.push({ name, size: fs.statSync(p).size });
  } else {
    missing.push(name);
  }
}

if (missing.length > 0) {
  console.error("ERROR: latest*.yml references missing files:", missing.join(", "));
  process.exit(1);
}

if (files.length === 0) {
  console.error("ERROR: No publishable files found in release/");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

let totalSize = 0;
for (const { name, size } of files) {
  const src = path.join(releaseDir, name);
  const dst = path.join(outDir, name);
  fs.copyFileSync(src, dst);
  totalSize += size;
  console.log(`  ${name.padEnd(40)} ${(size / 1024 / 1024).toFixed(1)} MB`);
}

const pkg = require(path.join(process.cwd(), "package.json"));
console.log(`\n📦 DeskWand v${pkg.version} → ${outDir}/`);
console.log(`   共 ${files.length} 个文件, ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`   👉 上传此目录内容到 https://deskwand.com/ 根目录即可`);
