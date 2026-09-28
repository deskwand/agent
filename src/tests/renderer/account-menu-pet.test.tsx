// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../../renderer/components/AccountMenu";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  useAppStore.getState().setSettings({ petEnabled: false });
});

describe("AccountMenu desktop pet", () => {
  for (const loggedIn of [false, true]) {
    it(`shows and toggles the switch when logged ${loggedIn ? "in" : "out"}`, () => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const originalUpdateSettings = useAppStore.getState().updateSettings;
      const element = document.createElement("div");
      document.body.appendChild(element);
      const root = createRoot(element);
      const updateSettings = vi.fn();
      useAppStore.setState({ updateSettings });
      act(() => {
        root.render(
          <AccountMenu
            isOpen
            cloudConfig={
              loggedIn
                ? {
                    isLoggedIn: true,
                    token: "",
                    email: "test@example.com",
                    serverUrl: "https://example.com",
                    level: "pro",
                    balanceMicroUsd: 0,
                  }
                : null
            }
            onOpenLogin={vi.fn()}
            onOpenSettings={vi.fn()}
            onLogout={vi.fn()}
            onClose={vi.fn()}
          />,
        );
      });
      const toggle = element.querySelector(
        '[role="switch"]',
      ) as HTMLButtonElement | null;
      expect(toggle?.getAttribute("aria-checked")).toBe("false");
      act(() => toggle?.click());
      expect(updateSettings).toHaveBeenCalledWith({ petEnabled: true });
      act(() => root.unmount());
      useAppStore.setState({ updateSettings: originalUpdateSettings });
      element.remove();
    });
  }
});
