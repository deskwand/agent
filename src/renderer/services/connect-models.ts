import type { DiagnosticInput, DiagnosticResult } from "../types";

/**
 * 连接流程的总体超时。主进程的诊断里 TCP / TLS 各 5s、认证 15s，
 * 但 DNS 那步（`dns.promises.lookup`）没有超时，所以在渲染层再兜一层，
 * 避免弹窗永远转圈。
 */
export const CONNECT_TIMEOUT_MS = 45000;

export class ConnectTimeoutError extends Error {
  constructor() {
    super("connect_timeout");
    this.name = "ConnectTimeoutError";
  }
}

export async function diagnoseProviderModels(
  input: DiagnosticInput,
): Promise<DiagnosticResult> {
  if (!window.electronAPI) {
    throw new Error("electronAPI unavailable");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      window.electronAPI.config.diagnose(input),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ConnectTimeoutError()),
          CONNECT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
