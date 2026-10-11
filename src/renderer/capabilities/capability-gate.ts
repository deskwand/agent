/**
 * @module renderer/capabilities/capability-gate
 *
 * 一处门：三个入口（首屏清单 / rail 与语音会话空态 / 消息朗读）在"要不要开始"
 * 之前问它。文件的下半是接真线的 controller 与模块单例（与 `useReadAloud.ts`
 * 同一个形状：纯逻辑与接线同文件，测试直接从同一文件 import factory）。
 *
 * 与显示状态的区别见 catalog.ts 的头注释：**这里安装优先** —— 没装就先问下载，
 * 确认之后才写开关（10-04 voice-inline-enable §0.5「确认在写配置之前」）。
 *
 * `ensureCapability` 是纯编排：所有副作用由 deps 注入，所以六格行为可以在没有
 * React、没有 Electron 的测试里逐格钉住。
 */
import { useAppStore } from "../store";
import {
  deriveCapabilityStates,
  type CapabilityConfigView,
  type CapabilityId,
  type CapabilityInstalls,
} from "./catalog";
import { createInstallQueue, type InstallQueue } from "./install-queue";
import type { TtsInstallStates } from "../../shared/ipc-types";

export type GateAction =
  | "proceed"
  | "enable"
  | "prompt"
  | "wait"
  | "unavailable";

export type EnsureOutcome =
  | "ready"
  | "cancelled"
  | "busy"
  | "failed"
  | "unsupported";

export interface EnsureDeps {
  hasBridge: boolean;
  getConfig: () => CapabilityConfigView | null;
  /** 必须已经是**最新**的：调用方先 refresh 过再调。 */
  readInstalls: () => CapabilityInstalls;
  /** 写开关。幂等：已经开着就返回 true。`voice` 没有开关 → 直接 true。 */
  enable: (id: CapabilityId) => Promise<boolean>;
  /** 把确认弹窗打开（宿主渲染）。 */
  openPrompt: (id: CapabilityId) => void;
  /** 写配置失败的那一条提示（由门自己发，避免某个入口漏接）。 */
  notifyFailure: () => void;
}

export function decideGateAction(
  id: CapabilityId,
  config: CapabilityConfigView | null,
  installs: CapabilityInstalls,
  hasBridge: boolean,
): GateAction {
  if (!hasBridge) return "unavailable";
  switch (deriveCapabilityStates(config, installs)[id]) {
    case "downloading":
    case "error":
      // 正在装、或上次失败：不重复问、也不重复下载。失败的重试在设置页或
      // 首屏那一行的「重试」里 —— 入口不承担这个动作。
      return "wait";
    case "ready":
      return "proceed";
    case "off":
      // 装了但开关没开：写开关就能用；没装则走 prompt（先问下载）。
      return isInstalled(id, installs) ? "enable" : "prompt";
    case "needsDownload":
      return "prompt";
  }
}

function isInstalled(id: CapabilityId, installs: CapabilityInstalls): boolean {
  switch (id) {
    case "voiceInput":
      return installs.voiceInput?.installed === true;
    case "voice":
      return (
        installs.voice?.zh?.installed === true ||
        installs.voice?.matcha?.installed === true
      );
    case "ocr":
      return installs.ocr?.installed === true;
  }
}

export async function ensureCapability(
  id: CapabilityId,
  deps: EnsureDeps,
): Promise<EnsureOutcome> {
  const action = decideGateAction(
    id,
    deps.getConfig(),
    deps.readInstalls(),
    deps.hasBridge,
  );
  switch (action) {
    case "unavailable":
      return "unsupported";
    case "wait":
      return "busy";
    case "proceed":
      return "ready";
    case "prompt":
      // 不 await 用户：这一次点击已经有结论（不开始），要不要下 140MB 是他
      // 回答弹窗的事。再点一次只是把弹窗摆回眼前，不会重复下载。
      deps.openPrompt(id);
      return "cancelled";
    case "enable": {
      const ok = await deps.enable(id);
      if (ok) return "ready";
      deps.notifyFailure();
      return "failed";
    }
  }
}

// ────────────────────────────────────────────────────────────────────
//  接线：装上真依赖的 controller + 全应用一个实例
// ────────────────────────────────────────────────────────────────────

export interface CapabilityGateState {
  installs: CapabilityInstalls;
  /** 确认弹窗该显示哪一行；null = 没弹窗。 */
  prompt: CapabilityId | null;
  /** 正在下载的那个（队列在飞）。 */
  running: CapabilityId | null;
  /** 排队位次，1 起。 */
  positions: Partial<Record<CapabilityId, number>>;
}

export interface CapabilityGateDeps {
  /** **函数而不是布尔值**：测试与运行时会换 `window.electronAPI`（桥可能晚一点才在）。 */
  hasBridge: () => boolean;
  readVoiceInstall: () => Promise<CapabilityInstalls["voiceInput"]>;
  readTtsInstalls: () => Promise<CapabilityInstalls["voice"]>;
  readOcrInstall: () => Promise<CapabilityInstalls["ocr"]>;
  install: (id: CapabilityId) => Promise<void>;
  /** 写开关。`voice` 没有开关 → 返回 true。 */
  enable: (id: CapabilityId) => Promise<boolean>;
  getConfig: () => CapabilityConfigView | null;
  publish: (patch: Partial<CapabilityGateState>) => void;
  /** 写配置失败的提示（全局 notice）。三个新入口共用这一条路径，宿主不用各接一遍。 */
  notifyFailure: () => void;
  /**
   * 三路安装事件。**事件直接落状态，不再回读 IPC** —— 下载中进度事件大约每
   * 100ms 一条，回读一次是三条 IPC，白白把主进程拖垮。
   * `apply` 收的是**部分** installs（只带变的那一路）。
   */
  subscribe: (
    apply: (patch: Partial<CapabilityInstalls>) => void,
  ) => () => void;
  queue: InstallQueue;
}

export interface CapabilityGate {
  getState: () => CapabilityGateState;
  refresh: () => Promise<void>;
  ensureReady: (id: CapabilityId) => Promise<EnsureOutcome>;
  /** 装好后 resolve；已经 ready 就立刻 resolve。用于「朗读装完自动开始」。 */
  whenReady: (id: CapabilityId) => Promise<void>;
  confirmDownload: () => Promise<void>;
  cancelPrompt: () => void;
  startInstall: (id: CapabilityId) => Promise<void>;
}

export function createCapabilityGate(deps: CapabilityGateDeps): CapabilityGate {
  let state: CapabilityGateState = {
    installs: { voiceInput: null, voice: null, ocr: null },
    prompt: null,
    running: null,
    positions: {},
  };
  /** 装好后要 resolve 的回调（朗读装完自动开始用它）。 */
  const waiters = new Map<CapabilityId, Set<() => void>>();

  const isReady = (id: CapabilityId): boolean => {
    const installs = state.installs;
    switch (id) {
      case "voiceInput":
        return installs.voiceInput?.installed === true;
      case "voice":
        return (
          installs.voice?.zh?.installed === true ||
          installs.voice?.matcha?.installed === true
        );
      case "ocr":
        return installs.ocr?.installed === true;
    }
  };

  const flushWaiters = () => {
    for (const [id, set] of waiters) {
      if (!isReady(id)) continue;
      waiters.delete(id);
      for (const resolve of set) resolve();
    }
  };

  const set = (patch: Partial<CapabilityGateState>) => {
    state = { ...state, ...patch };
    deps.publish(patch);
  };

  // 事件直落：下载中的百分比靠它才能动。
  deps.subscribe((patch) => {
    set({ installs: { ...state.installs, ...patch } });
    flushWaiters();
  });

  const syncQueue = () => {
    const positions: Partial<Record<CapabilityId, number>> = {};
    for (const id of ["voiceInput", "voice", "ocr"] as const) {
      const position = deps.queue.position(id);
      if (position !== null) positions[id] = position;
    }
    set({
      running: (deps.queue.running() as CapabilityId | null) ?? null,
      positions,
    });
  };
  deps.queue.subscribe(syncQueue);

  /** 一路的读取：**连同步抛一起包住**（`api.tts` 不存在时会在返回 promise 之前就抛）。 */
  const safe = async <T>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch {
      return null;
    }
  };

  const refresh = async (): Promise<void> => {
    // 三路各自独立：一路失败不该把另外两路抹成"未装"。
    const [voiceInput, voice, ocr] = await Promise.all([
      safe(deps.readVoiceInstall),
      safe(deps.readTtsInstalls),
      safe(deps.readOcrInstall),
    ]);
    set({ installs: { voiceInput, voice, ocr } });
    flushWaiters();
  };

  const runInstall = async (id: CapabilityId): Promise<void> => {
    // 先写开关再入队：装好那一刻 usePushToTalk 之类的开关才是开着的
    // （与 10-04 §2.1 的 confirmDownload 同一顺序）。
    const enabled = await deps.enable(id);
    if (!enabled) {
      deps.notifyFailure();
      return;
    }
    await deps.queue
      .enqueue(id, () => deps.install(id))
      .catch(() => {
        /* 失败态由 install 事件推回来，这里只负责不把 rejection 冒到全局 */
      });
    await refresh();
  };

  return {
    getState: () => state,
    refresh,
    async ensureReady(id) {
      // 先刷新：渲染层手里的 installs 可能是几秒前的快照。
      await refresh();
      // 配置还没读到（启动头几秒）：报 busy 而不是往下走 —— 往下走会落到
      // "写开关"，而那时我们并不知道用户的快捷键/自动整理设置，写下去就是重置它们；
      // 报 failed 又会弹一条莫名其妙的错误提示。busy = 什么都不做，等下一次点击。
      if (!deps.getConfig()) return "busy";
      const outcome = await ensureCapability(id, {
        hasBridge: deps.hasBridge(),
        getConfig: deps.getConfig,
        readInstalls: () => state.installs,
        enable: deps.enable,
        openPrompt: (prompt) =>
          // 已经开着另一个弹窗时**换掉**它：一次只可能有一个，而这一次点击是
          // 用户最新、最明确的意图。
          set({ prompt }),
        notifyFailure: deps.notifyFailure,
      });
      // 这一次点击没有走到「要不要下载」：把可能的陈旧弹窗收掉。
      // 单例 + store 之后弹窗状态会比某个组件活得长（宿主卸载、切会话），
      // 不清就会出现「没人渲染它，但 prompt 还是非空」。
      if (outcome !== "cancelled") set({ prompt: null });
      return outcome;
    },
    whenReady(id) {
      if (isReady(id)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const pending = waiters.get(id) ?? new Set<() => void>();
        pending.add(resolve);
        waiters.set(id, pending);
      });
    },
    async confirmDownload() {
      const id = state.prompt;
      if (!id) return;
      set({ prompt: null });
      await runInstall(id);
    },
    cancelPrompt: () => {
      const id = state.prompt;
      set({ prompt: null });
      // 用户说「不用了」：不该再有"装好之后自动开始"这回事 —— 把等待者丢掉，
      // 否则每点一次朗读再取消就永久留一个 waiter（连着卡片的闭包一起）。
      if (id) waiters.delete(id);
    },
    startInstall: (id) => runInstall(id),
  };
}

/** 三档的"什么都不知道"基线：事件合并的起点。 */
const EMPTY_TTS_STATES: TtsInstallStates = {
  zh: { phase: "idle", percent: 0, installed: false },
  en: { phase: "idle", percent: 0, installed: false },
  matcha: { phase: "idle", percent: 0, installed: false },
};

/**
 * 三路安装事件 → 只带回变化的那一路。三个 `onEvent` 都是订阅式的，返回一个汇总退订。
 *
 * `readCurrent` 给 TTS 那一路做按点合并：事件只带一个模型，直接把整份打回去会把
 * 另两档抹空；也**不回读 IPC** —— 进度事件每 ~100ms 一条，回读一次是三条 IPC。
 */
function subscribeInstalls(
  api: NonNullable<typeof window.electronAPI>,
  apply: (patch: Partial<CapabilityInstalls>) => void,
  readCurrent: () => TtsInstallStates,
): () => void {
  // 每一路都**单独判存在**：这个仓里的组件替身经常只挂自己用到的那几组 API
  //（`window.electronAPI = { voice: {...} }`），缺 `onEvent` 时直接调会抛 ——
  // 而订阅发生在**第一次渲染**，一抛就是整棵树挂掉。
  const offs: Array<() => void> = [];
  if (typeof api.voice?.onEvent === "function") {
    offs.push(
      api.voice.onEvent((event) => {
        if (event.type === "install") apply({ voiceInput: event.state });
      }),
    );
  }
  if (typeof api.tts?.onEvent === "function") {
    offs.push(
      api.tts.onEvent((event) => {
        if (event.type !== "install") return;
        apply({ voice: { ...readCurrent(), [event.model]: event.state } });
      }),
    );
  }
  if (typeof api.ocr?.onEvent === "function") {
    offs.push(
      api.ocr.onEvent((event) => {
        if (event.type === "install") apply({ ocr: event.state });
      }),
    );
  }
  return () => {
    for (const off of offs) off();
  };
}

function pushToStore(patch: Partial<CapabilityGateState>): void {
  useAppStore.getState().setCapabilityGate(patch);
}

function createDefaultGate(): CapabilityGate {
  const api = typeof window === "undefined" ? undefined : window.electronAPI;
  const queue = createInstallQueue();
  return createCapabilityGate({
    hasBridge: () => Boolean(api?.voice && api.tts && api.ocr),
    readVoiceInstall: async () =>
      api?.voice ? api.voice.getInstallState() : null,
    readTtsInstalls: async () => (api?.tts ? api.tts.getInstallState() : null),
    readOcrInstall: async () => (api?.ocr ? api.ocr.getInstallState() : null),
    install: async (id) => {
      if (!api) return;
      if (id === "voiceInput") await api.voice.install();
      else if (id === "voice") await api.tts.install("zh");
      else await api.ocr.install();
    },
    enable: async (id) => {
      if (id === "voice") return true; // 没有开关：朗读 always on
      const store = useAppStore.getState();
      const config = store.appConfig;
      try {
        if (id === "ocr") {
          if (config?.ocr?.enabled) return true;
          const saved = await api?.config.save({ ocr: { enabled: true } });
          if (saved?.config) store.setAppConfig(saved.config);
          return true;
        }
        const engine = config?.voiceEngine;
        if (engine?.enabled) return true;
        // 配置还没读到（启动头几秒）：**不写**。`config-store.update()` 对 voiceEngine 是
        // 整对象替换，这里若按自造默认值写下去，会把用户的快捷键 / 自动整理重置掉。
        if (!config) return false;
        const saved = await api?.config.save({
          voiceEngine: {
            ...(engine ?? {
              enabled: false,
              shortcut: "AltRight" as const,
              autoPolish: true,
            }),
            enabled: true,
          },
        });
        if (saved?.config) store.setAppConfig(saved.config);
        return true;
      } catch {
        return false;
      }
    },
    getConfig: () => useAppStore.getState().appConfig,
    publish: pushToStore,
    subscribe: (apply) => {
      // 桥不在（浏览器模式 / 单测）：空订阅。**惰性**是必需的 —— 单例在模块加载时
      // 就构造，那时 `window.electronAPI` 还没有，直接 `api!.voice.onEvent` 会抛
      // （测试就是在这个断言上红的）。
      if (!api) return () => {};
      return subscribeInstalls(
        api,
        apply,
        () =>
          useAppStore.getState().capabilityGate.installs.voice ??
          EMPTY_TTS_STATES,
      );
    },
    notifyFailure: () =>
      useAppStore.getState().setGlobalNotice({
        id: `capability-enable-failed-${Date.now()}`,
        message: "",
        messageKey: "chat.voiceEnableFailed",
        type: "error",
      }),
    queue,
  });
}

/**
 * 全应用一个实例（与 useReadAloud 同一个理由：多个实例就是多个弹窗、多条队列）。
 *
 * **懒构造**，不是模块加载时构造：真接线要读 `window.electronAPI`（并订阅三路事件），
 * 而模块可能先于桥存在 —— 单测里就是这样（jsdom 测试在 `beforeEach` 里才挂
 * `electronAPI`，模块加载早在那之前）。加载时构造会永久抓住一个 `undefined` 的桥。
 */
let singleton: CapabilityGate | null = null;

export function getCapabilityGate(): CapabilityGate {
  singleton ??= createDefaultGate();
  return singleton;
}
