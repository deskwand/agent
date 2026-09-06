import { describe, expect, it } from "vitest";
import { useAppStore } from "../src/renderer/store";

describe("top-level navigation", () => {
  it("keeps top-level views mutually exclusive", () => {
    const store = useAppStore.getState();

    store.setActiveView("apps");
    expect(useAppStore.getState().activeView).toBe("apps");

    store.setActiveView("vault");
    expect(useAppStore.getState().activeView).toBe("vault");

    store.setActiveView("settings");
    expect(useAppStore.getState().activeView).toBe("settings");

    store.setActiveView("chat");
    expect(useAppStore.getState().activeView).toBe("chat");
  });
});
