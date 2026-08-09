import { describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../../main/agent/agent-runner";
import { PathResolver } from "../../main/sandbox/path-resolver";
import type { ServerEvent } from "../../renderer/types";

function makeRunner() {
  const events: ServerEvent[] = [];
  const runner = new AgentRunner(
    { sendToRenderer: (event) => events.push(event) },
    new PathResolver(),
  );
  const piSessions = (runner as unknown as { piSessions: Map<string, unknown> })
    .piSessions;
  return { runner, events, piSessions };
}

describe("AgentRunner steer", () => {
  it("reports failed with no-active-session instead of staying silent", () => {
    const { runner, events } = makeRunner();
    runner.steer("missing", "hello", "req-1");
    expect(events).toEqual([
      {
        type: "session.steer.result",
        payload: {
          sessionId: "missing",
          status: "failed",
          text: "hello",
          requestId: "req-1",
          reason: "no-active-session",
        },
      },
    ]);
  });

  it("reports failed with sdk-error when steer() rejects", async () => {
    const { runner, events, piSessions } = makeRunner();
    const steer = vi.fn().mockRejectedValue(new Error("extension command"));
    piSessions.set("s1", {
      session: { steer },
      modelId: "model",
      thinkingLevel: "medium",
      runtimeSignature: "runtime",
      skillsSignature: "skills",
      toolsSignature: "tools",
      extensionSignature: "extensions",
      extensionCommands: [],
    });
    runner.steer("s1", "hello", "req-1");
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "session.steer.result",
        payload: {
          sessionId: "s1",
          status: "failed",
          text: "hello",
          requestId: "req-1",
          reason: "sdk-error",
        },
      });
    });
  });

  it("emits accepted then delivered when queue drains", async () => {
    const { runner, events, piSessions } = makeRunner();
    const steer = vi.fn().mockResolvedValue(undefined);
    const getSteeringMessages = vi.fn().mockReturnValue(["hello"]);
    piSessions.set("s1", {
      session: { steer, getSteeringMessages },
      modelId: "model",
      thinkingLevel: "medium",
      runtimeSignature: "runtime",
      skillsSignature: "skills",
      toolsSignature: "tools",
      extensionSignature: "extensions",
      extensionCommands: [],
    });
    runner.steer("s1", "hello", "req-1");
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "session.steer.result",
        payload: {
          sessionId: "s1",
          status: "accepted",
          text: "hello",
          requestId: "req-1",
        },
      });
    });
    // 模拟 SDK queue_update：队列从 1 条减到 0 → delivered
    const handleQueueUpdate = (
      runner as unknown as {
        handleQueueUpdate: (s: string, q: readonly string[]) => void;
      }
    ).handleQueueUpdate;
    handleQueueUpdate("s1", []);
    expect(events).toContainEqual({
      type: "session.steer.delivered",
      payload: { sessionId: "s1", text: "hello", requestId: "req-1" },
    });
  });

  it("emits delivered immediately when queue already drained at resolve", async () => {
    const { runner, events, piSessions } = makeRunner();
    const steer = vi.fn().mockResolvedValue(undefined);
    // 极快消费：steer() resolve 时队列已空
    const getSteeringMessages = vi.fn().mockReturnValue([]);
    piSessions.set("s1", {
      session: { steer, getSteeringMessages },
      modelId: "model",
      thinkingLevel: "medium",
      runtimeSignature: "runtime",
      skillsSignature: "skills",
      toolsSignature: "tools",
      extensionSignature: "extensions",
      extensionCommands: [],
    });
    runner.steer("s1", "hello", "req-1");
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "session.steer.delivered",
        payload: { sessionId: "s1", text: "hello", requestId: "req-1" },
      });
    });
  });

  it("normalizes harness steer key and session steering key queue_update shapes", () => {
    const { runner } = makeRunner();
    const resolveQueueUpdateSteering = (
      runner as unknown as {
        resolveQueueUpdateSteering: (e: {
          steering?: readonly string[];
          steer?: readonly string[];
        }) => readonly string[];
      }
    ).resolveQueueUpdateSteering;
    // harness 事件形状（{ steer: [...] }）
    expect(resolveQueueUpdateSteering({ steer: ["a"] })).toEqual(["a"]);
    // session mirror 事件形状（{ steering: [...] }）
    expect(resolveQueueUpdateSteering({ steering: ["a"] })).toEqual(["a"]);
    // 无队列字段时兜底为空数组，不抛错
    expect(resolveQueueUpdateSteering({})).toEqual([]);
  });

  it("delivers pending steer on harness-style queue_update drain", async () => {
    const { runner, events, piSessions } = makeRunner();
    const steer = vi.fn().mockResolvedValue(undefined);
    const getSteeringMessages = vi.fn().mockReturnValue(["a"]);
    piSessions.set("s1", {
      session: { steer, getSteeringMessages },
      modelId: "model",
      thinkingLevel: "medium",
      runtimeSignature: "runtime",
      skillsSignature: "skills",
      toolsSignature: "tools",
      extensionSignature: "extensions",
      extensionCommands: [],
    });
    runner.steer("s1", "a", "req-1");
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "session.steer.result",
        payload: {
          sessionId: "s1",
          status: "accepted",
          text: "a",
          requestId: "req-1",
        },
      });
    });
    const handleQueueUpdate = (
      runner as unknown as {
        handleQueueUpdate: (s: string, q: readonly string[]) => void;
      }
    ).handleQueueUpdate;
    const resolveQueueUpdateSteering = (
      runner as unknown as {
        resolveQueueUpdateSteering: (e: {
          steering?: readonly string[];
          steer?: readonly string[];
        }) => readonly string[];
      }
    ).resolveQueueUpdateSteering;
    // harness 形状事件：队列从 1 条减到 0 → delivered
    handleQueueUpdate("s1", resolveQueueUpdateSteering({ steer: [] }));
    expect(events).toContainEqual({
      type: "session.steer.delivered",
      payload: { sessionId: "s1", text: "a", requestId: "req-1" },
    });
  });

  it("flushes undelivered steers as failed(session-stopped) on agent end", async () => {
    const { runner, events, piSessions } = makeRunner();
    const steer = vi.fn().mockResolvedValue(undefined);
    const getSteeringMessages = vi.fn().mockReturnValue(["a"]);
    const clearQueue = vi.fn();
    piSessions.set("s1", {
      session: { steer, getSteeringMessages, clearQueue },
      modelId: "model",
      thinkingLevel: "medium",
      runtimeSignature: "runtime",
      skillsSignature: "skills",
      toolsSignature: "tools",
      extensionSignature: "extensions",
      extensionCommands: [],
    });
    runner.steer("s1", "a", "req-1");
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "session.steer.result",
        payload: {
          sessionId: "s1",
          status: "accepted",
          text: "a",
          requestId: "req-1",
        },
      });
    });
    const flushUndeliveredSteers = (
      runner as unknown as {
        flushUndeliveredSteers: (s: string) => void;
      }
    ).flushUndeliveredSteers;
    // 回合结束（无重试）→ flush：failed(session-stopped) + 清 harness 残留队列
    flushUndeliveredSteers("s1");
    expect(events).toContainEqual({
      type: "session.steer.result",
      payload: {
        sessionId: "s1",
        status: "failed",
        text: "a",
        requestId: "req-1",
        reason: "session-stopped",
      },
    });
    expect(clearQueue).toHaveBeenCalledTimes(1);
    // pending 已清空：再次 flush 不重复发事件、不重复清队列
    const countBefore = events.length;
    flushUndeliveredSteers("s1");
    expect(events.length).toBe(countBefore);
    expect(clearQueue).toHaveBeenCalledTimes(1);
  });

  it("flush does nothing when no pending steers", () => {
    const { runner, events } = makeRunner();
    const flushUndeliveredSteers = (
      runner as unknown as {
        flushUndeliveredSteers: (s: string) => void;
      }
    ).flushUndeliveredSteers;
    flushUndeliveredSteers("s1");
    expect(events).toEqual([]);
  });
});

describe("AgentRunner steer with images", () => {
  it("passes images through to session.steer", async () => {
    const { runner, piSessions } = makeRunner();
    const steer = vi.fn().mockResolvedValue(undefined);
    const getSteeringMessages = vi.fn().mockReturnValue(["hello"]);
    piSessions.set("s1", {
      session: { steer, getSteeringMessages },
      modelId: "model",
      thinkingLevel: "medium",
      runtimeSignature: "runtime",
      skillsSignature: "skills",
      toolsSignature: "tools",
      extensionSignature: "extensions",
      extensionCommands: [],
    });
    const images = [
      {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/png" as const,
          data: "QUJD",
        },
      },
    ];
    runner.steer("s1", "hello", "req-1", images);
    await vi.waitFor(() => {
      // AgentRunner 内部把 renderer ImageContent（source 嵌套）转换为
      // pi-ai ImageContent（data/mimeType 平铺）后传给 session.steer
      expect(steer).toHaveBeenCalledWith("hello", [
        { type: "image", data: "QUJD", mimeType: "image/png" },
      ]);
    });
  });
});
