import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureAppKey } from "../../main/sandbox/ssh-app-key";
import {
  buildAuthorizedKeysCommand,
  shQuote,
} from "../../main/sandbox/ssh-bootstrap";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("ensureAppKey", () => {
  it("生成一次，第二次复用同一把密钥", () => {
    const dir = mkdtempSync(join(tmpdir(), "deskwand-ssh-"));
    dirs.push(dir);
    const first = ensureAppKey(dir);
    const second = ensureAppKey(dir);
    expect(first.publicKey).toBe(second.publicKey);
    expect(first.publicKey.startsWith("ssh-rsa AAAA")).toBe(true);
    expect(first.publicKey.endsWith(" deskwand")).toBe(true);
    expect(statSync(first.privateKeyPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(first.privateKeyPath, "utf8")).toContain(
      "BEGIN RSA PRIVATE KEY",
    );
  });
});

describe("shQuote", () => {
  it("把单引号转义成 '\\''", () => {
    expect(shQuote("it's")).toBe("'it'\\''s'");
  });

  it("保留空格与 $", () => {
    expect(shQuote("a b$c")).toBe("'a b$c'");
  });
});

describe("buildAuthorizedKeysCommand", () => {
  const key = "ssh-rsa AAAA test@deskwand";

  it("幂等：已有该行就不重复追加", () => {
    const cmd = buildAuthorizedKeysCommand(key);
    expect(cmd).toContain(`grep -qxF ${shQuote(key)} ~/.ssh/authorized_keys`);
    expect(cmd).toContain(`>> ~/.ssh/authorized_keys`);
  });

  it("先建目录并收紧权限", () => {
    const cmd = buildAuthorizedKeysCommand(key);
    expect(cmd).toContain("mkdir -p ~/.ssh && chmod 700 ~/.ssh");
    expect(cmd).toContain(
      "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys",
    );
    expect(cmd.startsWith("umask 077")).toBe(true);
  });

  it("追加失败不会因短路而被跳过", () => {
    const cmd = buildAuthorizedKeysCommand(key);
    expect(cmd).toContain("(grep -qxF");
    expect(cmd).toContain(")");
  });
});
