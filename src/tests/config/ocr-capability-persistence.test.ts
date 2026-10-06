import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 能力开关必须真的落盘。
 *
 * 真事故：`configStore.update()` 是**逐字段显式落地**的（voiceEngine、readAloud…各一个分支），
 * 给 `ocr` 只加了类型与界面、没加分支 → `config.save({ ocr })` 被静默丢弃，
 * 界面上的开关点一下又弹回去，而下载已经在后台跑完了。
 *
 * 这是「行为断言」版：隔壁 voice-wiring.test.ts 用源码字符串守同一类回归，
 * 这里直接跑一次真实的存取往返 —— 漏了 update() 分支或漏了投影都会红。
 */
const state = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron-store", () => {
  class MockStore<T extends Record<string, unknown>> {
    public path: string;
    public store: T;

    constructor(options: { name?: string; defaults?: T }) {
      const name = options.name || "config";
      // config-store.ts 末尾有个模块级单例（`export const configStore`），它在 beforeEach
      // 之前就构造一次，那时 state.userDataPath 还是空串 —— 没有这个兜底，mock 会把
      // config.json 写进仓库根目录。（实测：漏了它，跑完测试仓库根就多一个 config.json）
      const dir =
        state.userDataPath ||
        fs.mkdtempSync(path.join(os.tmpdir(), "cfg-ocr-singleton-"));
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

let userDataPath = "";

beforeEach(() => {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-ocr-"));
  state.userDataPath = userDataPath;
});

afterEach(() => fs.rmSync(userDataPath, { recursive: true, force: true }));

const onDisk = () =>
  JSON.parse(
    fs.readFileSync(path.join(userDataPath, "config.json"), "utf8"),
  ) as Record<string, unknown>;

describe("OCR 能力开关的持久化", () => {
  it("默认关，不是 undefined", () => {
    expect(new ConfigStore().getAll().ocr).toEqual({ enabled: false });
  });

  it("update({ ocr: { enabled: true } }) 写得进、读得回、落得了盘", () => {
    const store = new ConfigStore();
    store.update({ ocr: { enabled: true } });

    expect(store.getAll().ocr).toEqual({ enabled: true });
    expect(onDisk().ocr).toEqual({ enabled: true });
  });

  it("重启后仍然是开的（从磁盘读回来）", () => {
    new ConfigStore().update({ ocr: { enabled: true } });
    expect(new ConfigStore().getAll().ocr).toEqual({ enabled: true });
  });

  it("脏数据回退成关，不抛错", () => {
    const store = new ConfigStore();
    store.update({
      ocr: { enabled: "yes" } as unknown as { enabled: boolean },
    });
    expect(store.getAll().ocr).toEqual({ enabled: false });
  });
});
