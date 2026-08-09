import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthCredentialStore } from "../../main/agent/auth-credential-store";
import type { Credential } from "@earendil-works/pi-ai";

const lockMock = vi.hoisted(() => vi.fn());

vi.mock("proper-lockfile", () => ({
  default: {
    lock: lockMock,
  },
}));

function makeOauthCredential(access: string): Credential {
  return {
    type: "oauth",
    access,
    refresh: "rt.test",
    expires: Date.now() + 3600_000,
    accountId: "test-account",
  } as Credential;
}

describe("AuthJsonCredentialStore", () => {
  let dir: string;
  let authPath: string;
  let releaseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "deskwand-auth-test-"));
    authPath = join(dir, "auth.json");
    releaseMock = vi.fn(async () => undefined);
    lockMock.mockReset();
    lockMock.mockResolvedValue(releaseMock);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("read 不获取文件锁（仅 modify/delete 加锁）", async () => {
    const store = createAuthCredentialStore(authPath);
    await store.modify("openai-codex", async () =>
      makeOauthCredential("tok-1"),
    );

    lockMock.mockClear();
    await store.read("openai-codex");
    await store.list();

    expect(lockMock).not.toHaveBeenCalled();
  });

  it("modify 获取排他锁并在结束后释放", async () => {
    const store = createAuthCredentialStore(authPath);
    await store.modify("openai-codex", async () =>
      makeOauthCredential("tok-1"),
    );
    expect(lockMock).toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
    // 注：这是行为契约（写路径必须持锁），不测 proper-lockfile 自身的串行语义。
  });

  it("read 返回持久化凭证且无副作用（不刷新、不改写文件）", async () => {
    const store = createAuthCredentialStore(authPath);
    await store.modify("openai-codex", async () =>
      makeOauthCredential("tok-1"),
    );
    const before = readFileSync(authPath, "utf-8");

    const credential = await store.read("openai-codex");
    const after = readFileSync(authPath, "utf-8");

    expect((credential as { access?: string }).access).toBe("tok-1");
    expect(after).toBe(before); // read 不得触发刷新写回
  });

  it("modify 写入后文件始终是完整 JSON（原子写），且不残留临时文件", async () => {
    const store = createAuthCredentialStore(authPath);
    await store.modify("openai-codex", async () =>
      makeOauthCredential("tok-1"),
    );

    const raw = readFileSync(authPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).toContain('"openai-codex"');
    expect(existsSync(`${authPath}.tmp`)).toBe(false);
  });

  it("modify 的 fn 返回 undefined 时不改写文件（保留原值）", async () => {
    const store = createAuthCredentialStore(authPath);
    await store.modify("openai-codex", async () =>
      makeOauthCredential("tok-1"),
    );
    const before = readFileSync(authPath, "utf-8");

    // pi-ai resolveStoredOAuth 双检刷新契约：fn 返回 undefined = 并发刷新/登出，不写入
    const result = await store.modify("openai-codex", async () => undefined);
    const after = readFileSync(authPath, "utf-8");

    expect((result as { access?: string }).access).toBe("tok-1");
    expect(after).toBe(before);
  });

  it("modify 的 fn 抛错时仍释放锁", async () => {
    const store = createAuthCredentialStore(authPath);

    await expect(
      store.modify("openai-codex", async () => {
        throw new Error("refresh failed");
      }),
    ).rejects.toThrow("refresh failed");

    expect(releaseMock).toHaveBeenCalledTimes(1);
    // 锁释放后后续写仍可正常进行
    await store.modify("openai-codex", async () =>
      makeOauthCredential("tok-2"),
    );
    expect(
      (
        JSON.parse(readFileSync(authPath, "utf-8")) as Record<
          string,
          { access?: string }
        >
      )["openai-codex"]?.access,
    ).toBe("tok-2");
  });

  it("delete 删除条目并原子写回", async () => {
    const store = createAuthCredentialStore(authPath);
    await store.modify("openai-codex", async () =>
      makeOauthCredential("tok-1"),
    );

    await store.delete("openai-codex");

    const data = JSON.parse(readFileSync(authPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(data["openai-codex"]).toBeUndefined();
    expect(existsSync(`${authPath}.tmp`)).toBe(false);
  });

  it("文件缺失时 read 返回 undefined，损坏 JSON 时返回空对象", async () => {
    const store = createAuthCredentialStore(authPath);
    expect(await store.read("openai-codex")).toBeUndefined();
    expect(await store.list()).toEqual([]);

    writeFileSync(authPath, "{broken json", "utf-8");
    expect(await store.read("openai-codex")).toBeUndefined();
  });
});
