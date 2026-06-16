import type {
  PluginCatalogItem,
  PluginComponentCounts,
} from "../../renderer/types";

// ---------------------------------------------------------------------------
// Abstraction — swap out the fetcher when we ship our own marketplace.
// The data model is aligned with https://pi.dev/packages so the protocol
// stays the same regardless of backend.
// ---------------------------------------------------------------------------

export interface MarketplaceFetcher {
  /** Unique source identifier, e.g. 'pi.dev' | 'omagt' */
  readonly source: string;

  /** Fetch the package catalog (first page by default). */
  listPackages(options?: {
    search?: string;
    page?: number;
  }): Promise<PluginCatalogItem[]>;

  /** Fetch a single package detail (including manifest / components). */
  getPackageDetail(name: string): Promise<PluginCatalogItem | null>;
}

// ---------------------------------------------------------------------------
// Pi.dev fetcher — scrapes https://pi.dev/packages
// ---------------------------------------------------------------------------

interface PiPackageRow {
  name: string;
  description: string;
  type: "extension" | "skill" | "prompt" | "theme" | "package";
  author?: string;
  version?: string;
  license?: string;
  downloads?: number;
  npmUrl?: string;
  repoUrl?: string;
}

const PI_PACKAGES_URL = "https://pi.dev/packages";
const PI_DETAIL_URL = "https://pi.dev/packages/";
const PI_CACHE_TTL_MS = 5 * 60_000; // 5 min — npm packages update less often than Omagt plugins
const PI_FETCH_USER_AGENT = "omagt-marketplace/1.0";
const EMPTY_COUNTS: PluginComponentCounts = {
  skills: 0,
  commands: 0,
  agents: 0,
  hooks: 0,
  extensions: 0,
  mcp: 0,
};

interface CachedPiCatalog {
  expiresAt: number;
  data: PluginCatalogItem[];
}

export class PiDevFetcher implements MarketplaceFetcher {
  readonly source = "pi.dev";

  private readonly fetchFn: typeof fetch;
  private cache: CachedPiCatalog | null = null;
  private lastAbortController: AbortController | null = null;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  async listPackages(options?: {
    search?: string;
    page?: number;
  }): Promise<PluginCatalogItem[]> {
    const page = options?.page ?? 1;
    const search = options?.search?.trim().toLowerCase();

    // Cancel any in-flight request before starting a new one
    if (this.lastAbortController) {
      this.lastAbortController.abort();
    }
    const ac = new AbortController();
    this.lastAbortController = ac;

    // Only cache page 1; searches always go live
    if (
      page === 1 &&
      !search &&
      this.cache &&
      this.cache.expiresAt > Date.now()
    ) {
      return this.cache.data;
    }

    const url = `${PI_PACKAGES_URL}?page=${page}`;
    const html = await this.fetchText(url, ac.signal);
    const rows = this.parsePackageTable(html);

    const items: PluginCatalogItem[] = rows.map((row) =>
      this.toCatalogItem(row),
    );

    if (page === 1 && !search) {
      this.cache = { expiresAt: Date.now() + PI_CACHE_TTL_MS, data: items };
    }

    if (search) {
      return items.filter(
        (item) =>
          item.name.toLowerCase().includes(search) ||
          (item.description?.toLowerCase() ?? "").includes(search),
      );
    }

    return items;
  }

  async getPackageDetail(name: string): Promise<PluginCatalogItem | null> {
    try {
      const url = `${PI_DETAIL_URL}${encodeURIComponent(name)}`;
      const html = await this.fetchText(url);

      // Try to extract Pi manifest JSON from the detail page
      const manifest = this.extractManifest(html);

      // Also parse the detail row to get version / license / downloads
      const rows = this.parsePackageTable(html);
      const row = rows.find((r) => r.name.toLowerCase() === name.toLowerCase());

      const item = row
        ? this.toCatalogItem(row)
        : {
            name,
            description: undefined,
            installable: true,
            hasManifest: false,
            componentCounts: { ...EMPTY_COUNTS },
            skillCount: 0,
            hasSkills: false,
            catalogSource: "pi-agent" as const,
          };

      if (manifest) {
        item.hasManifest = true;
        item.componentCounts = this.countManifestComponents(manifest);
        (item as PluginCatalogItem).skillCount = item.componentCounts.skills;
        (item as PluginCatalogItem).hasSkills = item.componentCounts.skills > 0;
      }

      return item;
    } catch {
      return null;
    }
  }

  // ---- HTML scraping ----------------------------------------------------

  private parsePackageTable(html: string): PiPackageRow[] {
    const rows: PiPackageRow[] = [];
    const seenSlugs = new Set<string>();

    // Match <a data-package-link="true" data-package-path="/packages/NAME">TEXT</a>
    const rowRegex =
      /<a\s[^>]*\bdata-package-link="true"[^>]*\bdata-package-path="\/packages\/([^"]+)"[^>]*>([^<]*)<\/a>/gi;

    const matches = html.matchAll(rowRegex);
    for (const match of matches) {
      const slug = decodeURIComponent(match[1].trim());
      const rawName = match[2]?.trim();
      if (!slug || !rawName) continue;

      // deduplicate by slug (some packages appear in both "recent" and "all" sections)
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      const name = this.decodeHtml(rawName);

      // Extract surrounding snippet for description etc.
      const pos = match.index ?? 0;
      const snippet = html.slice(pos, pos + 2000);

      const row = this.parseRowSnippet(name, snippet);

      // Extract npm/repo links from snippet
      row.npmUrl = this.extractNpmUrl(snippet);
      row.repoUrl = this.extractRepoUrl(snippet);

      rows.push(row);
    }

    return rows;
  }

  private parseRowSnippet(name: string, snippet: string): PiPackageRow {
    const row: PiPackageRow = {
      name,
      description: "",
      type: "skill",
    };

    // Type: <span class="meta-chip packages-badge" data-type="extension">extension</span>
    const typeMatch = snippet.match(
      /<span[^>]*\bdata-type="(extension|skill|prompt|theme)"[^>]*>/i,
    );
    if (typeMatch) {
      row.type = typeMatch[1].toLowerCase() as PiPackageRow["type"];
    }

    // Description: <p class="packages-desc">...</p>
    const descMatch = snippet.match(
      /<p\s[^>]*\bclass="[^"]*packages-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    if (descMatch) {
      row.description = this.decodeHtml(
        descMatch[1].replace(/<[^>]+>/g, "").trim(),
      );
    }

    // Author: first <span> inside <div class="packages-meta">
    const authorMatch = snippet.match(
      /<div\s[^>]*\bclass="[^"]*packages-meta[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i,
    );
    if (authorMatch) {
      row.author = this.decodeHtml(authorMatch[1].trim());
    }

    // Downloads: <span>131.5K/mo</span> (second span in packages-meta)
    const dlMatch = snippet.match(/([\d,.]+[KkMm]?)\/mo/i);
    if (dlMatch) {
      row.downloads = this.parseDownloadCount(dlMatch[1]);
    }

    // License — not available in list page; kept for detail-page enrichment
    const licMatch = snippet.match(
      /\b(MIT|Apache-2\.0|ISC|GPL-\d|BSD|Unlicense|WTFPL)\b/,
    );
    if (licMatch) {
      row.license = licMatch[1];
    }

    // Version — try semver near the package name
    const verMatch = snippet.match(/v?(\d+\.\d+\.\d+)/);
    if (verMatch && !snippet.slice(0, 50).includes("pi.dev")) {
      // avoid matching pi.dev site version
      row.version = verMatch[1];
    }

    return row;
  }

  private extractNpmUrl(snippet: string): string | undefined {
    const m = snippet.match(
      /href="(https:\/\/www\.npmjs\.com\/package\/[^"]+)"/i,
    );
    return m?.[1];
  }

  private extractRepoUrl(snippet: string): string | undefined {
    const m = snippet.match(/href="(https:\/\/github\.com\/[^"]+)"/i);
    return m?.[1];
  }

  private extractManifest(html: string): Record<string, unknown> | null {
    // Pi manifest is embedded as JSON in the detail page
    const match = html.match(
      /<code[^>]*class="[^"]*language-json[^"]*"[^>]*>([\s\S]*?)<\/code>/i,
    );
    if (!match?.[1]) return null;
    try {
      return JSON.parse(this.decodeHtml(match[1].trim())) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
  }

  private countManifestComponents(
    manifest: Record<string, unknown>,
  ): PluginComponentCounts {
    return {
      skills: Array.isArray(manifest.skills) ? manifest.skills.length : 0,
      commands: Array.isArray(manifest.commands) ? manifest.commands.length : 0,
      agents: Array.isArray(manifest.agents) ? manifest.agents.length : 0,
      hooks:
        manifest.hooks && typeof manifest.hooks === "object"
          ? Object.keys(manifest.hooks as Record<string, unknown>).length
          : 0,
      extensions:
        typeof manifest.extensions === "string"
          ? 1
          : Array.isArray(manifest.extensions)
            ? manifest.extensions.length
            : 0,
      mcp:
        manifest.mcpServers && typeof manifest.mcpServers === "object"
          ? Object.keys(manifest.mcpServers as Record<string, unknown>).length
          : 0,
    };
  }

  // ---- helpers ----------------------------------------------------------

  private parseDownloadCount(raw: string): number {
    const cleaned = raw.replace(/,/g, "").trim();
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    if (cleaned.toLowerCase().endsWith("k")) return Math.round(num * 1000);
    if (cleaned.toLowerCase().endsWith("m")) return Math.round(num * 1_000_000);
    return Math.round(num);
  }

  private toCatalogItem(row: PiPackageRow): PluginCatalogItem {
    return {
      name: row.name,
      description: row.description || undefined,
      version: row.version,
      authorName: row.author,
      installable: true,
      hasManifest: false,
      componentCounts: { ...EMPTY_COUNTS },
      skillCount: 0,
      hasSkills: false,
      pluginId: row.name, // pi uses package name as plugin id
      installCommand: `pi install npm:${row.name}`,
      detailUrl: `${PI_DETAIL_URL}${encodeURIComponent(row.name)}`,
      catalogSource: "pi-agent",
      packageType: row.type === "package" ? undefined : row.type,
      downloadCount: row.downloads,
      license: row.license,
      npmUrl: row.npmUrl,
      repoUrl: row.repoUrl,
    };
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ");
  }

  private async fetchText(url: string, signal?: AbortSignal): Promise<string> {
    const response = await this.fetchFn(url, {
      headers: { "User-Agent": PI_FETCH_USER_AGENT },
      signal,
    });
    if (!response.ok) {
      // Don't wrap AbortError — let callers handle cancellation gracefully
      if (signal?.aborted) {
        throw new Error(`Fetch aborted for ${url}`);
      }
      throw new Error(`Fetch failed (${response.status}) for ${url}`);
    }
    return response.text();
  }
}
