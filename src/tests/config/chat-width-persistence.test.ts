import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「消息区宽度」必须真的落盘。
 *
 * 与 ocr / capabilityIntro 同一个理由：`configStore.update()` 是**逐字段显式落地**的，
 * 只加类型与界面、没加分支 → `settings.update` 会被静默丢弃，用户选了「窄」，
 * 下次启动又变回标准。
 */
const state = vi.hoisted(() => ({
  userDataPath: "",
  tempDirs: [] as string[],
}));

vi.mock("electron-store", () => {
  class MockStore<T extends Record<string, unknown>> {
    public path: string;
    public store: T;

    constructor(options: { name?: string; defaults?: T }) {
      const name = options.name || "config";
      // config-store.ts 末尾有个模块级单例，它在 beforeEach 之前就构造一次，
      // 那时 state.userDataPath 还是空串 —— 没有这个兜底，mock 会把 config.json
      // 写进仓库根目录。
      const dir =
        state.userDataPath ||
        (() => {
          const leaked = fs.mkdtempSync(
            path.join(os.tmpdir(), "cfg-chatwidth-singleton-"),
          );
          state.tempDirs.push(leaked);
          return leaked;
        })();
      this.path = path.join(dir, `${name}.json`);
      if (fs.existsSync(this.path)) {
        this.store = {
          ...(options.defaults || ({} as T)),
          ...(JSON.parse(fs.readFileSync(this.path, "utf8")) as T),
        };
        return;
      }
      this.store = { ...(options.defaults || ({} as T)) };
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fs.writeFileSync(this.path, JSON.stringify(this.store, null, 2));
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === "string") {
        this.store = { ...this.store, [key]: value };
      } else {
        this.store = { ...this.store, ...(key as T) };
      }
      fs.writeFileSync(this.path, JSON.stringify(this.store, null, 2));
    }

    has() {
      return true;
    }
  }
  return { default: MockStore };
});

import { ConfigStore } from "../../main/config/config-store";
import type { AppConfig } from "../../main/config/config-store";

let userDataPath = "";

beforeEach(() => {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-chatwidth-"));
  state.userDataPath = userDataPath;
});

afterEach(() => {
  fs.rmSync(userDataPath, { recursive: true, force: true });
  // 模块级单例在导入时就建了临时目录，不在这儿清就是每跑一次漏一个 /tmp 残留。
  for (const dir of state.tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  state.tempDirs.length = 0;
});

const onDisk = () =>
  JSON.parse(
    fs.readFileSync(path.join(userDataPath, "config.json"), "utf8"),
  ) as Record<string, unknown>;

describe("chatWidth 落盘", () => {
  // 守卫（不是判别用例）：投影那层的 normalizeChatWidth 也会把它落成 standard，
  // 所以即便从 defaultStoredConfig 里删掉这个字段，这条仍然绿。
  // 「默认值只在一处定义」由 chat-width-wiring.test.ts 的接线断言钉住。
  it("全新安装默认是标准档", () => {
    expect(new ConfigStore().getAll().chatWidth).toBe("standard");
  });

  it("update({ chatWidth }) 读得回、落得了盘、重启后还在", () => {
    const store = new ConfigStore();
    store.update({ chatWidth: "narrow" });

    expect(store.getAll().chatWidth).toBe("narrow");
    expect(onDisk().chatWidth).toBe("narrow");
    expect(new ConfigStore().getAll().chatWidth).toBe("narrow");
  });

  it("非法值不写回：保持原值，而不是重置成默认", () => {
    const store = new ConfigStore();
    store.update({ chatWidth: "wide" });
    // 手改坏的字段（这里绕过类型直接塞脏值）
    store.update({ chatWidth: "huge" } as unknown as Partial<AppConfig>);
    expect(store.getAll().chatWidth).toBe("wide");
  });

  it("磁盘里是脏值时读路径回落标准档，不抛错", () => {
    // 先建实例把文件落下来，再覆写，再用**新实例**读 —— 复用旧实例会读到内存态，
    // 断言会假绿。
    new ConfigStore();
    fs.writeFileSync(
      path.join(userDataPath, "config.json"),
      JSON.stringify({ ...onDisk(), chatWidth: 42 }, null, 2),
    );
    expect(new ConfigStore().getAll().chatWidth).toBe("standard");
  });
});
