import { describe, expect, it } from "vitest";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";
import {
  BUILTIN_PRESETS,
  buildBuiltinEntries,
} from "../../main/connectors/sources/mcp-builtin-source";
import type { ConnectorStatus } from "../../shared/connectors";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

function ctx(
  servers: McpServerEntry[],
  statusFor: (n: string) => ConnectorStatus | undefined = () => undefined,
) {
  return {
    loaded: { servers, errors: [] },
    statusFor,
    hasCredentials: () => false,
  };
}

const CHROME: McpServerEntry = {
  name: "GUI_Operate",
  config: { type: "stdio", command: "npx" },
  source: "test",
  scope: "global",
};

describe("BUILTIN_PRESETS", () => {
  it("has exactly one entry", () => {
    expect(BUILTIN_PRESETS).toHaveLength(1);
  });

  it("names are frozen — changing them breaks prompt cache", () => {
    const names = BUILTIN_PRESETS.map((p) => p.name).sort();
    expect(names).toEqual(["GUI_Operate"]);
  });
});

describe("buildBuiltinEntries", () => {
  it("produces one entry for the single preset", () => {
    expect(buildBuiltinEntries(ctx([]))).toHaveLength(1);
  });

  it("every entry uses transport=stdio and source=mcp-builtin", () => {
    for (const e of buildBuiltinEntries(ctx([]))) {
      expect(e.transport).toBe("stdio");
      expect(e.source).toBe("mcp-builtin");
    }
  });

  it("a preset absent from mcp.json has empty instances", () => {
    const chrome = buildBuiltinEntries(ctx([])).find(
      (e) => e.key === "mcp:builtin:GUI_Operate",
    )!;
    expect(chrome.instances).toEqual([]);
  });

  it("a present preset gets one instance with the adapter status", () => {
    const chrome = buildBuiltinEntries(
      ctx([CHROME], (n) =>
        n === "GUI_Operate" ? { kind: "ready" } : undefined,
      ),
    ).find((e) => e.key === "mcp:builtin:GUI_Operate")!;
    expect(chrome.instances).toHaveLength(1);
    expect(chrome.instances[0].status).toEqual({ kind: "ready" });
  });

  it("enabled:false wins over the adapter state (shows as off)", () => {
    const disabled: McpServerEntry = {
      ...CHROME,
      config: { ...CHROME.config, enabled: false },
    };
    const chrome = buildBuiltinEntries(
      ctx([disabled], () => ({ kind: "ready" })),
    ).find((e) => e.key === "mcp:builtin:GUI_Operate")!;
    expect(chrome.instances[0].status).toEqual({ kind: "off" });
  });

  it("does not claim progress when present but the adapter has no state", () => {
    const chrome = buildBuiltinEntries(ctx([CHROME])).find(
      (e) => e.key === "mcp:builtin:GUI_Operate",
    )!;
    expect(chrome.instances[0].status).toEqual({ kind: "idle" });
  });
});

/** 按 "a.b.c" 取嵌套 JSON 的叶子值；路径不存在返回 undefined。 */
function lookup(table: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, segment) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[segment];
  }, table);
}

describe("BUILTIN_PRESETS i18n keys", () => {
  // 与 connectors-e2e.test.ts:317 的文本扫描有重叠 —— 那条正则扫源码里的
  // "connectors.*" 字面量，能挡住 source→locale 方向的改一半。这里往前一步：
  // 从 **buildBuiltinEntries 的产物**（卡片真正渲染的那个对象）取 key，
  // 断言解析结果非空 —— 文本扫描既看不见动态拼出来的 key，也放行空串。
  it("每个预设的 nameKey / descriptionKey 在 zh 与 en 下都解析成非空文案", () => {
    for (const [locale, table] of Object.entries({ zh, en })) {
      for (const entry of buildBuiltinEntries(ctx([]))) {
        // descriptionKey 在 ConnectorEntry 上是可选的 —— 缺失时取空串，
        // 让下面的非空断言直接失败，而不是被静默跳过。
        for (const key of [entry.nameKey, entry.descriptionKey ?? ""]) {
          const value = lookup(table, key);
          expect(typeof value, `${locale} 缺少 ${key}`).toBe("string");
          expect(value, `${locale} 的 ${key} 是空串`).not.toBe("");
        }
      }
    }
  });

  // 组件测试把 t() mock 成恒等函数（渲染的是 key 而不是文案），locale-parity 只比
  // 键集，connectors-e2e 只断言 typeof string —— 所以「卡片实际显示 Computer Use」
  // 只有这条验证。别当冗余删掉。
  // 描述文案故意不 golden 钉住：改文案是有意为之的话不该被测试拦下（权衡见 spec）。
  it("这个能力在 zh 与 en 下都叫 Computer Use", () => {
    for (const table of [zh, en]) {
      for (const entry of buildBuiltinEntries(ctx([]))) {
        expect(lookup(table, entry.nameKey)).toBe("Computer Use");
      }
    }
  });
});
