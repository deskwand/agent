import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const zh = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "src/renderer/i18n/locales/zh.json"),
    "utf8",
  ),
);
const en = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "src/renderer/i18n/locales/en.json"),
    "utf8",
  ),
);

// 会话分叉功能引用的全部 i18n 键（ChatView.tsx / useIPC.ts / MessageCard.tsx）。
// 之前合并把 chat.forkSuffix / chat.forkFailed 从 locale 里冲掉，导致
// 分叉会话标题显示成字面量 "你好chat.forkSuffix"。这里锁死键的存在性。
const FORK_KEYS = [
  "chat.forkSuffix",
  "chat.forkFailed",
  "messageCard.forkMessage",
] as const;

function get(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>(
    (acc, k) =>
      acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined,
    obj,
  );
}

describe("session fork i18n keys", () => {
  it("zh 和 en 都定义了每个 fork 键且文案非空", () => {
    for (const key of FORK_KEYS) {
      const zhValue = get(zh, key);
      const enValue = get(en, key);
      expect(zhValue, `${key} missing in zh.json`).toBeTypeOf("string");
      expect(enValue, `${key} missing in en.json`).toBeTypeOf("string");
      expect((zhValue as string).trim().length, `${key} empty in zh.json`).toBeGreaterThan(0);
      expect((enValue as string).trim().length, `${key} empty in en.json`).toBeGreaterThan(0);
    }
  });
});
