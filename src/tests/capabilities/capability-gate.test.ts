import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  createCapabilityGate,
  decideGateAction,
  ensureCapability,
  type EnsureDeps,
} from "../../renderer/capabilities/capability-gate";
import { createInstallQueue } from "../../renderer/capabilities/install-queue";
import type {
  CapabilityId,
  CapabilityInstalls,
} from "../../renderer/capabilities/catalog";

const none: CapabilityInstalls = { voiceInput: null, voice: null, ocr: null };

/** 这三个必须是替身：用例要断言它们被怎么调过。 */
type EnsureOverrides = Partial<
  Omit<EnsureDeps, "openPrompt" | "enable" | "notifyFailure">
> & {
  openPrompt?: Mock<(id: CapabilityId) => void>;
  enable?: Mock<(id: CapabilityId) => Promise<boolean>>;
  notifyFailure?: Mock<() => void>;
};

function deps(overrides: EnsureOverrides = {}): EnsureDeps & {
  openPrompt: Mock<(id: CapabilityId) => void>;
  enable: Mock<(id: CapabilityId) => Promise<boolean>>;
  notifyFailure: Mock<() => void>;
} {
  const base = {
    hasBridge: true,
    getConfig: () => ({
      voiceEngine: { enabled: true },
      ocr: { enabled: true },
    }),
    readInstalls: () => none,
    enable: vi.fn(async (_id: CapabilityId) => true),
    openPrompt: vi.fn((_id: CapabilityId) => {}),
    notifyFailure: vi.fn(() => {}),
  };
  // 顺序要紧：默认值在前、overrides 在后 —— 反过来会把传进来的替身又盖回默认值
  //（测试自己踩过：那样"写开关失败"那条会拿到默认的 `async () => true`）。
  return { ...base, ...overrides } as unknown as EnsureDeps & {
    openPrompt: Mock<(id: CapabilityId) => void>;
    enable: Mock<(id: CapabilityId) => Promise<boolean>>;
    notifyFailure: Mock<() => void>;
  };
}

describe("决定动作", () => {
  it("桥不在 → unavailable", () => {
    expect(decideGateAction("voiceInput", null, none, false)).toBe(
      "unavailable",
    );
  });

  it("正在装 / 上次失败 → wait（不重复问、不重复下载）", () => {
    const busy: CapabilityInstalls = {
      ...none,
      voiceInput: { phase: "downloading", percent: 10, installed: false },
    };
    expect(decideGateAction("voiceInput", null, busy, true)).toBe("wait");
    const failed: CapabilityInstalls = {
      ...none,
      voiceInput: { phase: "error", percent: 0, installed: false },
    };
    expect(decideGateAction("voiceInput", null, failed, true)).toBe("wait");
  });

  it("装着且开着 → proceed", () => {
    const ready: CapabilityInstalls = {
      ...none,
      voiceInput: { phase: "ready", percent: 100, installed: true },
    };
    expect(
      decideGateAction(
        "voiceInput",
        { voiceEngine: { enabled: true } },
        ready,
        true,
      ),
    ).toBe("proceed");
  });

  it("装着但开关没开 → enable（不下载就不问）", () => {
    const ready: CapabilityInstalls = {
      ...none,
      voiceInput: { phase: "ready", percent: 100, installed: true },
    };
    expect(
      decideGateAction(
        "voiceInput",
        { voiceEngine: { enabled: false } },
        ready,
        true,
      ),
    ).toBe("enable");
  });

  it("没装 → prompt（开关一律等确认之后再写）", () => {
    expect(
      decideGateAction(
        "voiceInput",
        { voiceEngine: { enabled: false } },
        none,
        true,
      ),
    ).toBe("prompt");
    const ocrInstalled: CapabilityInstalls = {
      ...none,
      ocr: { phase: "ready", percent: 100, installed: true },
    };
    expect(
      decideGateAction(
        "ocr",
        { voiceEngine: { enabled: true }, ocr: { enabled: true } },
        ocrInstalled,
        true,
      ),
    ).toBe("proceed");
    expect(
      decideGateAction("ocr", { ocr: { enabled: false } }, none, true),
    ).toBe("prompt");
  });
});

describe("执行门", () => {
  it("没装 → 打开弹窗并返回 cancelled（不把用户的思考时间挂在 promise 上）", async () => {
    const d = deps();
    await expect(ensureCapability("voiceInput", d)).resolves.toBe("cancelled");
    expect(d.openPrompt).toHaveBeenCalledWith("voiceInput");
    expect(d.enable).not.toHaveBeenCalled();
  });

  it("已装且开着 → ready，不写配置、不弹窗", async () => {
    const ready: CapabilityInstalls = {
      ...none,
      voiceInput: { phase: "ready", percent: 100, installed: true },
    };
    const d = deps({ readInstalls: () => ready });
    await expect(ensureCapability("voiceInput", d)).resolves.toBe("ready");
    expect(d.enable).not.toHaveBeenCalled();
    expect(d.openPrompt).not.toHaveBeenCalled();
  });

  it("装着但开关没开 → 写开关后 ready", async () => {
    const ready: CapabilityInstalls = {
      ...none,
      voiceInput: { phase: "ready", percent: 100, installed: true },
    };
    const d = deps({
      readInstalls: () => ready,
      getConfig: () => ({ voiceEngine: { enabled: false } }),
    });
    await expect(ensureCapability("voiceInput", d)).resolves.toBe("ready");
    expect(d.enable).toHaveBeenCalledWith("voiceInput");
  });

  it("写开关失败 → failed 并且必须报一次（不能“点了什么都没发生”）", async () => {
    const ready: CapabilityInstalls = {
      ...none,
      voiceInput: { phase: "ready", percent: 100, installed: true },
    };
    const d = deps({
      readInstalls: () => ready,
      getConfig: () => ({ voiceEngine: { enabled: false } }),
      enable: vi.fn(async () => false),
    });
    await expect(ensureCapability("voiceInput", d)).resolves.toBe("failed");
    expect(d.notifyFailure).toHaveBeenCalledTimes(1);
  });

  it("正在装 → busy（不弹、不写）", async () => {
    const busy: CapabilityInstalls = {
      ...none,
      ocr: { phase: "extracting", percent: 80, installed: false },
    };
    const d = deps({ readInstalls: () => busy });
    await expect(ensureCapability("ocr", d)).resolves.toBe("busy");
    expect(d.openPrompt).not.toHaveBeenCalled();
  });

  it("桥不在 → unsupported，静默", async () => {
    const d = deps({ hasBridge: false });
    await expect(ensureCapability("voiceInput", d)).resolves.toBe(
      "unsupported",
    );
  });
});

// ────────────────────────────────────────────────────────────────────
//  接线（controller）
// ────────────────────────────────────────────────────────────────────

const readyInput: CapabilityInstalls = {
  ...none,
  voiceInput: { phase: "ready", percent: 100, installed: true },
};

function setup(installs: () => CapabilityInstalls) {
  const publish = vi.fn();
  const install = vi.fn(async () => {});
  const queue = createInstallQueue();
  const gate = createCapabilityGate({
    hasBridge: () => true,
    readVoiceInstall: async () => installs().voiceInput,
    readTtsInstalls: async () => installs().voice,
    readOcrInstall: async () => installs().ocr,
    install,
    enable: async () => true,
    getConfig: () => ({
      voiceEngine: { enabled: true },
      ocr: { enabled: true },
    }),
    publish,
    notifyFailure: vi.fn(),
    subscribe: () => () => {},
    queue,
  });
  return { gate, publish, install, queue };
}

describe("门的接线", () => {
  it("refresh 拉三路状态并发布出去", async () => {
    const { gate, publish } = setup(() => readyInput);
    await gate.refresh();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        installs: expect.objectContaining({
          voiceInput: expect.objectContaining({ installed: true }),
        }),
      }),
    );
  });

  it("ensureReady 用的是**刚读到的**状态，不是渲染时那份快照", async () => {
    // 第一次读：还没装；之后读：装好了。ensureReady 必须先 refresh 再判 ——
    // 否则渲染层几秒前的快照会把已装的用户挡在"要不要下载"的弹窗外。
    let reads = 0;
    const { gate } = setup(() => {
      reads += 1;
      return reads === 1 ? none : readyInput;
    });
    expect(reads).toBe(0);
    await expect(gate.ensureReady("voiceInput")).resolves.toBe("cancelled");
    await expect(gate.ensureReady("voiceInput")).resolves.toBe("ready");
  });

  it("缺模型 → ensureReady 返回 cancelled 并把 prompt 发布出去（弹窗只可能有一个）", async () => {
    const { gate, publish } = setup(() => none);
    await expect(gate.ensureReady("voiceInput")).resolves.toBe("cancelled");
    expect(publish).toHaveBeenCalledWith({ prompt: "voiceInput" });
  });

  it("弹窗开着时再点别的入口：prompt 被换成新的那一个，不会叠第二个", async () => {
    const { gate, publish } = setup(() => none);
    await gate.ensureReady("voiceInput");
    await gate.ensureReady("ocr");
    expect(publish).toHaveBeenLastCalledWith({ prompt: "ocr" });
  });

  it("确认下载：关弹窗 → 入队 → 装完 refresh", async () => {
    const { gate, install } = setup(() => none);
    await gate.ensureReady("voiceInput");
    // confirmDownload 自己会关弹窗 —— 不要先 cancelPrompt（那样 prompt 已是空，
    // 这一次确认什么都做不了；测试第一版就是这么写错的）。
    await gate.confirmDownload();
    expect(install).toHaveBeenCalledWith("voiceInput");
    expect(gate.getState().prompt).toBeNull();
  });

  it("whenReady：装好那一刻 resolve（用于朗读装完自动开始）", async () => {
    let state: CapabilityInstalls = none;
    const { gate } = setup(() => state);
    const done = vi.fn();
    void gate.whenReady("voice").then(done);
    expect(done).not.toHaveBeenCalled();
    state = {
      ...none,
      voice: {
        zh: { phase: "ready", percent: 100, installed: true },
        en: { phase: "idle", percent: 0, installed: false },
        matcha: { phase: "idle", percent: 0, installed: false },
      },
    };
    await gate.refresh();
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("安装事件直接落状态，不等下一次回读", async () => {
    const applied: Array<(patch: Partial<CapabilityInstalls>) => void> = [];
    const gate = createCapabilityGate({
      hasBridge: () => true,
      readVoiceInstall: async () => none.voiceInput,
      readTtsInstalls: async () => none.voice,
      readOcrInstall: async () => none.ocr,
      install: async () => {},
      enable: async () => true,
      getConfig: () => null,
      publish: vi.fn(),
      notifyFailure: vi.fn(),
      subscribe: (apply) => {
        applied.push(apply);
        return () => {};
      },
      queue: createInstallQueue(),
    });
    await gate.refresh();
    // 下载中：事件直接把百分比推进状态
    applied[0]({
      voiceInput: { phase: "downloading", percent: 42, installed: false },
    });
    expect(gate.getState().installs.voiceInput?.percent).toBe(42);
  });

  it("配置还没读到（appConfig 为 null）：报 busy —— 不写开关、也不弹错误提示", async () => {
    // 已装好、但配置还没到：若往下走会落到 "写开关"，而那时我们并不知道用户的
    // 快捷键/自动整理设置（voiceEngine 是整对象替换）⇒ 报 busy 什么都不做。
    const gate = createCapabilityGate({
      hasBridge: () => true,
      readVoiceInstall: async () => readyInput.voiceInput,
      readTtsInstalls: async () => readyInput.voice,
      readOcrInstall: async () => readyInput.ocr,
      install: async () => {},
      enable: vi.fn(async () => true),
      getConfig: () => null,
      publish: vi.fn(),
      notifyFailure: vi.fn(),
      subscribe: () => () => {},
      queue: createInstallQueue(),
    });
    await expect(gate.ensureReady("voiceInput")).resolves.toBe("busy");
  });

  it("取消弹窗：丢掉该 id 的等待者（不让它变成一个永不 settle 的 promise）", async () => {
    let state: CapabilityInstalls = none;
    const { gate } = setup(() => state);
    await gate.ensureReady("voiceInput");

    const done = vi.fn();
    void gate.whenReady("voiceInput").then(done);
    // 用户答「不用了」
    gate.cancelPrompt();

    // 之后就算装好了，也不该再 resolve 那个等待者
    state = readyInput;
    await gate.refresh();
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
  });

  it("重启后不会卡在「等待中」：队列是内存态，rollback 只认 install.json", async () => {
    const { gate } = setup(() => none);
    await gate.refresh();
    expect(gate.getState().running).toBeNull();
    expect(gate.getState().positions).toEqual({});
  });
});
