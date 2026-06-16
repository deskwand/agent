import Store from "electron-store";
import { app } from "electron";
import os from "node:os";
import path from "node:path";
import type { InstalledPlugin } from "../../renderer/types";

interface PluginRegistrySchema {
  plugins: InstalledPlugin[];
}

class PluginRegistryStore {
  private readonly store: Store<PluginRegistrySchema>;

  constructor() {
    const storeCwd = this.resolveStoreCwd();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- electron-store requires Record<string, any>
    const storeOptions: any = {
      name: "plugin-registry",
      projectName: "omagt",
      cwd: storeCwd,
      defaults: {
        plugins: [],
      },
    };

    // 在非 Electron 进程中提供兜底项目名，避免底层 conf 初始化失败。
    this.store = new Store<PluginRegistrySchema>(storeOptions);
  }

  private resolveStoreCwd(): string {
    // Always use ~/.omagt so the registry lives in the same place
    // regardless of when app.setPath("userData", ...) runs.
    try {
      if (typeof app?.getPath === "function") {
        // app.getPath("home") is stable; app.getPath("userData") depends on
        // whether setPath has been called yet (module-level singleton issue).
        return path.join(app.getPath("home"), ".omagt");
      }
    } catch {
      // test / non-Electron fallback
    }
    return path.join(os.tmpdir(), "oma");
  }

  list(): InstalledPlugin[] {
    return this.store
      .get("plugins", [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(pluginId: string): InstalledPlugin | undefined {
    return this.store
      .get("plugins", [])
      .find((plugin) => plugin.pluginId === pluginId);
  }

  save(plugin: InstalledPlugin): InstalledPlugin {
    const plugins = this.store.get("plugins", []);
    const index = plugins.findIndex(
      (item) => item.pluginId === plugin.pluginId,
    );
    if (index >= 0) {
      plugins[index] = plugin;
    } else {
      plugins.push(plugin);
    }
    this.store.set("plugins", plugins);
    return plugin;
  }

  delete(pluginId: string): boolean {
    const plugins = this.store.get("plugins", []);
    const filtered = plugins.filter((item) => item.pluginId !== pluginId);
    if (filtered.length === plugins.length) {
      return false;
    }
    this.store.set("plugins", filtered);
    return true;
  }
}

export const pluginRegistryStore = new PluginRegistryStore();
