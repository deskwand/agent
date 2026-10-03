import notion from "../../assets/brands/notion.svg";
import linear from "../../assets/brands/linear.svg";
import sentry from "../../assets/brands/sentry.svg";
import stripe from "../../assets/brands/stripe.svg";
import atlassian from "../../assets/brands/atlassian.svg";
import chrome from "../../assets/brands/chrome.svg";
import airtable from "../../assets/brands/airtable.svg";
import buffer from "../../assets/brands/buffer.svg";
import clickhouse from "../../assets/brands/clickhouse.svg";
import clerk from "../../assets/brands/clerk.svg";
import clickup from "../../assets/brands/clickup.svg";
import cloudflare from "../../assets/brands/cloudflare.svg";
import datadog from "../../assets/brands/datadog.svg";
import dropbox from "../../assets/brands/dropbox.svg";
import framer from "../../assets/brands/framer.svg";
import grafana from "../../assets/brands/grafana.svg";
import greenhouse from "../../assets/brands/greenhouse.svg";
import huggingface from "../../assets/brands/huggingface.svg";
import intercom from "../../assets/brands/intercom.svg";
import lucid from "../../assets/brands/lucid.svg";
import miro from "../../assets/brands/miro.svg";
import neon from "../../assets/brands/neon.svg";
import netlify from "../../assets/brands/netlify.svg";
import paypal from "../../assets/brands/paypal.svg";
import postman from "../../assets/brands/postman.svg";
import railway from "../../assets/brands/railway.svg";
import resend from "../../assets/brands/resend.svg";
import supabase from "../../assets/brands/supabase.svg";
import todoist from "../../assets/brands/todoist.svg";
import trello from "../../assets/brands/trello.svg";
import vercel from "../../assets/brands/vercel.svg";
import webflow from "../../assets/brands/webflow.svg";
import wix from "../../assets/brands/wix.svg";
import zapier from "../../assets/brands/zapier.svg";

/**
 * 连接器卡片头像的判定 —— 名字 → 画什么。
 *
 * **名字匹配只发生在这一个模块里**：卡片只消费结果，不写任何名字常量。将来加一家厂商、
 * 加一个自研服务，都只改这里（详见 design-docs/2026-10-02-connector-brand-icons-design.md）。
 *
 * 图标是**打进仓库**的一次性资源（`src/renderer/assets/brands/SOURCE.md` 记了来源与许可），
 * 运行时零网络请求：34 张图都低于 Vite 的 `assetsInlineLimit`，构建时会被内联成 data URI。
 *
 * 两类图形的实现方式**刻意不同**：
 *  - **厂商 logo 走 `<img>`**：图片自带配色，用不着页面的 `currentColor`
 *  - **自研图形必须内联 `<svg>`**：`<img src="*.svg">` 拿不到 `currentColor`，做成图片就
 *    永远是黑色，深色主题下看不见
 */

/** 厂商图标：按 server 名查（大小写不敏感）。目录条目的名字本来就等于 key，
 *  所以这一张表同时覆盖目录条目与 `Chrome` 这类非目录条目（用户 mcp.json 里的旧残留）。 */
const BRAND_ICONS: Record<string, string> = {
  notion,
  linear,
  sentry,
  stripe,
  atlassian,
  chrome,
  airtable,
  buffer,
  clickhouse,
  clerk,
  clickup,
  cloudflare,
  datadog,
  dropbox,
  framer,
  grafana,
  greenhouse,
  huggingface,
  intercom,
  lucid,
  miro,
  neon,
  netlify,
  paypal,
  postman,
  railway,
  resend,
  supabase,
  todoist,
  trello,
  vercel,
  webflow,
  wix,
  zapier,
};

/** DeskWand 自己的服务（名字来自 `BUILTIN_PRESETS`，大小写不敏感地比对） */
const FIRST_PARTY_NAMES = new Set(["gui_operate"]);

export type ServiceIcon =
  | { kind: "brand"; url: string }
  | { kind: "firstParty" }
  | undefined;

/** 按 server 名（大小写不敏感）判定该画什么；认不出返回 undefined，调用方回落首字母。 */
export function serviceIconFor(serverName: string): ServiceIcon {
  const key = serverName.trim().toLowerCase();
  // 用 `Object.hasOwn` 而不是 `BRAND_ICONS[key]` 的真值判断：后者会顺着原型链取到
  // `constructor` / `__proto__`，于是把 server 起成这两个名字的用户会拿到一个
  // **不是字符串**的「url」、画出一张坏图。`Record<string, string>` 的声明在那里是假的。
  if (Object.hasOwn(BRAND_ICONS, key)) {
    return { kind: "brand", url: BRAND_ICONS[key] };
  }
  if (FIRST_PARTY_NAMES.has(key)) return { kind: "firstParty" };
  return undefined;
}

/** 窗口轮廓 + 光标箭头。图形走 `currentColor`，由外层给 `text-accent` —— 做成 `<img>`
 *  就拿不到主题色了（这正是上面那段注释说的那件事）。 */
export function FirstPartyServiceIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-testid="first-party-icon"
    >
      <rect
        x="2.5"
        y="3.5"
        width="14"
        height="11.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M9.2 8.4 L9.2 18.2 L11.9 15.9 L13.5 19.8 L15.3 19.1 L13.7 15.3 L17 15 Z"
        fill="currentColor"
      />
    </svg>
  );
}
