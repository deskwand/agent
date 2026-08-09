import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientEvent } from "../../renderer/types";

type ExposedElectronApi = {
  send: (event: ClientEvent) => void;
  on: (callback: unknown) => () => void;
};

// Every renderer→main event type. Kept in sync with the ClientEvent union by
// the type-level assertion below: adding a new member here is a compile error.
// `as const` is required: a `ReadonlyArray<ClientEvent["type"]>` annotation
// would widen the element type to the whole union, making the exhaustiveness
// check below compare the union against itself (always true).
const ALL_CLIENT_EVENT_TYPES = [
  "session.start",
  "session.continue",
  "session.setThinkingLevel",
  "session.setProviderModel",
  "session.stop",
  "session.compact",
  "session.abortCompaction",
  "session.steer",
  "session.command",
  "session.delete",
  "session.batchDelete",
  "session.archive",
  "session.unarchive",
  "session.batchArchive",
  "session.batchUnarchive",
  "session.archiveDelete",
  "session.list",
  "session.getMessages",
  "session.getMessagesPage",
  "session.getTraceSteps",
  "permission.response",
  "sudo.password.response",
  "settings.update",
  "folder.select",
  "workdir.get",
  "workdir.set",
  "workdir.select",
  "project.create",
  "project.delete",
  "update.check",
  "update.install",
] as const satisfies ReadonlyArray<ClientEvent["type"]>;

// Compile-time: the list above must cover the whole ClientEvent union, so a
// newly added event type forces an update here (and, via the preload's own
// exhaustive check, a matching allowlist entry).
// Tuple form (not a naked type parameter) so the conditional does NOT
// distribute over the union: with distribution, a missing member collapses
// to `true | never` = `true` and the check silently passes.
type _ExhaustiveEventTypes = [ClientEvent["type"]] extends [
  (typeof ALL_CLIENT_EVENT_TYPES)[number],
]
  ? true
  : never;
const _check: _ExhaustiveEventTypes = true;
void _check;

describe("preload ALLOWED_CLIENT_EVENTS", () => {
  let exposedApi: ExposedElectronApi | undefined;
  let ipcSend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    exposedApi = undefined;
    ipcSend = vi.fn();
    vi.resetModules();

    vi.doMock("electron", () => {
      const ipcRenderer = {
        on: vi.fn(),
        once: vi.fn(),
        send: ipcSend,
        sendSync: vi.fn(() => null),
        invoke: vi.fn(async () => null),
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(),
      };

      return {
        contextBridge: {
          exposeInMainWorld: vi.fn(
            (_name: string, api: ExposedElectronApi) => {
              exposedApi = api;
            },
          ),
        },
        ipcRenderer,
      };
    });

    await import("../../preload/index");
  });

  it.each(ALL_CLIENT_EVENT_TYPES)("delivers %s to the main process", (type) => {
    const event = { type, payload: {} } as unknown as ClientEvent;
    exposedApi?.send(event);

    expect(ipcSend).toHaveBeenCalledWith("client-event", event);
  });

  it("still blocks unknown event types", () => {
    exposedApi?.send({
      type: "something.unknown",
      payload: {},
    } as unknown as ClientEvent);

    expect(ipcSend).not.toHaveBeenCalled();
  });
});
