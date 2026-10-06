// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  continue: vi.fn(),
  captures: vi.fn(),
  question: undefined as ((text: string, turnId: string) => void) | undefined,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    createVoiceSession: mocks.create,
    continueSession: mocks.continue,
    listSessions: vi.fn(),
    isElectron: false,
  }),
}));
vi.mock("../../renderer/hooks/useWindowSize", () => ({
  useWindowSize: () => {},
}));
vi.mock("../../renderer/components/voice-mode/VoiceModeHost", () => ({
  VoiceModeHost: ({
    sessionId,
    onSendQuestion,
  }: {
    sessionId: string;
    onSendQuestion: (text: string, turnId: string) => void;
  }) => {
    mocks.captures(sessionId);
    mocks.question = onSendQuestion;
    return <div data-voice-target={sessionId} />;
  },
}));
vi.mock("../../renderer/components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../../renderer/components/WelcomeView", () => ({
  WelcomeView: () => null,
}));
vi.mock("../../renderer/components/VaultView", () => ({
  VaultView: () => null,
}));
vi.mock("../../renderer/components/UsageView", () => ({
  UsageView: () => null,
}));
vi.mock("../../renderer/components/ScheduleView", () => ({
  ScheduleView: () => null,
}));
vi.mock("../../renderer/components/AppsView", () => ({ AppsView: () => null }));
vi.mock("../../renderer/components/PermissionDialog", () => ({
  PermissionDialog: () => null,
}));
vi.mock("../../renderer/components/SudoPasswordDialog", () => ({
  SudoPasswordDialog: () => null,
}));
vi.mock("../../renderer/components/ExtensionDialogs", () => ({
  ExtensionDialogs: () => null,
}));
vi.mock("../../renderer/components/PiTuiModal", () => ({
  PiTuiModal: () => null,
}));
vi.mock("../../renderer/components/TopUpModal", () => ({
  TopUpModal: () => null,
}));
vi.mock("../../renderer/components/Titlebar", () => ({ Titlebar: () => null }));
vi.mock("../../renderer/components/SandboxSetupDialog", () => ({
  SandboxSetupDialog: () => null,
}));
vi.mock("../../renderer/components/SandboxSyncToast", () => ({
  SandboxSyncToast: () => null,
}));
vi.mock("../../renderer/components/GlobalNoticeToast", () => ({
  GlobalNoticeToast: () => null,
}));
vi.mock("../../renderer/components/ImageLightbox", () => ({
  ImageLightbox: () => null,
}));
vi.mock("../../renderer/components/ChatView", () => ({ ChatView: () => null }));
vi.mock("../../renderer/components/FileBrowser", () => ({
  FileBrowser: () => null,
}));
vi.mock("../../renderer/components/ReviewPanel", () => ({
  ReviewPanel: () => null,
}));
vi.mock("../../renderer/components/BrowserPanel", () => ({
  BrowserPanel: () => null,
}));
vi.mock("../../renderer/components/ArtifactPanel", () => ({
  ArtifactPanel: () => null,
}));
vi.mock("../../renderer/components/FilePreviewPanel", () => ({
  FilePreviewPanel: () => null,
}));
vi.mock("../../renderer/components/ConfigModal", () => ({
  ConfigModal: () => null,
}));
vi.mock("../../renderer/components/SettingsPanel", () => ({
  SettingsPanel: () => null,
}));
vi.mock("../../renderer/components/HelpMenu", () => ({ HelpMenu: () => null }));
vi.mock("../../renderer/components/AccountCluster", () => ({
  AccountCluster: () => null,
}));
import App from "../../renderer/App";
let root: Root;
let container: HTMLDivElement;
function session(id: string, kind: Session["kind"] = "voice"): Session {
  return {
    id,
    kind,
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: ["web_search"],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().addSession(session("ordinary", "ordinary"));
  useAppStore.getState().setActiveSession("ordinary");
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
function entry() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="navRail.newVoiceSession"]',
  )!;
}
function press() {
  const event = new KeyboardEvent("keydown", {
    code: "Space",
    ctrlKey: true,
    shiftKey: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}
it("creates from ordinary X, keeps new V open after effects, and never sends a fabricated prompt", async () => {
  const record = session("V");
  mocks.create.mockImplementation(async () => {
    useAppStore.getState().addSession(record);
    return record;
  });
  await act(async () => entry().click());
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().activeSessionId).toBe("V");
  expect(useAppStore.getState().voiceModeSessionId).toBe("V");
  expect(container.querySelector('[data-voice-target="V"]')).not.toBeNull();
  expect(entry().hasAttribute("aria-current")).toBe(false);
  expect(mocks.continue).not.toHaveBeenCalled();
});
it("resumes another historical voice record, then keeps it running after switching", async () => {
  const store = useAppStore.getState();
  store.addSession(session("historical"));
  await act(async () => {
    store.setActiveSession("historical");
  });
  expect(mocks.captures).not.toHaveBeenCalled();
  await act(async () => {
    store.openVoiceMode("historical");
  });
  expect(
    container.querySelector('[data-voice-target="historical"]'),
  ).not.toBeNull();

  const old = mocks.question!;
  await act(async () => {
    useAppStore.getState().setActiveSession("ordinary");
  });
  await act(async () => {
    old("late", "turn-1");
  });

  // 后台运行：这一轮照样属于 voice 会话，不是被丢掉
  expect(mocks.continue).toHaveBeenCalledWith(
    "historical",
    "late",
    undefined,
    undefined,
    undefined,
    "voice",
    "turn-1",
  );
  expect(useAppStore.getState().voiceModeOpen).toBe(true);
});

it("stops the runtime when the voice session is deleted", async () => {
  const store = useAppStore.getState();
  store.addSession(session("V"));
  await act(async () => {
    store.setActiveSession("V");
  });
  await act(async () => {
    store.openVoiceMode("V");
  });
  expect(useAppStore.getState().voiceModeOpen).toBe(true);
  await act(async () => {
    useAppStore.getState().removeSession("V");
  });
  expect(useAppStore.getState().voiceModeOpen).toBe(false);
  expect(container.querySelector("[data-voice-target]")).toBeNull();
});

it("notices the user when a voice session replaces another", async () => {
  const store = useAppStore.getState();
  store.addSession(session("V"));
  await act(async () => {
    store.setActiveSession("V");
  });
  await act(async () => {
    store.openVoiceMode("V");
  });
  await act(async () => {
    useAppStore.getState().addSession(session("W"));
    useAppStore.getState().openVoiceMode("W");
  });
  expect(useAppStore.getState().globalNotice?.messageKey).toBe(
    "voiceMode.endedPreviousSession",
  );
});

it("brings the user back to the voice session on the shortcut while minimized", async () => {
  const store = useAppStore.getState();
  store.addSession(session("V"));
  await act(async () => {
    store.setActiveSession("V");
  });
  await act(async () => {
    store.openVoiceMode("V");
  });
  // 人去了别的会话，宿主把语音收进小球（宿主本身在 voice-mode-host 里测）
  await act(async () => {
    store.setActiveSession("ordinary");
    store.setVoiceModeMinimized(true);
  });
  await act(async () => {
    press();
  });
  expect(useAppStore.getState().voiceModeOpen).toBe(true);
  expect(useAppStore.getState().voiceModeMinimized).toBe(false);
  expect(useAppStore.getState().activeSessionId).toBe("V");
  expect(useAppStore.getState().activeView).toBe("chat");

  await act(async () => {
    press();
  });
  expect(useAppStore.getState().voiceModeOpen).toBe(false);
});
it("locks duplicate clicks and preserves records without stealing focus after navigation", async () => {
  let resolve!: (value: Session) => void;
  mocks.create.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => {
    entry().click();
    entry().click();
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await act(async () => {
    useAppStore.getState().setActiveView("vault");
  });
  const record = session("pending");
  await act(async () => {
    useAppStore.getState().addSession(record);
    resolve(record);
  });
  expect(useAppStore.getState().sessions.some((s) => s.id === "pending")).toBe(
    true,
  );
  expect(useAppStore.getState().activeView).toBe("vault");
  expect(useAppStore.getState().activeSessionId).toBe("ordinary");
  expect(mocks.captures).not.toHaveBeenCalled();
});
it.each(["settings", "vault", "apps"] as const)(
  "ignores the shortcut in %s",
  async (activeView) => {
    await act(async () => {
      useAppStore.getState().setActiveView(activeView);
    });
    let prevented = false;
    await act(async () => {
      prevented = press().defaultPrevented;
    });
    expect(prevented).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  },
);
it("refuses to bind the overlay to an ordinary session", () => {
  const store = useAppStore.getState();
  store.openVoiceMode("ordinary");
  expect(useAppStore.getState().voiceModeOpen).toBe(false);
});
it("closes an open overlay with the shortcut instead of creating", async () => {
  await act(async () => {
    const store = useAppStore.getState();
    store.addSession(session("V"));
    store.setActiveSession("V");
    store.openVoiceMode("V");
  });
  await act(async () => {
    press();
  });
  expect(useAppStore.getState().voiceModeOpen).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(useAppStore.getState().sessions.some((s) => s.id === "V")).toBe(true);
});
it("does not open capture on failed creation", async () => {
  mocks.create.mockRejectedValue(new Error("disk full"));
  await act(async () => {
    entry().click();
  });
  expect(mocks.captures).not.toHaveBeenCalled();
  expect(useAppStore.getState().activeSessionId).toBe("ordinary");
});
