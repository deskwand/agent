import { describe, expect, it, vi } from "vitest";
import type { PetCustomImageConfig } from "../../shared/pet-appearance";
import { createPetImageActions } from "../../main/desktop-pet/pet-image-actions";
import { PetImageError } from "../../main/desktop-pet/pet-image";

function setup({
  previous = null as PetCustomImageConfig | null,
  choose = async () => ({ fileName: "custom-2.png" }),
  setThrows = false,
} = {}) {
  const calls: string[] = [];
  let current = previous;
  const store = {
    choose: vi.fn(choose),
    remove: vi.fn(async (fileName: string) => {
      calls.push(`remove:${fileName}`);
    }),
  };
  const actions = createPetImageActions({
    store,
    getCustomImage: () => current,
    setCustomImage: (value) => {
      if (setThrows) throw new Error("disk full");
      current = value;
      calls.push(`set:${value ? value.fileName : "null"}`);
    },
    refreshAppearance: () => {
      calls.push("refresh");
    },
    showError: (code) => {
      calls.push(`error:${code}`);
    },
    logError: () => {
      calls.push("log");
    },
  });
  return { actions, calls, store, current: () => current };
}

describe("createPetImageActions", () => {
  it("writes config, refreshes, then removes the previous file", async () => {
    const { actions, calls, current } = setup({
      previous: { fileName: "custom-1.png", enabled: true },
    });
    await actions.choose("/tmp/cat.png");
    expect(calls).toEqual([
      "set:custom-2.png",
      "refresh",
      "remove:custom-1.png",
    ]);
    expect(current()).toEqual({ fileName: "custom-2.png", enabled: true });
  });

  it("does not delete the file it just selected", async () => {
    const { actions, calls } = setup({
      previous: { fileName: "custom-2.png", enabled: false },
    });
    await actions.choose("/tmp/cat.png");
    expect(calls).toEqual(["set:custom-2.png", "refresh"]);
  });

  it("removes the new file when the config write fails", async () => {
    const { actions, calls, current } = setup({ setThrows: true });
    await actions.choose("/tmp/cat.png");
    expect(calls).toEqual(["remove:custom-2.png", "log", "error:write-failed"]);
    expect(current()).toBeNull();
  });

  it("maps a PetImageError to its i18n code and keeps config untouched", async () => {
    const { actions, calls, current } = setup({
      choose: async () => {
        throw new PetImageError("too-large");
      },
    });
    await actions.choose("/tmp/big.png");
    expect(calls).toEqual(["error:too-large"]);
    expect(current()).toBeNull();
  });

  it("logs unknown failures and reports write-failed", async () => {
    const { actions, calls } = setup({
      choose: async () => {
        throw new Error("boom");
      },
    });
    await actions.choose("/tmp/cat.png");
    expect(calls).toEqual(["log", "error:write-failed"]);
  });

  it("clears config, refreshes, then removes the file on remove", async () => {
    const { actions, calls, current } = setup({
      previous: { fileName: "custom-1.png", enabled: true },
    });
    await actions.remove();
    expect(calls).toEqual(["set:null", "refresh", "remove:custom-1.png"]);
    expect(current()).toBeNull();
  });

  it("does nothing extra when there is no custom image to remove", async () => {
    const { actions, calls } = setup();
    await actions.remove();
    expect(calls).toEqual(["set:null", "refresh"]);
  });
});
