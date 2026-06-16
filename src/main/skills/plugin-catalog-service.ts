import type { PluginCatalogItem } from "../../renderer/types";
import type { MarketplaceFetcher } from "./marketplace-fetcher";
import { PiDevFetcher } from "./marketplace-fetcher";

export class PluginCatalogService {
  private fetchers = new Map<string, MarketplaceFetcher>();
  private defaultFetcher: MarketplaceFetcher;

  constructor(fetchFn: typeof fetch = fetch) {
    this.defaultFetcher = new PiDevFetcher(fetchFn);
    this.fetchers.set(this.defaultFetcher.source, this.defaultFetcher);
  }

  registerFetcher(fetcher: MarketplaceFetcher): void {
    this.fetchers.set(fetcher.source, fetcher);
  }

  async listPackages(
    source?: string,
    options?: { search?: string; page?: number },
  ): Promise<PluginCatalogItem[]> {
    const fetcher = source ? this.fetchers.get(source) : this.defaultFetcher;
    if (!fetcher) {
      throw new Error(`Unknown marketplace source: ${source}`);
    }
    return fetcher.listPackages(options);
  }

  async getPackageDetail(
    name: string,
    source?: string,
  ): Promise<PluginCatalogItem | null> {
    const fetcher = source ? this.fetchers.get(source) : this.defaultFetcher;
    if (!fetcher) return null;
    return fetcher.getPackageDetail(name);
  }
}
