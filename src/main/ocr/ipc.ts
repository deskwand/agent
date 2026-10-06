/**
 * @module main/ocr/ipc
 *
 * OCR 的通道：一个安装单元（运行时 + 模型）、一个自检、一个删除。
 * 与语音/朗读分开注册（`ocr.*`），开关与安装状态各自独立。
 */
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import type { OcrEvent, OcrInstallState } from "../../shared/ipc-types";
import {
  installOcr as realInstallOcr,
  isInstalled as realIsInstalled,
  modelDir,
  readSpec as realReadSpec,
  removeOcr as realRemoveOcr,
  runtimeDir,
  runtimeKey,
  type OcrInstallOptions,
  type OcrRuntimeSpec,
} from "./installer";
import { getOcrEngine, releaseOcrEngine, type OcrEngine } from "./engine";
import { logError } from "../utils/logger";

/** 64×64 纯白 PNG（98 字节）。自检用它跑一次推理，不需要字体，也不会随平台变。 */
export const BLANK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAAAAACPAi4CAAAAKUlEQVR42u3MQREAAAwCIPuX1hD77SAA6VEEAoFAIBAIBAKBQCAQfA8Gpwvw4qrwDDIAAAAASUVORK5CYII=";

/**
 * 装完立刻加载模型跑一次空图：平台不兼容、文件不全、ORT 与模型对不上，都要在**安装时**
 * 暴露，不能等用户第一次识别才发现。它只证明「能跑」，不证明「认得准」——后者由集成测试管。
 *
 * 顺带完成预热：会话建好之后就不销毁了，第一次识别因此不必再等初始化。
 */
export async function selfCheckOcr(userDataPath: string): Promise<void> {
  const engine: OcrEngine = await getOcrEngine({
    runtimeDir: runtimeDir(userDataPath),
    modelDir: modelDir(userDataPath),
  });
  const sample = join(tmpdir(), `ocr-selfcheck-${process.pid}.png`);
  writeFileSync(sample, Buffer.from(BLANK_PNG_BASE64, "base64"));
  try {
    await engine.recognize(sample);
  } finally {
    rmSync(sample, { force: true });
  }
}

export interface OcrIpcDeps {
  ipcMain: IpcMain;
  userDataPath: string;
  sendEvent: (event: OcrEvent) => void;
  /** 注入以便测试。 */
  install?: (opts: OcrInstallOptions) => Promise<void>;
  isInstalled?: (userDataPath: string) => boolean;
  remove?: (userDataPath: string) => void;
  selfCheck?: (userDataPath: string) => Promise<void>;
  /** 注入以便测试：否则单测会去读真实的 resources/ocr-runtime.json。 */
  readSpec?: () => OcrRuntimeSpec;
}

export interface OcrIpcHandle {
  dispose(): void;
}

const CHANNELS = [
  "ocr.getInstallState",
  "ocr.install",
  "ocr.removeInstall",
] as const;

export function registerOcrIpc(deps: OcrIpcDeps): OcrIpcHandle {
  const install = deps.install ?? realInstallOcr;
  const checkInstalled = deps.isInstalled ?? realIsInstalled;
  const remove = deps.remove ?? realRemoveOcr;
  const selfCheck = deps.selfCheck ?? selfCheckOcr;
  const readSpec = deps.readSpec ?? realReadSpec;

  let installing = false;
  // 只算一次：三次调用同一个函数是三倍的 IO，而且看起来像笔误
  const installedAtBoot = checkInstalled(deps.userDataPath);
  let state: OcrInstallState = {
    phase: installedAtBoot ? "ready" : "idle",
    percent: installedAtBoot ? 100 : 0,
    installed: installedAtBoot,
  };

  const publish = (next: OcrInstallState) => {
    state = next;
    deps.sendEvent({ type: "install", state: next });
  };

  deps.ipcMain.handle("ocr.getInstallState", () => {
    // 文件是外部可变的：用户能删目录、杀毒软件能隔离、盘能写坏。
    // 下载/解包进行中不动（那是本进程自己的状态），其余情况每次重新核对，
    // 否则面板会显示一个已经不存在的运行时，而工具那边已经不注册了。
    if (state.phase === "downloading" || state.phase === "extracting")
      return state;
    const installed = checkInstalled(deps.userDataPath);
    if (installed)
      return (state = { phase: "ready", percent: 100, installed: true });
    // 上一次失败的原因要留着，用户才能看到「下载失败」而不是静默回到未安装
    if (state.phase === "error") return state;
    return (state = { phase: "idle", percent: 0, installed: false });
  });

  deps.ipcMain.handle("ocr.install", async () => {
    if (installing || checkInstalled(deps.userDataPath)) return;
    installing = true;
    publish({ phase: "downloading", percent: 0, installed: false });
    try {
      const spec = readSpec();
      await install({
        userDataPath: deps.userDataPath,
        runtimeUrl: spec.runtimeUrl[runtimeKey()] ?? "",
        runtimeSha256: spec.runtimeSha256[runtimeKey()] ?? "",
        modelUrl: spec.modelUrl,
        modelSha256: spec.modelSha256,
        onProgress: (percent) =>
          publish({ phase: "downloading", percent, installed: false }),
        onPhase: (phase) =>
          publish({ phase, percent: state.percent, installed: false }),
      });
      await selfCheck(deps.userDataPath);
      publish({ phase: "ready", percent: 100, installed: true });
    } catch (error) {
      // 自检失败也要撤：清单里写着「已装」而实际用不了，用户没有任何入口修它
      try {
        remove(deps.userDataPath);
        releaseOcrEngine();
      } catch (cleanupError) {
        logError("[Ocr] rollback failed:", cleanupError);
      }
      publish({
        phase: "error",
        percent: 0,
        installed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      installing = false;
    }
  });

  deps.ipcMain.handle("ocr.removeInstall", () => {
    remove(deps.userDataPath);
    releaseOcrEngine();
    publish({ phase: "idle", percent: 0, installed: false });
  });

  return {
    dispose() {
      for (const channel of CHANNELS) deps.ipcMain.removeHandler(channel);
    },
  };
}
