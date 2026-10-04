import qq from "../../assets/brands/qq.svg";
import gmail from "../../assets/brands/gmail.svg";
import icloud from "../../assets/brands/icloud.svg";
import alibabacloud from "../../assets/brands/alibabacloud.svg";
import type { MailProviderId } from "../../../shared/mail-providers";

/**
 * 邮箱服务商 → 厂商图标 url。
 *
 * **只能放渲染层**：`shared/mail-providers.ts` 是主进程也要 import 的表，
 * 而 svg 的 asset import 只存在于渲染层产物里。
 *
 * 表写成完整的 `Record<MailProviderId, ...>`：以后往联合类型里加一家服务商，
 * 编译器会逼着在这里做决定，不会静默漏掉一格。
 *
 * 只有四家有图标（simple-icons 里的 QQ / Gmail / iCloud / Alibaba Cloud）。
 * 163 / 126 / 腾讯企业邮在上游没有对应图标 —— `neteasecloudmusic` 是网易云音乐，
 * 另一个产品，贴上去就是假标识。它们回落到预设表里的字母标记（`mark`）。
 *
 * 图标是打进仓库的资源（来源与许可见 `src/renderer/assets/brands/SOURCE.md`），
 * 运行时零网络请求。
 */
const MAIL_PROVIDER_ICONS: Record<MailProviderId, string | undefined> = {
  qq,
  gmail,
  icloud,
  aliyun: alibabacloud,
  "netease-163": undefined,
  "netease-126": undefined,
  exmail: undefined,
  custom: undefined,
};

/** 查不到图标（`custom`、非邮箱条目）返回 undefined，调用方画字母标记。 */
export function mailProviderIconUrl(
  id: MailProviderId | undefined,
): string | undefined {
  // 用 `Object.hasOwn` 而不是 `MAIL_PROVIDER_ICONS[id]` 的真值判断：`providerId` 是
  // 跨 JSON 边界来的（`mail.json` 手改/损坏时会给出任意字符串），而 `MailProviderId`
  // 只是断言不是校验 —— 后者会顺着原型链取到 `constructor` / `__proto__`，
  // 于是卡片把非字符串当真 url 画出一张坏图。同 brand-icons.tsx。
  if (!id || !Object.hasOwn(MAIL_PROVIDER_ICONS, id)) return undefined;
  return MAIL_PROVIDER_ICONS[id];
}
