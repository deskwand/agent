import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  credentialsPath,
  modifyCredentialsLocked,
  readCredentials,
  readCredentialsResult,
  removeCredentials,
  writeCredentials,
} from "../../main/connectors/mcp-signin";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpauth-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const NOTION = "https://mcp.notion.com/mcp";
const LINEAR = "https://mcp.linear.app/mcp";

function seed(): void {
  writeCredentials(dir, {
    [NOTION]: {
      serverUrl: NOTION,
      tokens: { access_token: "a", token_type: "Bearer" },
    },
    [LINEAR]: {
      serverUrl: LINEAR,
      tokens: { access_token: "b", token_type: "Bearer" },
    },
  });
}

describe("readCredentials", () => {
  it("returns an empty record when the file is missing", () => {
    expect(readCredentials(dir)).toEqual({});
  });

  it("returns an empty record for invalid JSON instead of throwing", () => {
    fs.writeFileSync(credentialsPath(dir), "{ broken");
    expect(readCredentials(dir)).toEqual({});
  });

  it("returns an empty record for a non-object top level", () => {
    fs.writeFileSync(credentialsPath(dir), "[1,2]");
    expect(readCredentials(dir)).toEqual({});
  });

  it("round-trips through writeCredentials", () => {
    seed();
    const creds = readCredentials(dir);
    expect(Object.keys(creds).sort()).toEqual([LINEAR, NOTION].sort());
    expect(creds[NOTION].tokens?.access_token).toBe("a");
  });
});

describe("removeCredentials", () => {
  it("removes only the key for the given server URL", async () => {
    seed();
    expect(await removeCredentials(dir, NOTION)).toBe(true);
    expect(Object.keys(readCredentials(dir))).toEqual([LINEAR]);
  });

  it("returns false when the key is absent", async () => {
    seed();
    expect(await removeCredentials(dir, "https://nope/mcp")).toBe(false);
  });

  it("returns false when the file is missing", async () => {
    expect(await removeCredentials(dir, NOTION)).toBe(false);
  });

  it("leaves the remaining file valid JSON", async () => {
    seed();
    removeCredentials(dir, NOTION);
    expect(() =>
      JSON.parse(fs.readFileSync(credentialsPath(dir), "utf8")),
    ).not.toThrow();
  });

  it("keeps the other server's tokens intact", async () => {
    seed();
    await removeCredentials(dir, NOTION);
    expect(readCredentials(dir)[LINEAR].tokens?.access_token).toBe("b");
  });
});

describe("credentialsPath", () => {
  it("points at mcp-auth.json inside the agent dir", () => {
    expect(credentialsPath("/tmp/agent")).toBe(
      path.join("/tmp/agent", "mcp-auth.json"),
    );
  });
});

describe("broken credential file is never clobbered", () => {
  it("flags an unparseable file as unreadable", () => {
    fs.writeFileSync(credentialsPath(dir), "{ broken");
    expect(readCredentialsResult(dir).unreadable).toBe(true);
  });

  it("treats a missing file as readable-but-empty", () => {
    expect(readCredentialsResult(dir)).toEqual({ data: {}, unreadable: false });
  });

  it("removeCredentials refuses to write over an unparseable file", async () => {
    fs.writeFileSync(credentialsPath(dir), "{ broken");
    expect(await removeCredentials(dir, NOTION)).toBe(false);
    // 其他 server 的 token 不会被抹掉 —— 文件原样保留
    expect(fs.readFileSync(credentialsPath(dir), "utf8")).toBe("{ broken");
  });

  it("writes the credential file with owner-only permissions", () => {
    seed();
    const mode = fs.statSync(credentialsPath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("locked credential writes", () => {
  it("serializes concurrent writers so no update is lost", async () => {
    // 这个文件同时被 SDK 的 token 刷新和我们的授权写。
    // 不加锁的话，整文件写回会互相覆盖 —— refresh token 轮换后等于登录失效。
    seed();
    const urls = Array.from({ length: 8 }, (_, i) => `https://s${i}/mcp`);

    await Promise.all(
      urls.map((u) =>
        modifyCredentialsLocked(dir, (data) => {
          data[u] = {
            serverUrl: u,
            tokens: { access_token: u, token_type: "Bearer" },
          };
          return true;
        }),
      ),
    );

    // 全部 8 个都写进去了，且原有的两个没有被覆盖
    const after = readCredentials(dir);
    for (const u of urls) {
      expect(after[u]?.tokens?.access_token).toBe(u);
    }
    expect(after[NOTION]?.tokens?.access_token).toBe("a");
    expect(after[LINEAR]?.tokens?.access_token).toBe("b");
  });

  it("does not write when the callback returns false", async () => {
    seed();
    const changed = await modifyCredentialsLocked(dir, () => false);
    expect(changed).toBe(false);
    expect(Object.keys(readCredentials(dir)).sort()).toEqual(
      [LINEAR, NOTION].sort(),
    );
  });

  it("rejects instead of clobbering an unparseable file", async () => {
    fs.writeFileSync(credentialsPath(dir), "{ broken");
    await expect(modifyCredentialsLocked(dir, () => true)).rejects.toThrow(
      /refusing to overwrite/,
    );
    expect(fs.readFileSync(credentialsPath(dir), "utf8")).toBe("{ broken");
  });

  it("leaves no temp file behind", async () => {
    seed();
    await modifyCredentialsLocked(dir, (data) => {
      data[NOTION] = { serverUrl: NOTION };
      return true;
    });
    expect(fs.existsSync(`${credentialsPath(dir)}.tmp`)).toBe(false);
  });
});
