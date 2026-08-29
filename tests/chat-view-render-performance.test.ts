import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const chatViewPath = path.resolve(
  process.cwd(),
  "src/renderer/components/ChatView.tsx",
);
const globalsCssPath = path.resolve(
  process.cwd(),
  "src/renderer/styles/globals.css",
);

function readChatView(): string {
  return fs.readFileSync(chatViewPath, "utf8");
}

describe("ChatView MessageCard memoization (stable empty-array props)", () => {
  it("declares shared empty-array constants for artifact/video props", () => {
    const source = readChatView();
    expect(source).toContain(
      "const EMPTY_RESULT_FILES: ResultFileEntry[] = [];",
    );
    expect(source).toContain(
      "const EMPTY_VIDEO_REFERENCES: VideoReference[] = [];",
    );
  });

  it("visibleTurnEntries falls back to the stable constants, never fresh [] literals", () => {
    const source = readChatView();
    expect(source).toContain(
      "artifactFiles: turnArtifactFiles.get(msgId) ?? EMPTY_RESULT_FILES",
    );
    expect(source).toContain(
      "turnVideoReferences.get(msgId) ?? EMPTY_VIDEO_REFERENCES",
    );
    // A fresh `[]` literal here would allocate a new array on every
    // recompute, defeating React.memo's shallow compare and re-rendering
    // every historical MessageCard on each streaming tick / prepend.
    expect(source).not.toMatch(
      /artifactFiles:\s*turnArtifactFiles\.get\(msgId\)\s*\?\?\s*\[\]/,
    );
    expect(source).not.toMatch(
      /turnVideoReferences\.get\(msgId\)\s*\?\?\s*\[\]/,
    );
  });
});

describe("ChatView scroll container (no mask re-rasterization)", () => {
  it("does not apply a mask class to the scroll container", () => {
    // A mask-image on the scrollable container forces Chromium to
    // re-rasterize the mask layer on every scroll frame, defeating the
    // compositor fast path and causing janky history scroll.
    expect(readChatView()).not.toContain("eff-scroll-fade");
  });

  it("globals.css no longer defines the .eff-scroll-fade mask", () => {
    const css = fs.readFileSync(globalsCssPath, "utf8");
    // Re-introducing the rule would re-enable the per-frame re-rasterization.
    expect(css).not.toMatch(/\.eff-scroll-fade\s*\{/);
  });
});
