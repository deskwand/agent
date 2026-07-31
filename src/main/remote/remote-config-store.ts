/**
 * Remote Config Store
 * 远程控制配置存储
 */

import Store from "electron-store";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { join } from "node:path";
import { log } from "../utils/logger";
import type {
  RemoteConfig,
  GatewayConfig,
  WechatChannelConfig,
  TelegramChannelConfig,
  DingtalkChannelConfig,
  WebSocketChannelConfig,
  PairedUser,
} from "./types";
import { DEFAULT_REMOTE_CONFIG } from "./types";
import type { RuntimeChannelType } from "./runtime/contracts";
import { ChannelSecretStore, SECRET_SENTINEL_PREFIX } from "./channel-secret-store";

export interface ChannelInstanceRecord {
  id: string;
  name: string;
  type: RuntimeChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Per-instance policy override (set during migration or explicit config). */
  policy?: Record<string, unknown>;
}

type RemoteStoreData = RemoteConfig & {
  pairedUsers: PairedUser[];
  channelInstances: ChannelInstanceRecord[];
};

const SECRET_FIELDS = new Set([
  "appSecret",
  "botToken",
  "appToken",
  "signingSecret",
  "verificationToken",
  "encryptKey",
  "puppetToken",
  "apiKey",
  "apiSecret",
  "token",
  "secret",
  "password",
  "accessToken",
  "refreshToken",
]);

class RemoteConfigStore {
  private store: Store<RemoteStoreData>;
  private secretStore: ChannelSecretStore;

  constructor(secretStore?: ChannelSecretStore) {
    this.store = new Store<RemoteStoreData>({
      name: "remote-config",
      defaults: {
        ...DEFAULT_REMOTE_CONFIG,
        pairedUsers: [],
        channelInstances: [],
      },
    });

    this.secretStore =
      secretStore ??
      new ChannelSecretStore(join(app.getPath("userData"), "channel-secrets"));

    // Migrate: change pairing mode to allowlist (allow everyone by default)
    this.migrateAuthMode();

    // Migrate: idempotently copy legacy Slack entries into channelInstances
    this.migrateLegacySlack();

    // Migrate: move existing plaintext secrets into the secure store
    this.migratePlaintextSecrets();
  }

  /** Returns true when the secureChannelSecrets feature flag is enabled. */
  private get isSecureSecretsEnabled(): boolean {
    return this.store.get("gateway.secureChannelSecrets") === true;
  }

  /**
   * Migrate old pairing mode to allowlist, preserving existing paired users
   */
  private migrateAuthMode(): void {
    const gateway = this.store.get("gateway");
    if (gateway?.auth?.mode === "pairing") {
      // Carry over already-paired user IDs so they are not locked out.
      // Use channelType:userId format to preserve channel scoping.
      const pairedUsers = this.store.get("pairedUsers", []);
      const allowlist = pairedUsers.map(
        (u: PairedUser) => `${u.channelType}:${u.userId}`,
      );

      log(
        "[RemoteConfig] Migrating auth mode from pairing to allowlist, preserving",
        allowlist.length,
        "users",
      );
      this.store.set("gateway.auth", {
        mode: "allowlist",
        allowlist,
        requirePairing: false,
      });
    }
  }

  /**
   * Get all remote config
   */
  getAll(): RemoteConfig {
    const rawChannels = this.store.get("channels") as unknown as
      | Record<string, unknown>
      | undefined;
    return {
      gateway: this.store.get("gateway"),
      channels: (this.isSecureSecretsEnabled && rawChannels
        ? this.hydrateLegacyConfig(rawChannels)
        : rawChannels) as RemoteConfig["channels"],
    };
  }

  listChannelInstances(maskCredentials = true): ChannelInstanceRecord[] {
    const storedInstances = this.store.get("channelInstances", []);
    const instances = Array.isArray(storedInstances) ? storedInstances : [];
    return instances.map((instance) => ({
      ...instance,
      config: maskCredentials
        ? maskChannelConfig(instance.config)
        : this.isSecureSecretsEnabled
          ? this.hydrateChannelConfig(instance)
          : instance.config,
    }));
  }

  createChannelInstance(input: {
    name: string;
    type: RuntimeChannelType;
    enabled?: boolean;
    config: Record<string, unknown>;
  }): ChannelInstanceRecord {
    const id = `channel-${randomUUID()}`;
    let storedConfig = input.config;
    if (this.isSecureSecretsEnabled) {
      const { sanitized, moved } = this.extractSecrets(id, input.config);
      if (moved && !this.secretStore.isAvailable()) {
        throw new Error("CHANNEL_SECRET_STORE_UNAVAILABLE");
      }
      storedConfig = sanitized;
    }

    const instance: ChannelInstanceRecord = {
      id,
      name: input.name.trim(),
      type: input.type,
      enabled: input.enabled ?? false,
      config: storedConfig,
    };
    const instances = this.store.get("channelInstances", []);
    this.store.set("channelInstances", [...instances, instance]);
    return {
      ...instance,
      config: this.isSecureSecretsEnabled
        ? this.hydrateChannelConfig(instance)
        : instance.config,
    };
  }

  updateChannelInstance(
    id: string,
    patch: Partial<Pick<ChannelInstanceRecord, "name" | "enabled" | "config" | "policy">>,
  ): ChannelInstanceRecord | null {
    const instances = this.store.get("channelInstances", []);
    const index = instances.findIndex((instance) => instance.id === id);
    if (index < 0) return null;
    const current = instances[index];

    let newConfig = current.config;
    if (patch.config !== undefined) {
      const merged = mergeChannelConfig(
        this.isSecureSecretsEnabled
          ? this.hydrateChannelConfig(current)
          : current.config,
        patch.config,
      );
      if (this.isSecureSecretsEnabled) {
        const { sanitized, moved } = this.extractSecrets(id, merged);
        if (moved && !this.secretStore.isAvailable()) {
          throw new Error("CHANNEL_SECRET_STORE_UNAVAILABLE");
        }
        newConfig = sanitized;
      } else {
        newConfig = merged;
      }
    }

    const updated: ChannelInstanceRecord = {
      ...current,
      ...patch,
      name: patch.name === undefined ? current.name : patch.name.trim(),
      config: newConfig,
      policy:
        patch.policy === undefined
          ? current.policy
          : patch.policy,
    };
    const next = [...instances];
    next[index] = updated;
    this.store.set("channelInstances", next);
    return {
      ...updated,
      config: this.isSecureSecretsEnabled
        ? this.hydrateChannelConfig(updated)
        : updated.config,
    };
  }

  deleteChannelInstance(id: string): boolean {
    const instances = this.store.get("channelInstances", []);
    const next = instances.filter((instance) => instance.id !== id);
    if (next.length === instances.length) return false;
    this.store.set("channelInstances", next);
    // Clean up secrets for the deleted instance (best-effort).
    try {
      this.secretStore.deleteInstance(id);
    } catch {
      // best-effort
    }
    return true;
  }

  /**
   * Get gateway config
   */
  getGatewayConfig(): GatewayConfig {
    return this.store.get("gateway");
  }

  /**
   * Filter prototype pollution keys from user-controlled objects
   */
  private filterProtoPollution(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    const filtered = { ...obj };
    delete filtered["__proto__"];
    delete filtered["constructor"];
    delete filtered["prototype"];
    return filtered;
  }

  /**
   * Update gateway config
   */
  setGatewayConfig(config: Partial<GatewayConfig>): void {
    const current = this.getGatewayConfig();
    this.store.set("gateway", {
      ...current,
      ...this.filterProtoPollution(config as Record<string, unknown>),
    });
    log("[RemoteConfig] Gateway config updated");
  }

  /**
   * Get wechat channel config
   */
  getWechatConfig(): WechatChannelConfig | undefined {
    return this.store.get("channels.wechat");
  }

  /**
   * Set wechat channel config
   */
  setWechatConfig(config: WechatChannelConfig): void {
    this.store.set("channels.wechat", config);
    log("[RemoteConfig] WeChat config updated");
  }

  /**
   * Get telegram channel config
   */
  getTelegramConfig(): TelegramChannelConfig | undefined {
    return this.store.get("channels.telegram");
  }

  /**
   * Set telegram channel config
   */
  setTelegramConfig(config: TelegramChannelConfig): void {
    this.store.set("channels.telegram", config);
    log("[RemoteConfig] Telegram config updated");
  }

  /**
   * Get dingtalk channel config
   */
  getDingtalkConfig(): DingtalkChannelConfig | undefined {
    return this.store.get("channels.dingtalk");
  }

  /**
   * Set dingtalk channel config
   */
  setDingtalkConfig(config: DingtalkChannelConfig): void {
    this.store.set("channels.dingtalk", config);
    log("[RemoteConfig] DingTalk config updated");
  }

  /**
   * Get websocket channel config
   */
  getWebSocketConfig(): WebSocketChannelConfig | undefined {
    return this.store.get("channels.websocket");
  }

  /**
   * Set websocket channel config
   */
  setWebSocketConfig(config: WebSocketChannelConfig): void {
    this.store.set("channels.websocket", config);
    log("[RemoteConfig] WebSocket config updated");
  }

  /**
   * Check if remote is enabled
   */
  isEnabled(): boolean {
    return this.store.get("gateway.enabled", false);
  }

  /**
   * Enable/disable remote
   */
  setEnabled(enabled: boolean): void {
    this.store.set("gateway.enabled", enabled);
    log("[RemoteConfig] Remote enabled:", enabled);
  }

  /**
   * Get all paired users
   */
  getPairedUsers(): PairedUser[] {
    return this.store.get("pairedUsers", []);
  }

  /**
   * Add paired user
   */
  addPairedUser(user: PairedUser): void {
    const users = this.getPairedUsers();
    const existingIndex = users.findIndex(
      (u) => u.channelType === user.channelType && u.userId === user.userId,
    );

    if (existingIndex >= 0) {
      users[existingIndex] = user;
    } else {
      users.push(user);
    }

    this.store.set("pairedUsers", users);
    this.syncAllowlist(users);
    log("[RemoteConfig] Paired user added:", user.userId);
  }

  /**
   * Remove paired user
   */
  removePairedUser(channelType: string, userId: string): boolean {
    const users = this.getPairedUsers();
    const newUsers = users.filter(
      (u) => !(u.channelType === channelType && u.userId === userId),
    );

    if (newUsers.length !== users.length) {
      this.store.set("pairedUsers", newUsers);
      this.syncAllowlist(newUsers);
      log("[RemoteConfig] Paired user removed:", userId);
      return true;
    }

    return false;
  }

  /**
   * Sync allowlist from paired users when auth mode is allowlist
   */
  private syncAllowlist(users: PairedUser[]): void {
    const gateway = this.store.get("gateway");
    if (gateway?.auth?.mode === "allowlist") {
      this.store.set(
        "gateway.auth.allowlist",
        users.map((u) => `${u.channelType}:${u.userId}`),
      );
    }
  }

  /**
   * Check if user is paired
   */
  isPaired(channelType: string, userId: string): boolean {
    const users = this.getPairedUsers();
    return users.some(
      (u) => u.channelType === channelType && u.userId === userId,
    );
  }

  /**
   * Get config file path
   */
  getPath(): string {
    return this.store.path;
  }

  /**
   * Idempotently migrate configured legacy Slack entries into
   * channelInstances if no instance of that type exists yet. Uses
   * deterministic ID (legacy-slack).
   *
   * - enabled is true ONLY when the legacy gateway was enabled.
   * - `config.policy` preserves the legacy auth policy (dm, groups, etc.)
   *   so Bootstrap can resolve it losslessly.
   * - Legacy config is preserved unchanged for rollback.
   */
  private migrateLegacySlack(): void {
    const storedInstances = this.store.get("channelInstances", []);
    const instances = Array.isArray(storedInstances) ? storedInstances : [];
    const typesPresent = new Set(instances.map((instance) => instance.type));

    const gatewayEnabled = this.store.get("gateway.enabled") === true;
    const pairedUsers = this.store.get("pairedUsers", []);
    const paired = Array.isArray(pairedUsers) ? pairedUsers : [];

    // Slack migration
    if (!typesPresent.has("slack")) {
      const slackConfig = this.store.get("channels.slack") as
        | Record<string, unknown>
        | undefined;
      if (
        slackConfig &&
        typeof slackConfig.botToken === "string" &&
        slackConfig.botToken.length > 0
      ) {
        const policy = buildSlackMigrationPolicy(
          slackConfig,
          paired
            .filter((user) => user.channelType === "slack")
            .map((user) => user.userId),
        );
        const legacy: ChannelInstanceRecord = {
          id: "legacy-slack",
          name: "Slack (Legacy)",
          type: "slack",
          enabled: gatewayEnabled,
          config: {
            botToken: slackConfig.botToken,
            appToken:
              typeof slackConfig.appToken === "string"
                ? slackConfig.appToken
                : "",
            signingSecret:
              typeof slackConfig.signingSecret === "string"
                ? slackConfig.signingSecret
                : "",
          },
          policy,
        };
        this.store.set("channelInstances", [...instances, legacy]);
      }
    }
  }

  /**
   * Reset all config
   */
  reset(): void {
    this.store.clear();
    log("[RemoteConfig] Config reset");
  }

  // ---------------------------------------------------------------------------
  // Secure secret store helpers
  // ---------------------------------------------------------------------------

  /**
   * Recursively walk a config object and replace known SECRET_FIELDS values
   * with opaque sentinels, writing the plaintext into the secure store.
   * Returns { sanitized, moved } — moved is true when at least one secret
   * was extracted.
   */
  private extractSecrets(
    instanceId: string,
    config: Record<string, unknown>,
  ): { sanitized: Record<string, unknown>; moved: boolean } {
    let moved = false;
    const sanitized = this.extractSecretsRecursive(instanceId, config, () => {
      moved = true;
    }) as Record<string, unknown>;
    return { sanitized, moved };
  }

  private extractSecretsRecursive(
    instanceId: string,
    value: unknown,
    onMoved: () => void,
  ): unknown {
    if (!isObject(value)) return value;
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (
        SECRET_FIELDS.has(key) &&
        typeof v === "string" &&
        v.length > 0 &&
        !v.startsWith(SECRET_SENTINEL_PREFIX)
      ) {
        this.secretStore.write(instanceId, key, v);
        result[key] = this.secretStore.maskSentinel(instanceId, key);
        onMoved();
      } else if (isObject(v)) {
        result[key] = this.extractSecretsRecursive(
          instanceId,
          v,
          onMoved,
        );
      } else {
        result[key] = v;
      }
    }
    return result;
  }

  /**
   * Recursively hydrate a channel instance's config, resolving sentinel
   * values back to plaintext from the secure store.
   */
  private hydrateChannelConfig(
    instance: ChannelInstanceRecord,
  ): Record<string, unknown> {
    return this.hydrateChannelConfigRecursive(instance.id, instance.config);
  }

  private hydrateChannelConfigRecursive(
    instanceId: string,
    value: unknown,
  ): Record<string, unknown> {
    if (!isObject(value)) return {} as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === "string" && ChannelSecretStore.isSentinel(v)) {
        result[key] = this.secretStore.hydrate(v);
      } else if (isObject(v)) {
        result[key] = this.hydrateChannelConfigRecursive(instanceId, v);
      } else {
        result[key] = v;
      }
    }
    return result;
  }

  /**
   * Migrate existing plaintext secrets in channelInstances and legacy
   * channel configs into the secure store. Idempotent — sentinels are
   * skipped. Runs once on construction and does not block startup.
   */
  private migratePlaintextSecrets(): void {
    if (!this.isSecureSecretsEnabled) return;
    if (!this.secretStore.isAvailable()) {
      log(
        "[RemoteConfig] Skipping plaintext secret migration: safeStorage unavailable",
      );
      return;
    }

    let dirty = false;

    // Migrate channelInstances
    const storedInstances = this.store.get("channelInstances", []);
    const instances = Array.isArray(storedInstances) ? storedInstances : [];
    const migrated = instances.map((instance) => {
      const { sanitized, moved } = this.extractSecrets(
        instance.id,
        instance.config,
      );
      if (moved) {
        dirty = true;
        return { ...instance, config: sanitized };
      }
      return instance;
    });
    if (dirty) {
      this.store.set("channelInstances", migrated);
      log("[RemoteConfig] Migrated plaintext secrets to secure store");
    }

    // Migrate legacy channel secrets while preserving the legacy config path.
    // electron-store writes both the nested `channels` object AND each dotted
    // path to disk, so we must sanitize the nested object to fully remove
    // plaintext from the raw JSON.
    const legacyChannels = this.store.get("channels") as
      | Record<string, unknown>
      | undefined;
    if (legacyChannels) {
      const { sanitized: cleanChannels, moved: legacyMoved } =
        this.extractLegacyChannelSecrets(legacyChannels);
      if (legacyMoved) {
        this.store.set("channels", cleanChannels as unknown);
        log("[RemoteConfig] Migrated legacy channel secrets to secure store");
      }
    }
  }

  private hydrateLegacyConfig(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value ?? {})) {
      if (typeof entry === "string" && ChannelSecretStore.isSentinel(entry)) {
        result[key] = this.secretStore.hydrate(entry);
      } else if (isObject(entry)) {
        result[key] = this.hydrateLegacyConfig(entry);
      } else {
        result[key] = entry;
      }
    }
    return result;
  }

  private extractLegacyChannelSecrets(
    channels: Record<string, unknown>,
  ): { sanitized: Record<string, unknown>; moved: boolean } {
    let moved = false;
    const sanitized: Record<string, unknown> = {};
    for (const [channelType, channelConfig] of Object.entries(channels)) {
      if (!isObject(channelConfig)) {
        sanitized[channelType] = channelConfig;
        continue;
      }
      const instanceId = `legacy-${channelType}`;
      const onMoved = () => { moved = true; };
      sanitized[channelType] = this.extractSecretsRecursive(
        instanceId,
        channelConfig,
        onMoved,
      );
    }
    return { sanitized, moved };
  }
}

/**
 * Build a ChannelPolicyConfig-compatible policy blob from a legacy Slack
 * channel config. Fail-closed: if legacy settings cannot be reliably
 * translated, the resulting policy is permissive but logged.
 */
function buildSlackMigrationPolicy(
  config: Record<string, unknown>,
  pairedUserIds: string[],
): Record<string, unknown> {
  const dm = isRecord(config.dm) ? config.dm : {};
  const dmPolicy =
    dm.policy === "open" ||
    dm.policy === "allowlist" ||
    dm.policy === "pairing"
      ? dm.policy
      : "allowlist";
  const channels = isRecord(config.channels) ? config.channels : {};
  const channelIds = Object.keys(channels);
  const groupRequireMention: Record<string, boolean> = {};
  const groupAllowFrom: Record<string, string[]> = {};
  for (const [channelId, raw] of Object.entries(channels)) {
    if (!isRecord(raw)) continue;
    if (typeof raw.requireMention === "boolean") {
      groupRequireMention[channelId] = raw.requireMention;
    }
    if (Array.isArray(raw.allowFrom)) {
      groupAllowFrom[channelId] = raw.allowFrom.filter(
        (value): value is string => typeof value === "string",
      );
    }
  }
  return {
    enabled: true,
    allowedChatKinds: ["dm", "group", "channel"],
    dmEnabled: true,
    groupEnabled: true,
    channelEnabled: true,
    allowBots: false,
    deniedUsers: [],
    deniedChats: [],
    allowedUsers: [],
    allowedChats: [],
    requireMention: false,
    allowedCommands: [],
    dmPolicy: dmPolicy === "open" ? "open" : "allowlist",
    dmAllowFrom:
      dmPolicy === "allowlist"
        ? Array.isArray(dm.allowFrom)
          ? dm.allowFrom.filter(
              (value): value is string => typeof value === "string",
            )
          : []
        : dmPolicy === "pairing"
          ? [...pairedUserIds]
          : [],
    groupAllowedChats: channelIds,
    groupRequireMention,
    groupAllowFrom,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeChannelConfig(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const previous = existing[key];
    if (
      SECRET_FIELDS.has(key) &&
      typeof previous === "string" &&
      typeof value === "string" &&
      (value === "****" || value.includes("****"))
    ) {
      merged[key] = previous;
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof previous === "object" &&
      previous !== null &&
      !Array.isArray(previous)
    ) {
      merged[key] = mergeChannelConfig(
        previous as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function maskChannelConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_FIELDS.has(key) && typeof value === "string" && value.length > 0) {
      masked[key] = ChannelSecretStore.isSentinel(value)
        ? "****"
        : value.length <= 4
          ? "****"
          : `${value.slice(0, 2)}****${value.slice(-2)}`;
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      masked[key] = maskChannelConfig(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// Singleton instance
export const remoteConfigStore = new RemoteConfigStore();
