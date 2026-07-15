import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const chatView = fs.readFileSync(
  path.resolve("src/renderer/components/ChatView.tsx"),
  "utf8",
);
const messageCard = fs.readFileSync(
  path.resolve("src/renderer/components/MessageCard.tsx"),
  "utf8",
);

describe("chat video-reference wiring", () => {
  it("extracts references only inside the assistant branch", () => {
    const assistantBranch = chatView.slice(
      chatView.indexOf('if (msg.role === "assistant")'),
      chatView.indexOf("return mergedMessages.map"),
    );
    expect(assistantBranch).toContain("extractVideoReferences");
    expect(assistantBranch).toContain("activeSessionCwd");
    expect(chatView.match(/extractVideoReferences\(/g)).toHaveLength(1);
  });

  it("passes references through MessageCard to ArtifactCard", () => {
    expect(chatView).toContain("videoReferences={videoReferences}");
    expect(messageCard).toContain("videoReferences={videoReferences}");
  });
});
