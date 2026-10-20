import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { FileKnownHosts } from "../../main/sandbox/ssh-known-hosts";

describe("FileKnownHosts", () => {
  it("首次 unknown → trust 之后 trusted", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kh-")), "known-hosts.json");
    const store = new FileKnownHosts(file);
    expect(store.check("h", 22, "SHA256:x")).toBe("unknown");
    store.trust("h", 22, "SHA256:x");
    expect(store.check("h", 22, "SHA256:x")).toBe("trusted");
  });

  it("指纹变化返回 mismatch", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kh-")), "known-hosts.json");
    const store = new FileKnownHosts(file);
    store.trust("h", 22, "SHA256:x");
    expect(store.check("h", 22, "SHA256:y")).toBe("mismatch");
  });

  it("按 host:port 建索引，不同端口互不影响", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kh-")), "known-hosts.json");
    const store = new FileKnownHosts(file);
    store.trust("h", 22, "SHA256:x");
    expect(store.check("h", 2222, "SHA256:x")).toBe("unknown");
    expect(JSON.parse(readFileSync(file, "utf8"))["h:22"].fingerprint).toBe(
      "SHA256:x",
    );
  });
});
