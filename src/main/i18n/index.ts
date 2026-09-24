import { app } from "electron";

/**
 * Main-process message table.
 *
 * The renderer is the single source of truth for the language: it reports the
 * normalized locale through the `i18n.setLocale` client event and the main
 * process only mirrors it. Nothing is persisted here.
 */

export type Locale = "zh" | "en";

type MessageTable = Record<string, string>;

const MSG: Record<Locale, MessageTable> = {
  zh: {
    // ── goal ──
    "goal.noActiveGoal": "没有活跃的目标。",
    "goal.noGoalToPause": "没有可暂停的目标。",
    "goal.noGoalToResume": "没有可恢复的目标。",
    "goal.noGoalToClear": "没有可清除的目标。",
    "goal.alreadyActive": "目标已在执行中。",
    "goal.started": "目标已启动: {{objective}}{{budget}}",
    "goal.paused": "目标已暂停: {{objective}}",
    "goal.resumed": "目标已恢复: {{objective}}",
    "goal.resumedAtCap":
      "目标已恢复: {{objective}}。已达 {{max}} 轮上限，恢复后计数重新开始",
    "goal.cleared": "目标已清除。",
    "goal.needObjective": "请提供一个目标描述。",
    "goal.goalIsStatus":
      "目标状态为 {{status}}，请用 /goal <目标> 创建新目标。",
    "goal.statusActive": "🎯 执行中 (第{{n}}轮): {{objective}}{{budget}}",
    "goal.statusPaused": "⏸ 已暂停: {{objective}}",
    "goal.statusComplete": "✅ 已完成: {{objective}}",
    "goal.statusBlocked": "🚫 已阻塞: {{objective}}",
    "goal.statusBudgetLimited": "💸 预算耗尽: {{objective}}{{budget}}",
    "goal.summaryComplete": "目标完成",
    "goal.summaryBlocked": "目标阻塞",
    "goal.summaryCompleteStats": "{{n}} 轮 · {{time}} · {{tokens}}",
    "goal.summaryBlockedStats": "{{n}} 轮 · {{time}}",
    "goal.seconds": "{{n}} 秒",
    "goal.secondsOne": "{{n}} 秒",
    "goal.minutes": "{{n}} 分钟",
    "goal.minutesOne": "{{n}} 分钟",
    "goal.hours": "{{n}} 小时",
    "goal.hoursOne": "{{n}} 小时",
    "goal.hoursMinutes": "{{h}} 小时 {{m}} 分钟",
    "goal.tokensTenThousands": "{{n}}万 tokens",

    // ── model error messages ──
    "errors.modelTimeout": "模型响应超时，请稍后重试或检查模型/网关负载。",
    "errors.emptyResult":
      "模型返回空结果，可能是兼容性问题，请重试或切换协议。",
    "errors.badRequest":
      "请求被拒绝（400），请检查模型名称、协议和 API 端点。\n原始错误: {{error}}",
    "errors.authFailed":
      "认证失败，请检查 API Key 是否正确或已过期。\n原始错误: {{error}}",
    "errors.rateLimited":
      "请求被限流（429），请稍后重试。\n原始错误: {{error}}",
    "errors.upstreamError":
      "上游服务异常，正在自动重试，请稍候...\n原始错误: {{error}}",
    "errors.networkInterrupted": "网络连接中断，正在自动重试，请稍候...",
    "errors.checkConfig": "_请检查配置后重试。_",
    "errors.subscriptionDisconnected": "{{name}} 已断开，请重新选择模型。",
    "errors.subscriptionInvalid":
      "{{name}} 的端点、协议或模型与订阅配置不符，请重新配置。",
    "errors.retrying": "_Agent 正在自动重试，请稍候..._",
    "errors.requestTimeout": "请求超时，请检查网络连接后重试",
    "errors.bundledNodeMissing":
      "未找到内置的 Node.js。请重新安装应用。\n\n应用需要内置的 Node.js 来运行 MCP 服务器。",
    "errors.chromeNotReady": "Chrome 浏览器未就绪，无法执行此操作: {{detail}}",
    "errors.startupFailedTitle": "DeskWand 启动失败",
    "errors.startupFailedDetail": "{{message}}\n\n请查看日志获取更多信息。",
    "errors.configRequiredActiveSet":
      "当前方案未配置可用凭证，请先在 API 设置中完成配置",
    "errors.forkSessionNotFound": "会话不存在",
    "errors.forkPointNotFound": "分叉点消息不存在",
    "errors.forkAssistantOnly": "仅支持从助手消息分叉",
    "errors.forkNoJsonl": "源会话无 JSONL 文件，无法分叉（需先回填存量数据）",
    "errors.forkPointUnresolved": "分叉失败：无法在会话历史中定位分叉点",
    "errors.forkHistoryExtractFailed": "分叉失败：无法从源会话文件提取历史",

    // ── OAuth ──
    "oauth.openBrowser": "打开浏览器",
    "oauth.continue": "继续",
    "oauth.cancel": "取消",
    "oauth.deviceCodeTitle": "设备验证码",
    "oauth.deviceCodeDetail":
      "验证码已复制到剪贴板，将打开浏览器窗口，粘贴验证码即可完成登录。",
    "oauth.verificationCode": "您的验证码：{{code}}",
    "oauth.githubEnterpriseDetail": "个人账号留空，默认使用 github.com",
    "oauth.loginSuccessPage":
      "<h2>登录成功 ✅</h2><p>请返回 DeskWand 应用</p></body></html>",
    "oauth.loginCancelledPage":
      "<h2>授权已取消</h2><p>请关闭此页面并返回应用</p></body></html>",
    "oauth.userCancelled": "用户取消授权",
    "oauth.timeout": "授权超时",

    // ── background subagent ──
    "agent.backgroundAgentDone":
      "[系统通知] 后台子代理 {{agentId}} 已完成。请调用 get_subagent_result 获取结果并汇总给用户。",

    // ── remote channels ──
    "feishu.unsupportedMessageType": "[不支持的消息类型: {{type}}]",
  },
  en: {
    // ── goal ──
    "goal.noActiveGoal": "No active goal.",
    "goal.noGoalToPause": "No active goal to pause.",
    "goal.noGoalToResume": "No goal to resume.",
    "goal.noGoalToClear": "No goal to clear.",
    "goal.alreadyActive": "Goal is already active.",
    "goal.started": "Goal started: {{objective}}{{budget}}",
    "goal.paused": "Goal paused: {{objective}}",
    "goal.resumed": "Goal resumed: {{objective}}",
    "goal.resumedAtCap":
      "Goal resumed: {{objective}}. Reached the {{max}}-turn cap; counting restarts",
    "goal.cleared": "Goal cleared.",
    "goal.needObjective": "Please provide a goal objective.",
    "goal.goalIsStatus":
      "Goal is {{status}}; start a new one with /goal <objective>.",
    "goal.statusActive": "🎯 Goal active (turn {{n}}): {{objective}}{{budget}}",
    "goal.statusPaused": "⏸ Goal paused: {{objective}}",
    "goal.statusComplete": "✅ Goal complete: {{objective}}",
    "goal.statusBlocked": "🚫 Goal blocked: {{objective}}",
    "goal.statusBudgetLimited":
      "💸 Goal budget exhausted: {{objective}}{{budget}}",
    "goal.summaryComplete": "Goal Complete",
    "goal.summaryBlocked": "Goal Blocked",
    "goal.summaryCompleteStats": "{{n}} turns · {{time}} · {{tokens}}",
    "goal.summaryBlockedStats": "{{n}} turns · {{time}}",
    "goal.seconds": "{{n}} seconds",
    "goal.secondsOne": "1 second",
    "goal.minutes": "{{n}} minutes",
    "goal.minutesOne": "1 minute",
    "goal.hours": "{{n}} hours",
    "goal.hoursOne": "1 hour",
    "goal.hoursMinutes": "{{h}}h {{m}}m",
    "goal.tokensTenThousands": "{{k}}K tokens",

    // ── model error messages ──
    "errors.modelTimeout":
      "Model response timed out. Please retry or check the model/gateway load.",
    "errors.emptyResult":
      "Model returned empty result. Possible compatibility issue. Please retry or switch protocol.",
    "errors.badRequest":
      "Request rejected (400). Check model name, protocol and API endpoint.\nOriginal error: {{error}}",
    "errors.authFailed":
      "Authentication failed. Check if your API key is correct or has expired.\nOriginal error: {{error}}",
    "errors.rateLimited":
      "Rate limited (429). Please retry later.\nOriginal error: {{error}}",
    "errors.upstreamError":
      "Upstream service error. Retrying, please wait...\nOriginal error: {{error}}",
    "errors.networkInterrupted":
      "Network interrupted. Retrying, please wait...",
    "errors.checkConfig": "_Please check your configuration and retry._",
    "errors.subscriptionDisconnected":
      "{{name}} is disconnected. Select another model.",
    "errors.subscriptionInvalid":
      "{{name}} has an invalid subscription endpoint, protocol or model. Reconfigure it.",
    "errors.retrying": "_Retrying automatically, please wait..._",
    "errors.requestTimeout":
      "Request timed out. Check your network connection and retry.",
    "errors.bundledNodeMissing":
      "Bundled Node.js not found. Please reinstall the application.\n\nThe application requires bundled Node.js to run MCP servers.",
    "errors.chromeNotReady":
      "Chrome is not ready; cannot run this action: {{detail}}",
    "errors.startupFailedTitle": "DeskWand failed to start",
    "errors.startupFailedDetail":
      "{{message}}\n\nCheck the logs for more information.",
    "errors.configRequiredActiveSet":
      "The current config set does not have usable credentials. Finish setup in API Settings first.",
    "errors.forkSessionNotFound": "Session not found",
    "errors.forkPointNotFound": "Fork point message not found",
    "errors.forkAssistantOnly":
      "Only assistant messages can be used as a fork point",
    "errors.forkNoJsonl":
      "Source session has no JSONL file, cannot fork (backfill of existing data required first)",
    "errors.forkPointUnresolved":
      "Fork failed: could not locate the fork point in session history",
    "errors.forkHistoryExtractFailed":
      "Fork failed: could not extract history from the source session file",

    // ── OAuth ──
    "oauth.openBrowser": "Open Browser",
    "oauth.continue": "Continue",
    "oauth.cancel": "Cancel",
    "oauth.deviceCodeTitle": "Device Code",
    "oauth.deviceCodeDetail":
      "The code has been copied to your clipboard. A browser window will open — paste the code there to complete login.",
    "oauth.verificationCode": "Your verification code: {{code}}",
    "oauth.githubEnterpriseDetail":
      "Leave blank for personal github.com account.",
    "oauth.loginSuccessPage":
      "<h2>Logged in ✅</h2><p>Return to the DeskWand app</p></body></html>",
    "oauth.loginCancelledPage":
      "<h2>Authorization cancelled</h2><p>Close this page and return to the app</p></body></html>",
    "oauth.userCancelled": "User cancelled authorization",
    "oauth.timeout": "Authorization timed out",

    // ── background subagent ──
    "agent.backgroundAgentDone":
      "[System notice] Background subagent {{agentId}} finished. Call get_subagent_result to fetch the result and summarize it for the user.",

    // ── remote channels ──
    "feishu.unsupportedMessageType": "[Unsupported message type: {{type}}]",
  },
};

let currentLocale: Locale | undefined;

/** Key sets per locale, exported so tests can assert parity and key resolution. */
export const MSG_KEYS: Record<Locale, readonly string[]> = {
  zh: Object.keys(MSG.zh),
  en: Object.keys(MSG.en),
};

/** Called by the `i18n.setLocale` branch of handleClientEvent; undefined resets. */
export function setLocale(locale: Locale | undefined): void {
  // The IPC payload is untrusted: only "zh" / "en" are accepted, anything else
  // counts as "not reported yet". Without this check an invalid value makes
  // MSG[locale] undefined inside t() and throws.
  currentLocale = locale === "zh" || locale === "en" ? locale : undefined;
}

export function getLocale(): Locale {
  if (currentLocale) return currentLocale;
  try {
    return (app.getLocale() ?? "en").startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function t(
  key: string,
  params?: Record<string, string | number>,
): string {
  const tpl = MSG[getLocale()][key] ?? MSG.en[key] ?? key;
  if (!params) return tpl;
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{{${k}}}`,
  );
}
