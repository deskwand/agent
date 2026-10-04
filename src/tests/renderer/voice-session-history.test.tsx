// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
import type { ChatInputSubmitData } from "../../renderer/components/ChatInput";
const ipc = vi.hoisted(() => ({
  continueSession: vi.fn(),
  getSessionMessagesPage: vi.fn(),
  getSessionTraceSteps: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ ...ipc, isElectron: false }),
}));
vi.mock("../../renderer/components/ChatInput", () => ({
  ChatInput: forwardRef(
    ({ onSubmit }: { onSubmit: (data: ChatInputSubmitData) => void }, ref) => {
      useImperativeHandle(ref, () => ({
        clear: () => {},
        focus: () => {},
        isEmpty: () => true,
      }));
      return (
        <button
          data-testid="typed-input"
          onClick={() =>
            onSubmit({ text: "typed question", images: [], files: [] })
          }
        >
          Send
        </button>
      );
    },
  ),
}));
vi.mock("../../renderer/components/ChatInputBottomBar", () => ({
  ChatInputBottomBar: () => null,
}));
vi.mock("../../renderer/components/ChatInputStatusBar", () => ({
  ChatInputStatusBar: () => null,
  resolveInputStatus: () => null,
}));
import { ChatView } from "../../renderer/components/ChatView";
import { Sidebar } from "../../renderer/components/Sidebar";
let container: HTMLDivElement;
let root: Root;
const record = (id: string, kind?: Session["kind"]): Session => ({
  id,
  kind,
  title: id,
  status: "idle",
  createdAt: 1,
  updatedAt: 1,
  mountedPaths: [],
  allowedTools: ["web_search"],
  memoryEnabled: false,
  isProjectMode: false,
});
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(useAppStore.getInitialState(), true);
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const clickLabel = (text: string) =>
  [...container.querySelectorAll("button")]
    .find((b) => b.textContent === text)!
    .click();
it("defaults empty voice history to speech, types in the same record without a voice profile, and resumes", async () => {
  useAppStore.getState().addSession(record("V", "voice"));
  useAppStore.getState().setActiveSession("V");
  await act(async () => root.render(<ChatView />));
  expect(container.querySelector('[data-testid="typed-input"]')).toBeNull();
  expect(container.textContent).toContain("voiceMode.start");
  expect(useAppStore.getState().voiceModeOpen).toBe(false);
  await act(async () => clickLabel("voiceMode.useText"));
  expect(container.querySelector('[data-testid="typed-input"]')).not.toBeNull();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-testid="typed-input"]')!
      .click(),
  );
  expect(ipc.continueSession).toHaveBeenCalledWith(
    "V",
    [{ type: "text", text: "typed question" }],
    undefined,
    undefined,
    undefined,
  );
  expect(useAppStore.getState().sessions[0].kind).toBe("voice");
  await act(async () => clickLabel("voiceMode.start"));
  expect(useAppStore.getState().voiceModeSessionId).toBe("V");
});
it("offers resume for populated voice history, and resets text choice on selection", async () => {
  const store = useAppStore.getState();
  store.addSession(record("V", "voice"));
  store.addSession(record("V2", "voice"));
  store.setMessagesTail(
    "V",
    [
      {
        id: "m",
        sessionId: "V",
        role: "user",
        content: [{ type: "text", text: "past" }],
        timestamp: 1,
      },
    ],
    false,
  );
  store.setActiveSession("V");
  await act(async () => root.render(<ChatView />));
  expect(container.textContent).toContain("voiceMode.resume");
  await act(async () => clickLabel("voiceMode.useText"));
  await act(async () => store.setActiveSession("V2"));
  expect(container.querySelector('[data-testid="typed-input"]')).toBeNull();
});
it.each([undefined, "ordinary" as const])(
  "retains ordinary input for kind=%s",
  async (kind) => {
    useAppStore.getState().addSession(record("O", kind));
    useAppStore.getState().setActiveSession("O");
    await act(async () => root.render(<ChatView />));
    expect(
      container.querySelector('[data-testid="typed-input"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("voiceMode.start");
  },
);
it("marks only voice history and selects it without recording", async () => {
  const store = useAppStore.getState();
  store.addSession(record("V", "voice"));
  store.addSession(record("O", "ordinary"));
  store.addSession(record("legacy"));
  await act(async () => root.render(<Sidebar width={280} />));
  expect(
    container.querySelectorAll('[aria-label="voiceMode.sessionLabel"]'),
  ).toHaveLength(1);
  await act(async () =>
    container.querySelector<HTMLElement>('[data-session-id="V"]')!.click(),
  );
  expect(useAppStore.getState().activeSessionId).toBe("V");
  expect(useAppStore.getState().voiceModeOpen).toBe(false);
});
