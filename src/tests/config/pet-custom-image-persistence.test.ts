import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron-store", () => {
  class MockStore<T extends Record<string, unknown>> {
    public path: string;
    public store: T;

    constructor(options: { name?: string; defaults?: T }) {
      const name = options.name || "config";
      const dir =
        state.userDataPath ||
        fs.mkdtempSync(path.join(os.tmpdir(), "cfg-pet-singleton-"));
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
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-pet-"));
  state.userDataPath = userDataPath;
});

afterEach(() => fs.rmSync(userDataPath, { recursive: true, force: true }));

const onDisk = () =>
  JSON.parse(
    fs.readFileSync(path.join(userDataPath, "config.json"), "utf8"),
  ) as Record<string, unknown>;

describe("petCustomImage persistence", () => {
  it("defaults to null", () => {
    expect(new ConfigStore().getAll().petCustomImage).toBeNull();
  });

  it("writes, reads and clears the custom image", () => {
    const store = new ConfigStore();
    store.update({
      petCustomImage: { fileName: "custom-1.png", enabled: true },
    });
    expect(store.getAll().petCustomImage).toEqual({
      fileName: "custom-1.png",
      enabled: true,
    });
    expect(onDisk().petCustomImage).toEqual({
      fileName: "custom-1.png",
      enabled: true,
    });

    store.update({ petCustomImage: null });
    expect(store.getAll().petCustomImage).toBeNull();
    expect(onDisk().petCustomImage).toBeNull();
  });

  it("survives a restart", () => {
    new ConfigStore().update({
      petCustomImage: { fileName: "custom-2.gif", enabled: false },
    });
    expect(new ConfigStore().getAll().petCustomImage).toEqual({
      fileName: "custom-2.gif",
      enabled: false,
    });
  });

  it("drops an unsafe file name instead of writing it", () => {
    const store = new ConfigStore();
    store.update({
      petCustomImage: {
        fileName: "/tmp/escape.png",
        enabled: true,
      },
    });
    expect(store.getAll().petCustomImage).toBeNull();
  });
});
