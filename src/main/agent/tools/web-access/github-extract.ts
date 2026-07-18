/** Adapted from nicobailon/pi-web-access v0.13.0 (commit 7bdc30a), MIT License. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fetchGitHubApi } from "./github-api";
import type { ExtractedContent } from "./types";

const MAX_REPO_SIZE_KB = 350 * 1024;
const ABSOLUTE_MAX_REPO_SIZE_KB = 1024 * 1024;
const CLONE_TIMEOUT_MS = 30_000;
const MAX_README_BYTES = 100_000;

export interface GitHubUrlInfo {
  owner: string;
  repo: string;
  kind: "repo" | "tree" | "blob";
  ref?: string;
  path?: string;
}

export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com") return null;
  let parts: string[];
  try {
    parts = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  const [owner, rawRepo, marker, ref, ...rest] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    return null;
  }
  if (marker === "tree" && ref) {
    return { owner, repo, kind: "tree", ref, path: rest.join("/") };
  }
  if (marker === "blob" && ref) {
    return { owner, repo, kind: "blob", ref, path: rest.join("/") };
  }
  return parts.length === 2 ? { owner, repo, kind: "repo" } : null;
}

async function runGitClone(
  url: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "git",
      ["clone", "--depth", "1", url, destination],
      { timeout: CLONE_TIMEOUT_MS, signal },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function listTree(
  root: string,
  current = "",
  limit = 200,
): Promise<string[]> {
  if (limit <= 0) return [];
  const entries = await readdir(join(root, current), { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || output.length >= limit) continue;
    const relative = current ? `${current}/${entry.name}` : entry.name;
    output.push(entry.isDirectory() ? `${relative}/` : relative);
    if (entry.isDirectory()) {
      output.push(...(await listTree(root, relative, limit - output.length)));
    }
  }
  return output.slice(0, limit);
}

async function readRegularFile(path: string): Promise<string> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) return "";
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_README_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      const content = buffer.subarray(0, bytesRead).toString("utf8");
      return stat.size > MAX_README_BYTES
        ? `${content}\n\n[README truncated at ${MAX_README_BYTES} bytes]`
        : content;
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

function encodeGitHubPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function apiExtract(
  info: GitHubUrlInfo,
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  if (info.kind === "blob" && info.ref && info.path) {
    const text = await fetchGitHubApi<string>(
      `/repos/${info.owner}/${info.repo}/contents/${encodeGitHubPath(info.path)}?ref=${encodeURIComponent(info.ref)}`,
      signal,
      "application/vnd.github.raw+json",
    );
    return text === null
      ? null
      : { url, title: info.path, content: text, error: null };
  }
  const path = info.path ? `/${encodeGitHubPath(info.path)}` : "";
  const query = info.ref ? `?ref=${encodeURIComponent(info.ref)}` : "";
  const entries = await fetchGitHubApi<
    Array<{ name?: string; path?: string; type?: string }>
  >(`/repos/${info.owner}/${info.repo}/contents${path}${query}`, signal);
  if (!entries) return null;
  const lines = entries.map(
    (entry) =>
      `${entry.type === "dir" ? "📁" : "📄"} ${entry.path || entry.name || ""}`,
  );
  return {
    url,
    title: `${info.owner}/${info.repo}`,
    content: `# ${info.owner}/${info.repo}\n\n${lines.join("\n")}`,
    error: null,
  };
}

export async function extractGitHub(
  url: string,
  signal: AbortSignal | undefined,
  options: { forceClone?: boolean; tempDir: string },
): Promise<ExtractedContent | null> {
  const info = parseGitHubUrl(url);
  if (!info) return null;
  if (info.kind !== "repo") return apiExtract(info, url, signal);

  const metadata = await fetchGitHubApi<{ size?: number }>(
    `/repos/${info.owner}/${info.repo}`,
    signal,
  );
  if (
    typeof metadata?.size !== "number" ||
    metadata.size > ABSOLUTE_MAX_REPO_SIZE_KB ||
    (!options.forceClone && metadata.size > MAX_REPO_SIZE_KB)
  ) {
    return apiExtract(info, url, signal);
  }

  const ownerDir = join(options.tempDir, info.owner);
  const destination = join(ownerDir, info.repo);
  try {
    await mkdir(ownerDir, { recursive: true });
    if (!existsSync(destination)) {
      await runGitClone(
        `https://github.com/${info.owner}/${info.repo}.git`,
        destination,
        signal,
      );
    }
    const tree = await listTree(destination);
    const readmeName = tree.find((item) => /^readme(?:\.[^/]+)?$/i.test(item));
    const readme = readmeName
      ? await readRegularFile(join(destination, readmeName))
      : "";
    return {
      url,
      title: `${info.owner}/${info.repo}`,
      content: `Local clone: ${destination}\n\n## Files\n${tree.join("\n")}${readme ? `\n\n## README\n${readme}` : ""}`,
      error: null,
    };
  } catch {
    return apiExtract(info, url, signal);
  }
}
