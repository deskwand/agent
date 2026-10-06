/**
 * @module main/engine/engine-host
 *
 * 引擎的门面：把清单、安装器、监督器、桥接合成一个对象交给 IPC。
 *
 * 为什么要这一层：IPC 需要问好几个不同的问题（装了没 / 能不能用 / 预检挡在哪 /
 * 装 / 删 / 说一句）。让它自己 import 四五个模块再拼，测试就得同时替身四个东西；
 * 这里只暴露 `EngineHost`，替身一个对象就够。
 *
 * **可用性只有这一处判据**（`available()`）：IPC 的"走引擎还是回退均衡"、设置页
 * 的灰不灰，都问它。判据写两遍，就会有一遍忘掉某个分支。
 */
import type { EngineBlockedReason } from "../../shared/engine-install";
import {
  readRuntimeSpec,
  runtimeKey,
  type TtsEngineSpec,
} from "../speech/runtime-spec";
import {
  installEngine,
  isEngineInstalled,
  preflightEngine,
  removeEngine,
} from "./engine-installer";
import {
  disposeEngineSupervisor,
  getEngineSupervisor,
  type EngineStatus,
  type EngineSupervisor,
} from "./engine-supervisor";
import { speakViaEngine, type EngineStreamOptions } from "./engine-bridge";
import { warmupEngine } from "./engine-warmup";
import { log } from "../utils/logger";

export interface EngineInstallProgress {
  onProgress: (percent: number) => void;
  onPhase?: (phase: "checking" | "downloading" | "installing") => void;
  signal?: AbortSignal;
}

export interface EngineHost {
  /** 三件（二进制 + 两个模型）都在盘上。 */
  installed(): boolean;
  /** 能用：装了 && 平台在矩阵内 && 没被判 failed。 */
  available(): boolean;
  status(): EngineStatus;
  /** 预检挡在哪；没挡就是 undefined。 */
  blockedReason(): EngineBlockedReason | undefined;
  install(progress: EngineInstallProgress): Promise<void>;
  remove(): void;
  warmup(): Promise<void>;
  speak(
    opts: EngineStreamOptions,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

export function createEngineHost(
  userDataPath: string,
  deps?: {
    spec?: TtsEngineSpec;
    supervisor?: EngineSupervisor;
    /** 注入以便测试：默认走真实桥接。 */
    speak?: typeof speakViaEngine;
  },
): EngineHost {
  // 清单只读一次：进程生命周期里它不会变（注意 spec 可能是 undefined = 没发布）
  const spec =
    "spec" in (deps ?? {}) ? deps?.spec : readRuntimeSpec().ttsEngine;
  const platformKey = runtimeKey();
  const supervisor = (): EngineSupervisor =>
    deps?.supervisor ?? getEngineSupervisor();
  const installed = () => isEngineInstalled(userDataPath, spec);

  return {
    installed,
    available() {
      if (!spec) return false;
      if (!spec.artifactUrl[platformKey]) return false;
      if (!spec.artifactSha256[platformKey]) return false; // 产物没上传 = 不可用
      if (!installed()) return false;
      return supervisor().status() !== "failed";
    },
    status: () => supervisor().status(),
    blockedReason() {
      const pre = preflightEngine({ userDataPath, spec, platformKey });
      return pre.ok ? undefined : pre.reason;
    },
    async install(progress) {
      if (!spec) throw new Error("engine not published in manifest");
      await installEngine({
        userDataPath,
        spec,
        platformKey,
        onProgress: progress.onProgress,
        onPhase: progress.onPhase,
        signal: progress.signal,
        // 真实预热：起进程 + 合成一句自检，失败即回滚（见 engine-warmup）
        warmup: () => warmupEngine(),
      });
    },
    remove() {
      // 先停进程：Windows 上被占用的文件删不掉
      try {
        supervisor().stop();
      } catch {
        // 从来没起来过（清单缺字段）也会走到这里，不是错误
      }
      removeEngine(userDataPath);
      log("[TtsEngine] removed");
    },
    warmup: () => warmupEngine(),
    speak: (opts) =>
      (deps?.speak ?? speakViaEngine)(opts, { supervisor: supervisor() }),
  };
}

let singleton: EngineHost | null = null;

export function getEngineHost(userDataPath: string): EngineHost {
  return (singleton ??= createEngineHost(userDataPath));
}

/** 应用退出时调用：别把 2.7GB 的进程留在用户机器上。 */
export function disposeEngineHost(): void {
  disposeEngineSupervisor();
  singleton = null;
}
