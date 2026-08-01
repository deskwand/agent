import { logWarn } from "../utils/logger";

export type PiPackageType =
  | "extension"
  | "skill"
  | "prompt"
  | "theme"
  | "package";

export interface PiMarketPackage {
  name: string;
  description: string;
  version: string;
  author?: string;
  date?: string;
  type: PiPackageType;
}

export interface PiMarketSearchResult {
  total: number;
  objects: PiMarketPackage[];
}

export interface PiMarketDetail extends PiMarketPackage {
  gallery?: { video?: string; image?: string };
  repository?: string;
  homepage?: string;
}

const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const REQUEST_TIMEOUT_MS = 10_000;

function inferType(keywords: string[] | undefined): PiPackageType {
  const set = new Set((keywords ?? []).map((k) => k.toLowerCase()));
  if (set.has("pi-extension") || set.has("extension")) return "extension";
  if (set.has("pi-skill") || set.has("skill")) return "skill";
  if (set.has("pi-prompt") || set.has("prompt")) return "prompt";
  if (set.has("pi-theme") || set.has("theme")) return "theme";
  return "package";
}

function normalizeAuthor(author: unknown): string | undefined {
  if (typeof author === "string") return author;
  if (author && typeof author === "object") {
    const name = (author as { name?: string }).name;
    if (typeof name === "string") return name;
  }
  return undefined;
}

function resolveAbsoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  try {
    const resolved = new URL(url, REGISTRY_ORIGIN + "/").toString();
    // 只放行 http(s)：拒绝 data:/file:/javascript: 等 scheme 进入 img/video src
    return /^https?:\/\//i.test(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

// npm package names only contain [a-z0-9-_.~] plus a single "/" separator for
// scoped packages, so escaping the slash is sufficient and yields the
// registry-documented form "@scope%2Fname" for HTTP URLs.
function encodePackageName(name: string): string {
  return name.replace("/", "%2F");
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`npm request failed: ${response.status} ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export class PiMarketService {
  async search(query: string, page: number): Promise<PiMarketSearchResult> {
    const text = `keywords:pi-package${query.trim() ? " " + query.trim() : ""}`;
    const url =
      `${REGISTRY_ORIGIN}/-/v1/search?text=${encodeURIComponent(text)}` +
      `&size=20&from=${page * 20}&sort=popularity`;
    const data = (await fetchJson(url)) as {
      total?: number;
      objects?: Array<{ package?: Record<string, unknown> }>;
    };
    const objects: PiMarketPackage[] = (data.objects ?? []).map((entry) => {
      const pkg = entry.package ?? {};
      return {
        name: String(pkg.name ?? ""),
        description: String(pkg.description ?? ""),
        version: String(pkg.version ?? ""),
        author: normalizeAuthor(pkg.author),
        date: typeof pkg.date === "string" ? pkg.date : undefined,
        type: inferType(pkg.keywords as string[] | undefined),
      };
    });
    return { total: data.total ?? 0, objects };
  }

  async download(name: string): Promise<number> {
    try {
      const data = (await fetchJson(
        `https://api.npmjs.org/downloads/point/last-month/${encodePackageName(name)}`,
      )) as { downloads?: number };
      return typeof data.downloads === "number" ? data.downloads : 0;
    } catch (error) {
      logWarn(`[PiMarketService] download failed for ${name}:`, error);
      return 0;
    }
  }

  async detail(name: string): Promise<PiMarketDetail> {
    const data = (await fetchJson(
      `${REGISTRY_ORIGIN}/${encodePackageName(name)}/latest`,
    )) as Record<string, unknown>;
    const pi = (data.pi ?? {}) as { video?: string; image?: string };
    const repo = data.repository;
    return {
      name: String(data.name ?? name),
      description: String(data.description ?? ""),
      version: String(data.version ?? ""),
      author: normalizeAuthor(data.author),
      date: typeof data.date === "string" ? data.date : undefined,
      type: inferType(data.keywords as string[] | undefined),
      gallery: pi.video || pi.image
        ? { video: resolveAbsoluteUrl(pi.video), image: resolveAbsoluteUrl(pi.image) }
        : undefined,
      repository:
        typeof repo === "string"
          ? repo
          : repo && typeof repo === "object"
            ? ((repo as { url?: string }).url ?? undefined)
            : undefined,
      homepage:
        typeof data.homepage === "string" ? data.homepage : undefined,
    };
  }
}
