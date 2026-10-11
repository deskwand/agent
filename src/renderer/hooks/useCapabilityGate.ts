/**
 * @module renderer/hooks/useCapabilityGate
 *
 * 订阅 store 切片 + 暴露单例 controller 的动作（与 `useReadAloud` 同形）。
 */
import {
  getCapabilityGate,
  type CapabilityGate,
} from "../capabilities/capability-gate";
import { useAppStore } from "../store";

export function useCapabilityGate(): ReturnType<CapabilityGate["getState"]> &
  Pick<
    CapabilityGate,
    | "refresh"
    | "ensureReady"
    | "whenReady"
    | "confirmDownload"
    | "cancelPrompt"
    | "startInstall"
  > {
  const state = useAppStore((s) => s.capabilityGate);
  // 懒构造的单例：第一次访问时才接线（那时桥与 store 都就绪）。
  const gate = getCapabilityGate();
  return {
    ...state,
    // 首帧的"读一次安装态"由消费方触发（首屏那块 onMount 调它）。
    refresh: gate.refresh,
    ensureReady: gate.ensureReady,
    whenReady: gate.whenReady,
    confirmDownload: gate.confirmDownload,
    cancelPrompt: gate.cancelPrompt,
    startInstall: gate.startInstall,
  };
}
