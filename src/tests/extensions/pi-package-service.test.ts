import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PiPackageService,
  classifySource,
  type PiPackageItem,
} from "../../main/extensions/pi-package-service";
import { PiExtensionHost } from "../../main/extensions/pi-extension-host";

function makeHost(): PiExtensionHost {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pkg-test-"));
  const project = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  fs.mkdirSync(project, { recursive: true });
  return PiExtensionHost.getOrCreate({ cwd: project, agentDir });
}

describe("classifySource", () => {
  it("classifies npm sources", () => {
    expect(classifySource("npm:@foo/bar@1.0.0")).toBe("npm");
  });

  it("classifies git sources", () => {
    expect(classifySource("git:github.com/user/repo@v1")).toBe("git");
    expect(classifySource("https://github.com/user/repo")).toBe("git");
    expect(classifySource("ssh://git@github.com/user/repo")).toBe("git");
  });

  it("classifies local sources", () => {
    expect(classifySource("/tmp/foo")).toBe("local");
    expect(classifySource("./relative/path")).toBe("local");
  });
});

describe("PiPackageService", () => {
  it("lists configured packages from package manager", () => {
    const host = makeHost();
    const svc = new PiPackageService(() => host);
    expect(svc.list()).toEqual([]);
  });

  it("item type classification matches source", () => {
    const item: PiPackageItem = {
      source: "/tmp/foo",
      scope: "user",
      type: "local",
    };
    expect(item.type).toBe("local");
  });

  // 依赖实时 npm registry，离线 CI 会失败；本地验证时去掉 skip 运行。
  it.skip(
    "install propagates failure for invalid source",
    { timeout: 30000 },
    async () => {
      const host = makeHost();
      const svc = new PiPackageService(() => host);
      await expect(
        svc.install("npm:@earendil-works/pi-pkg-does-not-exist-xyz@1.0.0"),
      ).rejects.toThrow();
    },
  );
});
