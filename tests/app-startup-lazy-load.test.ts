import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appPath = path.resolve(process.cwd(), "src/renderer/App.tsx");
const paneViewPath = path.resolve(
  process.cwd(),
  "src/renderer/components/split/PaneView.tsx",
);

describe("App startup lazy loading", () => {
  it("defers non-welcome panels behind lazy imports", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).not.toContain(
      "import { ChatView } from './components/ChatView';",
    );
    expect(source).not.toContain(
      "import { ConfigModal } from './components/ConfigModal';",
    );
    expect(source).not.toContain(
      "import { SettingsPanel } from './components/SettingsPanel';",
    );

    // 分屏后 ChatView 由 PaneView 懒加载，App 本身不应再静态引入它。
    expect(fs.readFileSync(paneViewPath, "utf8")).toContain(
      "const ChatView = lazy(() =>",
    );
    expect(source).toContain("const ConfigModal = lazy(() =>");
    expect(source).toContain("const SettingsPanel = lazy(() =>");
  });

  it("uses suspense boundaries for deferred panels", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toContain("<Suspense fallback=");
  });
});
