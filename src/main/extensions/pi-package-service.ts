import type { ProgressEvent } from "@earendil-works/pi-coding-agent";
import type { PiExtensionHost } from "./pi-extension-host";

export interface PiPackageItem {
  source: string;
  scope: "user" | "project";
  installedPath?: string;
  type: "npm" | "git" | "local";
}

export function classifySource(source: string): "npm" | "git" | "local" {
  if (source.startsWith("npm:")) return "npm";
  if (
    source.startsWith("git:") ||
    /^https?:\/\//.test(source) ||
    /^ssh:\/\//.test(source)
  ) {
    return "git";
  }
  return "local";
}

export class PiPackageService {
  constructor(private readonly getHost: () => PiExtensionHost) {}

  list(): PiPackageItem[] {
    const pm = this.getHost().getPackageManager();
    return pm.listConfiguredPackages().map((p) => ({
      source: p.source,
      scope: p.scope,
      installedPath: p.installedPath,
      type: classifySource(p.source),
    }));
  }

  async install(source: string, opts?: { local?: boolean }): Promise<void> {
    await this.getHost().getPackageManager().installAndPersist(source, opts);
  }

  async remove(source: string, opts?: { local?: boolean }): Promise<void> {
    await this.getHost().getPackageManager().removeAndPersist(source, opts);
  }

  async update(source?: string): Promise<void> {
    await this.getHost().getPackageManager().update(source);
  }

  onProgress(cb: (event: ProgressEvent) => void): () => void {
    this.getHost().getPackageManager().setProgressCallback(cb);
    return () => this.getHost().getPackageManager().setProgressCallback(undefined);
  }
}
