import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const historyPath = path.resolve(
  process.cwd(),
  "src/renderer/components/TopUpHistory.tsx",
);
const modalPath = path.resolve(
  process.cwd(),
  "src/renderer/components/TopUpModal.tsx",
);

describe("TopUpHistory component", () => {
  it("renders empty/load-more/status/view-tx states via i18n", () => {
    const source = fs.readFileSync(historyPath, "utf8");
    expect(source).toContain("topUp.historyEmpty");
    expect(source).toContain("topUp.historyLoadMore");
    expect(source).toContain("topUp.statusPending");
    expect(source).toContain("topUp.statusConfirmed");
    expect(source).toContain("topUp.statusExpired");
    expect(source).toContain("topUp.viewTx");
  });

  it("uses getTopUpOrders and explorerTxUrl", () => {
    const source = fs.readFileSync(historyPath, "utf8");
    expect(source).toContain("getTopUpOrders");
    expect(source).toContain("explorerTxUrl");
  });

  it("opens tx hash externally via electronAPI", () => {
    const source = fs.readFileSync(historyPath, "utf8");
    expect(source).toContain("openExternal");
  });
});

describe("TopUpModal history tab", () => {
  it("renders the topup/history tab bar and mounts TopUpHistory", () => {
    const source = fs.readFileSync(modalPath, "utf8");
    expect(source).toContain("topUp.topupTab");
    expect(source).toContain("topUp.historyTab");
    expect(source).toContain("<TopUpHistory");
    expect(source).toContain('tab === "history"');
  });
});
