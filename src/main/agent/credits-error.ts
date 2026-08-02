/**
 * 服务端 402 响应经 pi-ai 折叠进错误文本（status + JSON body），文本匹配为主路径
 */
export function detectInsufficientCredits(text: string): boolean {
  return text.includes("INSUFFICIENT_CREDITS");
}

function safeStringify(value: unknown, space = 0): string {
  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return `[Unserializable: ${details}]`;
  }
}

/**
 * 把任意 unknown 错误归一成文本（原实现位于 agent-runner.ts，行为保持一致；
 * 提取到此处以便在 node 测试环境中直接导入，避免牵动 electron 依赖链）
 */
export function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  const serialized = safeStringify(error);
  if (serialized.startsWith("[Unserializable:")) {
    return String(error);
  }
  return serialized;
}
