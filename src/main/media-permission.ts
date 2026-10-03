/**
 * @module main/media-permission
 *
 * 决定「这个媒体权限请求该不该放行」。
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
