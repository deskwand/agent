import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 连接页取代了原来的「应用」视图：四个 tab（连接 / 本机能力 / 技能云 / 插件）
 * 现在由 `ConnectorsView` 承担，`AppsView` 只剩页面外壳与登录后的团队信息预取。
 *
 * 这些是源码文本断言（不是渲染测试），因为要守的是「谁拥有 tab」这个结构契约。
 */
const appsViewContent = readFileSync(
  path.resolve(process.cwd(), "src/renderer/components/AppsView.tsx"),
  "utf8",
);
const connectorsViewContent = readFileSync(
  path.resolve(
    process.cwd(),
    "src/renderer/components/connectors/ConnectorsView.tsx",
  ),
  "utf8",
);

describe("AppsView shell", () => {
  it("delegates to ConnectorsView", () => {
    expect(appsViewContent).toContain("<ConnectorsView />");
  });

  it("still fetches the team on login", () => {
    expect(appsViewContent).toContain("getTeams");
    expect(appsViewContent).toContain("setActiveTeamId");
  });
});

describe("ConnectorsView tabs", () => {
  it("defaults to the connect tab", () => {
    expect(connectorsViewContent).toContain('useState<TabId>("connect")');
  });

  it("renders all four tabs", () => {
    for (const key of [
      "connectors.tab.connect",
      "connectors.tab.capability",
      "connectors.tab.skills",
      "connectors.tab.plugins",
    ]) {
      expect(connectorsViewContent).toContain(key);
    }
  });

  it("reuses the existing skills and plugins views", () => {
    expect(connectorsViewContent).toContain("<SettingsSkills isActive={true} />");
    expect(connectorsViewContent).toContain("<PiExtensionManagerView />");
  });

  it("has no per-tab count badge (D12: the number has no stable meaning)", () => {
    expect(connectorsViewContent).not.toContain('className="count"');
  });

  it("does not group entries by connection state (D12: flat + filter)", () => {
    expect(connectorsViewContent).not.toContain("group.connected");
    expect(connectorsViewContent).not.toContain("group.available");
    expect(connectorsViewContent).toContain('filter === "added"');
  });
});
