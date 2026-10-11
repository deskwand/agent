import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「首屏能力清单看过没有」这个标记必须真的落盘。
 *
 * 与 ocr 那份同一个理由：`configStore.update()` 是**逐字段显式落地**的，
 * 给 `capabilityIntro` 只加类型与界面、没加分支 → `config.save({ capabilityIntro })`
 * 会被静默丢弃，用户「跳过」之后下次进首屏那块又冒出来。
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
      // config.json 写进仓库根目录。
      const dir =
        state.userDataPath ||
        fs.mkdtempSync(path.join(os.tmpdir(), "cfg-capintro-singleton-"));
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

import {
  ConfigStore,
  normalizeCapabilityIntro,
} from "../../main/config/config-store";

let userDataPath = "";

beforeEach(() => {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-capintro-"));
  state.userDataPath = userDataPath;
});

afterEach(() => fs.rmSync(userDataPath, { recursive: true, force: true }));

const onDisk = () =>
  JSON.parse(
    fs.readFileSync(path.join(userDataPath, "config.json"), "utf8"),
  ) as Record<string, unknown>;

describe("capabilityIntro 的一次性标记", () => {
  it("默认是空对象，不是 undefined", () => {
    expect(new ConfigStore().getAll().capabilityIntro).toEqual({});
  });

  it("update({ capabilityIntro: { dismissedAt } }) 写得进、读得回、落得了盘", () => {
    const store = new ConfigStore();
    store.update({ capabilityIntro: { dismissedAt: 1728451200000 } });

    expect(store.getAll().capabilityIntro).toEqual({
      dismissedAt: 1728451200000,
    });
    expect(onDisk().capabilityIntro).toEqual({ dismissedAt: 1728451200000 });
  });

  it("重启后仍然是看过的（从磁盘读回来）", () => {
    new ConfigStore().update({
      capabilityIntro: { dismissedAt: 1728451200000 },
    });
    expect(new ConfigStore().getAll().capabilityIntro).toEqual({
      dismissedAt: 1728451200000,
    });
  });

  it("脏数据回退成「没看过」，不抛错", () => {
    const store = new ConfigStore();
    store.update({
      capabilityIntro: { dismissedAt: "yes" } as unknown as {
        dismissedAt: number;
      },
    });
    expect(store.getAll().capabilityIntro).toEqual({});
  });

  it("normalize 只认有限数字", () => {
    expect(normalizeCapabilityIntro(undefined)).toEqual({});
    expect(normalizeCapabilityIntro({ dismissedAt: NaN })).toEqual({});
    expect(normalizeCapabilityIntro({ dismissedAt: 0 })).toEqual({
      dismissedAt: 0,
    });
  });
});
