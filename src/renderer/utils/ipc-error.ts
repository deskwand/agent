/**
 * 主进程抛出的错误经 `ipcRenderer.invoke` 到手时被 Electron 包了一层：
 *
 *   `Error invoking remote method '<channel>': Error: <原始 message>`
 *
 * 渲染层是按 message 匹配错误码的（`VAULT_FILE_TOO_LARGE`、`VAULT_CLOUD_HTTP_5xx`
 * 之类），带着这层壳时 `===` 与 `startsWith` 全部落空 —— 结果是**每一条**主进程
 * 错误都退化成兜底文案（「云端同步失败，本地文件未受影响」），本地故障也被说成
 * 云端故障，用户拿不到任何可行动的信息。所以匹配前必须先剥壳。
 */
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/;
const ERROR_PREFIX = /^Error:\s*/;

export function ipcErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "";
  return error.message.replace(IPC_WRAPPER, "").replace(ERROR_PREFIX, "");
}
