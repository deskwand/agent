/**
 * 主流邮箱的 IMAP / SMTP 预设。
 *
 * 主机、端口、加密方式、控制台 URL 是**数据不是文案** —— 要交给连接流程用，
 * 所以不进 i18n；显示名、凭据叫法、引导文案进 i18n。与 key 型目录条目同一规则
 * （`CatalogAuth.consoleUrl` 是数据，`credentialLabelKey` 是 i18n）。
 *
 * `secure` **逐条显式写死**，不靠端口推断：vendor 的 `normalizeAccountConfig`
 * 用 `port === 465` 推 `smtp.secure`，而 iCloud 是 587 + STARTTLS —— 推断会得到错的期望。
 */
export type MailProviderId =
  | "qq"
  | "netease-163"
  | "netease-126"
  | "exmail"
  | "aliyun"
  | "gmail"
  | "icloud"
  | "custom";

export interface MailProviderEndpoint {
  host: string;
  port: number;
  /** true = 隐式 TLS（993 / 465）；false = STARTTLS（587） */
  secure: boolean;
}

export interface MailProvider {
  id: MailProviderId;
  /**
   * 卡片头像的两字标记。**零资产**的办法 —— 所有邮箱的 `serverName` 都是 "Mail"，
   * 按 serverName 取厂商图标只会让每个邮箱长得一样。厂商品牌图标见设计 §9。
   */
  mark: string;
  /** i18n key：显示名 */
  nameKey: string;
  /** i18n key：这家把凭据叫什么（授权码？应用专用密码？） */
  credentialLabelKey: string;
  /** i18n key：去哪拿凭据，以及这家的坑 */
  hintKey: string;
  /** 去建凭据的页面。**是数据不是文案**（要交给浏览器打开） */
  consoleUrl: string;
  /** `custom` 没有预设端点，由用户填 */
  imap?: MailProviderEndpoint;
  smtp?: MailProviderEndpoint;
  /** iCloud 专用：IMAP 用户名可能是地址 `@` 前的部分。见设计 §3.8 */
  tryLocalPartUser?: true;
}

/**
 * **顺序即对话框里的展示顺序**：国内常用在前，Gmail / iCloud 在中，自定义兜底在末。
 */
export const MAIL_PROVIDERS: readonly MailProvider[] = [
  {
    id: "qq",
    mark: "QQ",
    nameKey: "mail.provider.qq.name",
    credentialLabelKey: "mail.provider.qq.credential",
    hintKey: "mail.provider.qq.hint",
    consoleUrl: "https://mail.qq.com",
    imap: { host: "imap.qq.com", port: 993, secure: true },
    smtp: { host: "smtp.qq.com", port: 465, secure: true },
  },
  {
    id: "netease-163",
    mark: "163",
    nameKey: "mail.provider.netease-163.name",
    credentialLabelKey: "mail.provider.netease-163.credential",
    hintKey: "mail.provider.netease-163.hint",
    consoleUrl: "https://mail.163.com",
    imap: { host: "imap.163.com", port: 993, secure: true },
    smtp: { host: "smtp.163.com", port: 465, secure: true },
  },
  {
    id: "netease-126",
    mark: "126",
    nameKey: "mail.provider.netease-126.name",
    credentialLabelKey: "mail.provider.netease-126.credential",
    hintKey: "mail.provider.netease-126.hint",
    consoleUrl: "https://mail.126.com",
    imap: { host: "imap.126.com", port: 993, secure: true },
    smtp: { host: "smtp.126.com", port: 465, secure: true },
  },
  {
    id: "exmail",
    mark: "企",
    nameKey: "mail.provider.exmail.name",
    credentialLabelKey: "mail.provider.exmail.credential",
    hintKey: "mail.provider.exmail.hint",
    consoleUrl: "https://exmail.qq.com",
    imap: { host: "imap.exmail.qq.com", port: 993, secure: true },
    smtp: { host: "smtp.exmail.qq.com", port: 465, secure: true },
  },
  {
    id: "aliyun",
    mark: "阿",
    nameKey: "mail.provider.aliyun.name",
    credentialLabelKey: "mail.provider.aliyun.credential",
    hintKey: "mail.provider.aliyun.hint",
    consoleUrl: "https://mail.aliyun.com",
    imap: { host: "imap.qiye.aliyun.com", port: 993, secure: true },
    smtp: { host: "smtp.qiye.aliyun.com", port: 465, secure: true },
  },
  {
    id: "gmail",
    mark: "G",
    nameKey: "mail.provider.gmail.name",
    credentialLabelKey: "mail.provider.gmail.credential",
    hintKey: "mail.provider.gmail.hint",
    consoleUrl: "https://myaccount.google.com/apppasswords",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
  {
    id: "icloud",
    mark: "iC",
    nameKey: "mail.provider.icloud.name",
    credentialLabelKey: "mail.provider.icloud.credential",
    hintKey: "mail.provider.icloud.hint",
    consoleUrl: "https://account.apple.com",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    // 587 + STARTTLS。**不能靠端口推断** —— 见文件头。
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    tryLocalPartUser: true,
  },
  {
    id: "custom",
    mark: "＋",
    nameKey: "mail.provider.custom.name",
    credentialLabelKey: "mail.provider.custom.credential",
    hintKey: "mail.provider.custom.hint",
    consoleUrl: "https://mail.163.com",
  },
];

export function findMailProvider(id: string): MailProvider | undefined {
  return MAIL_PROVIDERS.find((p) => p.id === id);
}
