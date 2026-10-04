/**
 * @module main/media-permission
 *
 * 决定「这个权限请求该不该放行」—— 媒体、剪贴板都在这里定。
 *
 * 为什么抽成纯函数：这是**安全边界** —— 自身窗口 vs 任意窗口、音频 vs 摄像头 ——
 * 而它原本内联在 `index.ts` 的 `app.whenReady()` 里。那里 import 就会启动整个应用，
 * 单测够不到，所以这段判定一直没有覆盖。
 *
 * 它还依赖一个**跨 Electron 版本会变**的输入：`details.mediaTypes`。拿不准的时候
 * 应当拒绝，因为「错误地拒绝」只是用户看到录音不可用，「错误地放行」是把摄像头
 * 交给渲染层里的任意代码。
 */
export interface MediaRequestInput {
  /** 发起请求的 webContents 是否就是主窗口那个。 */
  isOwnWindow: boolean;
  /** Electron 的 permission 名（"media" / "notifications" / …）。 */
  permission: string;
  /** `details.mediaTypes`。只有 `media` 权限会带；拿不到时传 undefined。 */
  mediaTypes?: unknown;
}

/**
 * 只放行**自身窗口**的**纯音频**请求。
 *
 * - 别人的窗口一律拒：这个应用没有把麦克风借给外部页面的场景。
 * - 摄像头一律拒：同上，而且它比麦克风敏感得多。
 * - `mediaTypes` 缺失或为空一律拒：这是「拿不准就不放行」。
 */
export function allowMediaRequest({
  isOwnWindow,
  permission,
  mediaTypes,
}: MediaRequestInput): boolean {
  if (!isOwnWindow) return false;
  if (permission !== "media") return false;
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) return false;
  return mediaTypes.every((type) => type === "audio");
}

/**
 * 剪贴板的 permission 名。Electron 把 `navigator.clipboard.read*` 和 `write*` 的
 * 请求都送进同一个 handler，名字有两种：35 上读和写都报 `clipboard-read`，
 * `clipboard-sanitized-write` 是别的版本上写请求的名字。两个都算剪贴板。
 */
const CLIPBOARD_PERMISSIONS: readonly string[] = [
  "clipboard-read",
  "clipboard-sanitized-write",
];

/**
 * 只放行**自身窗口**的剪贴板请求。
 *
 * 为什么必须显式放行：这个 handler 一装上就**替代**了 Electron 的默认策略，
 * 而默认策略是放行的（实测：不装 handler 时 `readText` / `writeText` 都成功）。
 * 不发话等于把渲染层的剪贴板整个判死 —— 表现就是消息复制、代码块复制、图片
 * 预览里的复制全都「点了没反应」，且 `catch` 里往往什么都看不见。
 *
 * Electron 35 上读和写共用一个权限名，所以这里放行的是剪贴板整体：渲染层能读
 * 也能写。
 *
 * 读也要一起放 —— 这是**有意接受**的，不是疏漏：相对「不装 handler」的默认策略，
 * 放行面没有变大（默认本来就允许读，实测 readText 成功）；相对修复前的全拒状态，
 * 它确实多给了读，而 Electron 35 表达不出「只放行写」（读、写、写图片三个动作
 * 实测都报 `clipboard-read`）。今天渲染层一处都没调过 `readText`；真要写-only，
 * 只能绕开渲染层、走主进程 `clipboard` 的 IPC（代价：新增 preload/IPC 面 + 改 6 个文件
 * 里 7 处调用），留待单独决策。
 *
 * 别人的窗口仍一律拒：外部内容没有读剪贴板的场景。
 */
export function allowClipboardRequest({
  isOwnWindow,
  permission,
}: MediaRequestInput): boolean {
  if (!isOwnWindow) return false;
  return CLIPBOARD_PERMISSIONS.includes(permission);
}

/** 一次权限请求的判定：媒体归 `allowMediaRequest`，剪贴板归 `allowClipboardRequest`。 */
export function allowPermissionRequest(input: MediaRequestInput): boolean {
  return allowMediaRequest(input) || allowClipboardRequest(input);
}
