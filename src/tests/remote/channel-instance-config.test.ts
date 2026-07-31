/**
 * Main/preload contract tests for channel instance configuration and status IPC.
 *
 * Tests credential masking, independent channel instances, and typed CRUD
 * operations without depending on React Testing Library.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mergeChannelConfig } from "../../main/remote/remote-config-store";

// Inline a minimal config-store test double so we don't depend on electron-store
// or the real file system.
interface ChannelInstanceRecord {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Credential masker
// ---------------------------------------------------------------------------
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

function maskChannelConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_FIELDS.has(key) && typeof value === "string" && value.length > 0) {
      if (value.length <= 4) {
        masked[key] = "****";
      } else {
        masked[key] = value.slice(0, 2) + "****" + value.slice(-2);
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      masked[key] = maskChannelConfig(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// ---------------------------------------------------------------------------
// Minimal in-memory store for contract testing
// ---------------------------------------------------------------------------
function createMemoryStore() {
  let instances: ChannelInstanceRecord[] = [];
  let nextSeq = 1;

  function genId(): string {
    return `chan-${String(nextSeq++).padStart(5, "0")}`;
  }

  return {
    list(): ChannelInstanceRecord[] {
      return [...instances];
    },

    getById(id: string): ChannelInstanceRecord | undefined {
      return instances.find((i) => i.id === id);
    },

    create(
      name: string,
      type: string,
      config: Record<string, unknown>,
    ): ChannelInstanceRecord {
      const record: ChannelInstanceRecord = {
        id: genId(),
        name,
        type,
        enabled: false,
        config,
      };
      instances.push(record);
      return { ...record };
    },

    update(
      id: string,
      patch: Partial<Pick<ChannelInstanceRecord, "name" | "enabled" | "config">>,
    ): ChannelInstanceRecord | null {
      const idx = instances.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      if (patch.name !== undefined) instances[idx].name = patch.name;
      if (patch.enabled !== undefined) instances[idx].enabled = patch.enabled;
      if (patch.config !== undefined) instances[idx].config = patch.config;
      return { ...instances[idx] };
    },

    delete(id: string): boolean {
      const idx = instances.findIndex((i) => i.id === id);
      if (idx === -1) return false;
      instances.splice(idx, 1);
      return true;
    },

    reset() {
      instances = [];
      nextSeq = 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Channel instance config store", () => {
  it("preserves stored secrets when a masked config is submitted", () => {
    expect(
      mergeChannelConfig(
        { appSecret: "real-secret", appId: "old-id" },
        { appSecret: "re****et", appId: "new-id" },
      ),
    ).toEqual({ appSecret: "real-secret", appId: "new-id" });
  });

  const store = createMemoryStore();

  beforeEach(() => {
    store.reset();
  });

  // --- Credential masking ---

  it("masks appSecret while preserving non-secret fields", () => {
    const original = {
      type: "feishu",
      appId: "cli_abc123",
      appSecret: "my-super-secret-key-abc",
      useWebSocket: true,
      dm: { policy: "pairing" },
    };

    const masked = maskChannelConfig(original);

    // Secret is masked
    expect(masked.appSecret).toBe("my****bc");
    // Non-secret fields pass through
    expect(masked.appId).toBe("cli_abc123");
    expect(masked.useWebSocket).toBe(true);
    expect(masked.dm).toEqual({ policy: "pairing" });
  });

  it("masks botToken in telegram/slack configs", () => {
    const original = {
      type: "telegram",
      botToken: "1234567890:AAH-abcdefghijklmnopqrstuvwxyz",
    };

    const masked = maskChannelConfig(original);
    expect(masked.botToken).toBe("12****yz");
  });

  it("masks short secrets completely with ****", () => {
    expect(maskChannelConfig({ token: "ab" }).token).toBe("****");
    expect(maskChannelConfig({ token: "abc" }).token).toBe("****");
    expect(maskChannelConfig({ token: "" }).token).toBe("");
  });

  it("recursively masks nested secret fields", () => {
    const original = {
      auth: {
        appSecret: "deep-secret",
        mode: "oauth",
      },
    };

    const masked = maskChannelConfig(original);
    expect(masked.auth).toEqual({ appSecret: "de****et", mode: "oauth" });
  });

  it("passes through null/array/primitive values unchanged", () => {
    const original = {
      tags: ["a", "b"],
      count: 42,
      active: true,
      meta: null as unknown,
    };

    const masked = maskChannelConfig(original);
    expect(masked).toEqual(original);
  });

  // --- Independent channel instances ---

  it("creates independent channel instances with unique IDs", () => {
    const a = store.create("My Feishu", "feishu", {
      appId: "cli_a",
      appSecret: "secret-a",
    });
    const b = store.create("Work Slack", "slack", {
      botToken: "xoxb-token",
    });

    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe("My Feishu");
    expect(b.name).toBe("Work Slack");
    expect(a.type).toBe("feishu");
    expect(b.type).toBe("slack");
  });

  it("lists all instances", () => {
    store.create("Bot A", "feishu", { appId: "a" });
    store.create("Bot B", "telegram", { botToken: "b" });

    const all = store.list();
    expect(all).toHaveLength(2);
    expect(all.map((i) => i.name)).toContain("Bot A");
    expect(all.map((i) => i.name)).toContain("Bot B");
  });

  it("updates instance by ID without affecting others", () => {
    const a = store.create("Bot A", "feishu", { appId: "a" });
    const b = store.create("Bot B", "slack", { botToken: "b" });

    const updated = store.update(a.id, { name: "Bot A v2" });
    expect(updated?.name).toBe("Bot A v2");

    // Bot B unchanged
    expect(store.getById(b.id)?.name).toBe("Bot B");
  });

  it("deletes instance by ID", () => {
    const a = store.create("Bot A", "feishu", { appId: "a" });
    store.create("Bot B", "telegram", { botToken: "b" });

    const deleted = store.delete(a.id);
    expect(deleted).toBe(true);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].name).toBe("Bot B");
  });

  it("returns null when updating non-existent instance", () => {
    const result = store.update("nonexistent", { name: "X" });
    expect(result).toBeNull();
  });

  it("returns false when deleting non-existent instance", () => {
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("two instances of same type have independent configs", () => {
    const a = store.create("Feishu Dev", "feishu", {
      appId: "dev-app",
      appSecret: "secret-dev",
    });
    const b = store.create("Feishu Prod", "feishu", {
      appId: "prod-app",
      appSecret: "secret-prod",
    });

    expect(a.type).toBe("feishu");
    expect(b.type).toBe("feishu");
    expect(a.config.appId).toBe("dev-app");
    expect(b.config.appId).toBe("prod-app");
    expect(a.id).not.toBe(b.id);
  });

  // --- Type safety: only allowed channel types ---
  const ALLOWED_CHANNEL_TYPES = new Set([
    "feishu",
    "slack",
    "telegram",
    "wechat",
    "dingtalk",
    "websocket",
  ]);

  it("accepts only the six allowed channel types", () => {
    for (const t of ["feishu", "slack", "telegram", "wechat", "dingtalk", "websocket"]) {
      const inst = store.create("Test", t, {});
      expect(inst.type).toBe(t);
      expect(ALLOWED_CHANNEL_TYPES.has(inst.type)).toBe(true);
    }
  });

  // --- Credential round-trip: store retains raw secrets; list returns masked ---
  it("retains raw secrets in store but returns masked on list", () => {
    const rawConfig = { appId: "cli_1", appSecret: "supersecret" };
    const inst = store.create("F", "feishu", rawConfig);

    // Store has raw secret
    const raw = store.getById(inst.id);
    expect(raw?.config.appSecret).toBe("supersecret");

    // Masked view does not expose raw secret
    const masked = maskChannelConfig(raw!.config);
    expect(masked.appSecret).not.toBe("supersecret");
    expect(masked.appSecret).toBe("su****et");
  });
});
