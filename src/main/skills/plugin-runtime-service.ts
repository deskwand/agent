import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  InstalledPlugin,
  PluginCatalogItemV2,
  PluginComponentCounts,
  PluginComponentEnabledState,
  PluginComponentKind,
  PluginInstallResultV2,
  PluginToggleResult,
} from "../../renderer/types";
import type {
  PluginSlashCommand,
  PluginSlashItems,
  PluginSlashSkill,
} from "../../shared/ipc-types";
import { log } from "../utils/logger";
import { isPathWithinRoot } from "../tools/path-containment";
import { pluginRegistryStore } from "./plugin-registry-store";
import { PluginCatalogService } from "./plugin-catalog-service";

interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | Record<string, unknown>;
  extensions?: string | string[];
  mcpServers?: string | Record<string, unknown>;
  [key: string]: unknown;
}

const EMPTY_COUNTS: PluginComponentCounts = {
  skills: 0,
  commands: 0,
  agents: 0,
  hooks: 0,
  extensions: 0,
  mcp: 0,
};

const EMPTY_COMPONENT_STATE: PluginComponentEnabledState = {
  skills: false,
  commands: false,
  agents: false,
  hooks: false,
  extensions: false,
  mcp: false,
};

function cloneCounts(counts: PluginComponentCounts): PluginComponentCounts {
  return {
    skills: counts.skills,
    commands: counts.commands,
    agents: counts.agents,
    hooks: counts.hooks,
    extensions: counts.extensions,
    mcp: counts.mcp,
  };
}

function cloneComponentState(
  state: PluginComponentEnabledState,
): PluginComponentEnabledState {
  return {
    skills: state.skills,
    commands: state.commands,
    agents: state.agents,
    hooks: state.hooks,
    extensions: state.extensions,
    mcp: state.mcp,
  };
}

export class PluginRuntimeService {
  private readonly catalogService: PluginCatalogService;
  private piPkgMgr: DefaultPackageManager | null = null;

  // ---- Slash-items cache (invalidated on install / uninstall / enable / disable) ----
  private _slashItemsCache: PluginSlashItems | null = null;
  private _slashItemsCacheMs = 0;
  private static readonly SLASH_ITEMS_CACHE_TTL_MS = 5 * 60_000;

  constructor(
    catalogService: PluginCatalogService = new PluginCatalogService(),
  ) {
    this.catalogService = catalogService;
  }

  // ---- Pi SDK package manager (lazy-init) -------------------------------

  private getPiPkgMgr(): DefaultPackageManager {
    if (!this.piPkgMgr) {
      // Use ~/.omagt so pi reads/writes settings.json + npm packages there,
      // consistent with agent-runner's ResourceLoader.
      const agentDir = path.join(app.getPath("home"), ".omagt");
      const settingsMgr = SettingsManager.create(process.cwd(), agentDir);
      this.piPkgMgr = new DefaultPackageManager({
        cwd: process.cwd(),
        agentDir,
        settingsManager: settingsMgr,
      });
    }
    return this.piPkgMgr;
  }

  // ---- Catalog ----------------------------------------------------------

  async listCatalog(options?: {
    installableOnly?: boolean;
    page?: number;
  }): Promise<PluginCatalogItemV2[]> {
    // TODO: honor installableOnly after MarketplaceFetcher gains server-side
    // filtering. For now pi.dev/packages has no filter API so we return all
    // and let the UI show installable status per card.
    const plugins = await this.catalogService.listPackages(undefined, {
      page: options?.page ?? 1,
    });
    return plugins.map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      authorName: plugin.authorName,
      installable: plugin.installable,
      hasManifest: plugin.hasManifest,
      componentCounts: cloneCounts(plugin.componentCounts),
      pluginId: plugin.pluginId,
      installCommand: plugin.installCommand,
      detailUrl: plugin.detailUrl,
      catalogSource: plugin.catalogSource,
      packageType: plugin.packageType,
      downloadCount: plugin.downloadCount,
      license: plugin.license,
      npmUrl: plugin.npmUrl,
      repoUrl: plugin.repoUrl,
    }));
  }

  listInstalled(): InstalledPlugin[] {
    return pluginRegistryStore
      .list()
      .map((plugin) => this.normalizeInstalledPlugin(plugin));
  }

  // ---- Install (pi-agent path) ------------------------------------------

  async install(pluginRef: string): Promise<PluginInstallResultV2> {
    const name = pluginRef.trim();
    const source = `npm:${name}`;
    log(`[PluginRuntime] Install pi package: ${source}`);

    const pkgMgr = this.getPiPkgMgr();

    // Let pi SDK handle everything: npm install + persist to pi settings.json.
    // This ensures reload() discovers the package and jiti alias resolves correctly.
    await pkgMgr.installAndPersist(source);

    // Read installed path from pi's npm directory (~/.omagt/npm/node_modules/…)
    const installedPath = pkgMgr.getInstalledPath(source, "user");
    if (!installedPath || !fs.existsSync(installedPath)) {
      throw new Error(`Failed to locate installed path for ${name}.`);
    }

    const pkgJson = this.readPkgJson(installedPath);
    const displayName = pkgJson?.name?.trim() || name;
    const pluginId = this.sanitizePluginId(displayName);
    const componentCounts = this.detectComponentCounts(installedPath, null);

    const now = Date.now();
    const defaultComponentState =
      this.getDefaultComponentState(componentCounts);
    const hasAnyComponent = this.hasAnyEnabledComponent(
      defaultComponentState,
      componentCounts,
    );

    const installedPlugin: InstalledPlugin = {
      pluginId,
      name: displayName,
      description: pkgJson?.description,
      version: pkgJson?.version,
      authorName: this.resolveAuthorName(pkgJson?.author),
      enabled: hasAnyComponent,
      sourcePath: installedPath,
      runtimePath: installedPath, // pi manages files; no copy needed
      componentCounts,
      componentsEnabled: defaultComponentState,
      installedAt: now,
      updatedAt: now,
    };

    pluginRegistryStore.save(installedPlugin);

    const result = {
      plugin: this.normalizeInstalledPlugin(installedPlugin),
      installedSkills: this.listSkillNames(installedPath),
      warnings: [] as string[],
    };
    log(
      `[PluginRuntime] Pi install completed: ${result.plugin.name} (${result.plugin.pluginId}), path=${installedPath}`,
    );
    return result;
  }

  async setEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<PluginToggleResult> {
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const normalized = this.normalizeInstalledPlugin(plugin);
    normalized.enabled = enabled;
    normalized.updatedAt = Date.now();
    pluginRegistryStore.save(normalized);

    log(
      `[PluginRuntime] Plugin toggled: ${normalized.name} (${pluginId}) enabled=${enabled}`,
    );
    return {
      success: true,
      plugin: this.normalizeInstalledPlugin(normalized),
    };
  }

  async setComponentEnabled(
    pluginId: string,
    component: PluginComponentKind,
    enabled: boolean,
  ): Promise<PluginToggleResult> {
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const normalized = this.normalizeInstalledPlugin(plugin);
    const hasComponent = normalized.componentCounts[component] > 0;
    normalized.componentsEnabled[component] = enabled && hasComponent;
    normalized.updatedAt = Date.now();
    pluginRegistryStore.save(normalized);

    log(
      `[PluginRuntime] Plugin component toggled: ${normalized.name} (${pluginId}) component=${component} enabled=${normalized.componentsEnabled[component]} available=${hasComponent}`,
    );
    return {
      success: true,
      plugin: this.normalizeInstalledPlugin(normalized),
    };
  }

  async uninstall(pluginId: string): Promise<{ success: boolean }> {
    log(`[PluginRuntime] Uninstall requested: ${pluginId}`);
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      log(`[PluginRuntime] Uninstall skipped: plugin not found (${pluginId})`);
      return { success: false };
    }

    // Let pi SDK remove the npm package + settings.json entry
    const source = `npm:${plugin.name}`;
    try {
      const pkgMgr = this.getPiPkgMgr();
      await pkgMgr.removeAndPersist(source);
    } catch (e) {
      log(`[PluginRuntime] pi removeAndPersist failed for ${pluginId}:`, e);
    }

    pluginRegistryStore.delete(pluginId);
    log(`[PluginRuntime] Uninstall completed: ${plugin.name} (${pluginId})`);
    return { success: true };
  }

  async getEnabledRuntimePlugins(): Promise<InstalledPlugin[]> {
    return this.listInstalled().filter(
      (plugin) =>
        plugin.enabled &&
        this.hasAnyEnabledComponent(
          plugin.componentsEnabled,
          plugin.componentCounts,
        ),
    );
  }

  /** Invalidate the slash-items cache so the next / menu rebuilds from disk. */
  invalidateSlashItemsCache(): void {
    this._slashItemsCache = null;
  }

  /**
   * Return skills + extension commands from installed plugins for
   * the slash-command menu.  Uses pi's DefaultResourceLoader so the same
   * settings.json → jiti-alias pipeline applies — no separate manual extraction.
   */
  async listSlashItems(): Promise<PluginSlashItems> {
    const now = Date.now();
    if (
      this._slashItemsCache &&
      now - this._slashItemsCacheMs <
        PluginRuntimeService.SLASH_ITEMS_CACHE_TTL_MS
    ) {
      return this._slashItemsCache;
    }

    const skills: PluginSlashSkill[] = [];
    const commands: PluginSlashCommand[] = [];

    const enabledPlugins = await this.getEnabledRuntimePlugins();

    // Plugin skills need explicit additionalSkillPaths because pi packages
    // don't always declare pi.skills in package.json.
    const additionalSkillPaths: string[] = [];
    for (const plugin of enabledPlugins) {
      if (
        plugin.componentsEnabled.skills &&
        plugin.componentCounts.skills > 0
      ) {
        const skillsPath = path.join(plugin.runtimePath, "skills");
        if (fs.existsSync(skillsPath)) {
          additionalSkillPaths.push(skillsPath);
        }
      }
    }

    try {
      const agentDir = path.join(app.getPath("home"), ".omagt");
      const resourceLoader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir,
        additionalSkillPaths,
      });
      await resourceLoader.reload();

      // Extensions → commands (from pi settings.json packages)
      const extResult = resourceLoader.getExtensions();
      if (extResult.errors.length > 0) {
        for (const e of extResult.errors) {
          log(
            "[PluginRuntime] listSlashItems: extError:",
            String(e.error || e).slice(0, 500),
          );
        }
      }
      for (const ext of extResult.extensions) {
        for (const [name, cmd] of ext.commands) {
          if (!commands.some((c) => c.name === name)) {
            commands.push({
              name,
              label: name,
              description: cmd.description || "",
            });
          }
        }
      }

      // Skills (from packages + additionalSkillPaths)
      const skillResult = resourceLoader.getSkills();

      for (const skill of skillResult.skills) {
        if (skill.disableModelInvocation) continue;
        skills.push({
          name: skill.name,
          description: skill.description || "",
        });
      }
    } catch (err) {
      log("[PluginRuntime] listSlashItems: reload FAILED", err);
    }

    this._slashItemsCache = { skills, commands };
    this._slashItemsCacheMs = now;
    return { skills, commands };
  }

  private detectComponentCounts(
    pluginRootPath: string,
    manifest: PluginManifest | null,
  ): PluginComponentCounts {
    const counts = cloneCounts(EMPTY_COUNTS);
    counts.skills = this.countSkills(pluginRootPath);
    counts.commands = this.countMarkdownComponent(
      pluginRootPath,
      this.resolveComponentPaths(manifest?.commands, ["./commands"]),
    );
    counts.agents = this.countMarkdownComponent(
      pluginRootPath,
      this.resolveComponentPaths(manifest?.agents, ["./agents"]),
    );
    counts.hooks = this.countHooks(pluginRootPath, manifest);
    counts.extensions = this.countExtensions(pluginRootPath, manifest);
    counts.mcp = this.countMcp(pluginRootPath, manifest);
    return counts;
  }

  private countExtensions(
    pluginRootPath: string,
    manifest: PluginManifest | null,
  ): number {
    // 1. pi convention: read package.json → pi.extensions
    //    (matches DefaultPackageManager.resolveExtensionEntries)
    const pkgPath = path.join(pluginRootPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
          pi?: { extensions?: string | string[] };
        };
        if (Array.isArray(pkg?.pi?.extensions))
          return pkg.pi!.extensions!.length;
        if (typeof pkg?.pi?.extensions === "string") return 1;
      } catch {
        /* ignore malformed package.json */
      }
    }
    // 2. omagt manifest (.omagt-plugin/plugin.json)
    if (typeof manifest?.extensions === "string") return 1;
    if (Array.isArray(manifest?.extensions)) return manifest.extensions.length;
    // 3. Fallback: scan extensions/ directory
    const extDir = path.join(pluginRootPath, "extensions");
    if (!fs.existsSync(extDir) || !fs.statSync(extDir).isDirectory()) return 0;
    const files = fs.readdirSync(extDir);
    return files.filter(
      (f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs"),
    ).length;
  }

  private countSkills(pluginRootPath: string): number {
    const skillsRoot = path.join(pluginRootPath, "skills");
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
      return 0;
    }
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    return entries.reduce((count, entry) => {
      if (!entry.isDirectory()) {
        return count;
      }
      const skillFile = path.join(skillsRoot, entry.name, "SKILL.md");
      return fs.existsSync(skillFile) ? count + 1 : count;
    }, 0);
  }

  private countMarkdownComponent(
    pluginRootPath: string,
    relativePaths: string[],
  ): number {
    const uniqueFiles = new Set<string>();
    for (const relativePath of relativePaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, relativePath);
      if (!absolutePath || !fs.existsSync(absolutePath)) {
        continue;
      }
      this.collectMarkdownFiles(absolutePath, uniqueFiles);
    }
    return uniqueFiles.size;
  }

  private countHooks(
    pluginRootPath: string,
    manifest: PluginManifest | null,
  ): number {
    if (manifest?.hooks && typeof manifest.hooks === "object") {
      return 1;
    }

    const hookPaths =
      typeof manifest?.hooks === "string"
        ? [manifest.hooks]
        : ["./hooks/hooks.json"];

    for (const hookPath of hookPaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, hookPath);
      if (absolutePath && fs.existsSync(absolutePath)) {
        return 1;
      }
    }
    return 0;
  }

  private countMcp(
    pluginRootPath: string,
    manifest: PluginManifest | null,
  ): number {
    if (manifest?.mcpServers && typeof manifest.mcpServers === "object") {
      return 1;
    }

    const mcpPaths =
      typeof manifest?.mcpServers === "string"
        ? [manifest.mcpServers]
        : ["./.mcp.json"];

    for (const mcpPath of mcpPaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, mcpPath);
      if (absolutePath && fs.existsSync(absolutePath)) {
        return 1;
      }
    }
    return 0;
  }

  private getDefaultComponentState(
    componentCounts: PluginComponentCounts,
  ): PluginComponentEnabledState {
    return {
      skills: componentCounts.skills > 0,
      commands: componentCounts.commands > 0,
      agents: componentCounts.agents > 0,
      extensions: componentCounts.extensions > 0,
      hooks: false,
      mcp: false,
    };
  }

  private hasAnyEnabledComponent(
    componentsEnabled: PluginComponentEnabledState,
    componentCounts: PluginComponentCounts,
  ): boolean {
    return (Object.keys(componentsEnabled) as PluginComponentKind[]).some(
      (component) =>
        componentsEnabled[component] && componentCounts[component] > 0,
    );
  }

  private resolveComponentPaths(
    value: string | string[] | undefined,
    fallback: string[],
  ): string[] {
    if (!value) {
      return fallback;
    }
    return Array.isArray(value) ? value : [value];
  }

  private resolveSafePath(
    rootPath: string,
    relativePath: string,
  ): string | null {
    const normalized = relativePath
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/")) {
      return null;
    }
    const resolved = path.resolve(rootPath, normalized);
    if (!isPathWithinRoot(resolved, rootPath)) {
      return null;
    }
    return resolved;
  }

  private collectMarkdownFiles(targetPath: string, output: Set<string>): void {
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      if (targetPath.toLowerCase().endsWith(".md")) {
        output.add(targetPath);
      }
      return;
    }

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      this.collectMarkdownFiles(path.join(targetPath, entry.name), output);
    }
  }

  private listSkillNames(pluginRootPath: string): string[] {
    const skillsRoot = path.join(pluginRootPath, "skills");
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
      return [];
    }
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillFile = path.join(skillsRoot, entry.name, "SKILL.md");
      if (fs.existsSync(skillFile)) {
        names.push(entry.name);
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  private readPkgJson(pluginRootPath: string): {
    name?: string;
    description?: string;
    version?: string;
    author?: string | { name?: string };
  } | null {
    const pkgPath = path.join(pluginRootPath, "package.json");
    if (!fs.existsSync(pkgPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    } catch {
      return null;
    }
  }

  private sanitizePluginId(name: string): string {
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return sanitized || `plugin-${Date.now()}`;
  }

  private resolveAuthorName(
    author: PluginManifest["author"],
  ): string | undefined {
    if (!author) {
      return undefined;
    }
    if (typeof author === "string") {
      return author;
    }
    return author.name;
  }

  private normalizeInstalledPlugin(plugin: InstalledPlugin): InstalledPlugin {
    return {
      ...plugin,
      componentCounts: plugin.componentCounts
        ? cloneCounts(plugin.componentCounts)
        : cloneCounts(EMPTY_COUNTS),
      componentsEnabled: plugin.componentsEnabled
        ? cloneComponentState(plugin.componentsEnabled)
        : cloneComponentState(EMPTY_COMPONENT_STATE),
    };
  }
}
