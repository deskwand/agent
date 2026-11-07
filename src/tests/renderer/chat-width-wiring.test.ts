// 「消息区宽度」的接线不变量：默认值只有一处真源、IPC 白名单别漏、读配置要归一、
// 五处列宽容器都接上同一个 helper。
//
// 与 accent-wiring.test.ts 同一做法：源码断言。这些是「少一行就静默失效」的接线
//（少一个 IPC 分支 = 点得动、落不了盘），不值得为它们起一套 main 进程 harness。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const store = read("src/renderer/store/index.ts");
const useIPC = read("src/renderer/hooks/useIPC.ts");
const configStore = read("src/main/config/config-store.ts");
const mainIndex = read("src/main/index.ts");
const chatView = read("src/renderer/components/ChatView.tsx");
const settingsGeneral = read(
  "src/renderer/components/settings/SettingsGeneral.tsx",
);
const welcomeView = read("src/renderer/components/WelcomeView.tsx");

// 断言前先削掉整行注释：否则「注释掉那一行」也能让 substring 断言通过 ——
// 而这两处恰恰是少一行就静默失效的接线。
const stripLineComments = (src: string) =>
  src
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");

describe("消息区宽度接线", () => {
  it("渲染层与主进程都用共享默认值（老配置缺字段时不乱猜）", () => {
    expect(store).toMatch(/chatWidth: DEFAULT_CHAT_WIDTH/);
    expect(configStore).toMatch(/chatWidth: DEFAULT_CHAT_WIDTH/);
    // 主进程的持久化与投影两条路径都要带上
    expect(configStore).toMatch(
      /chatWidth: normalizeChatWidth\(stored\.chatWidth\)/,
    );
    expect(configStore).toMatch(/isChatWidth\(updates\.chatWidth\)/);
  });

  it("IPC 入口有独立的 chatWidth 分支（少了它就是「点得动、落不了盘」）", () => {
    // src/main/index.ts 的 settings.update 是逐字段白名单，没有 catch-all。
    // 用行首锚点 + 去注释，避免「注释掉那一行」也让断言变绿。
    const live = stripLineComments(mainIndex);
    expect(live).toMatch(
      /^ {6}if \(isChatWidth\(event\.payload\.chatWidth\)\) \{$/m,
    );
    expect(live).toMatch(
      /^ {8}configStore\.update\(\{ chatWidth: event\.payload\.chatWidth \}\);$/m,
    );
  });

  it("读配置时归一（旧配置没有这个字段 ⇒ 标准档）", () => {
    expect(useIPC).toMatch(
      /chatWidth: normalizeChatWidth\(config\.chatWidth\)/,
    );
  });
});

describe("聊天列宽", () => {
  it("ChatView 订阅 settings.chatWidth 并算出列宽类名", () => {
    const live = stripLineComments(chatView);
    expect(live).toMatch(/useAppStore\(\(s\) => s\.settings\.chatWidth\)/);
    expect(live).toMatch(/chatColumnMaxWidth\(/);
  });

  it("五处列宽容器全部走 chatColumnClass（少一处就错位）", () => {
    // 消息容器 / 审批卡 / 队列条 / 状态条 / 输入框容器
    expect(chatView.match(/\$\{chatColumnClass\}/g) ?? []).toHaveLength(5);
  });

  it("消息容器保留 w-full（窗口比档位窄时仍能被收窄）", () => {
    expect(chatView).toMatch(/selectable w-full \$\{chatColumnClass\} mx-auto/);
  });

  it("ChatView 里不再有写死的 57.5rem（宽度只能从共享模块来）", () => {
    expect(chatView).not.toMatch(/57\.5rem/);
  });

  it("首屏那一列也用同一个档位（否则发出第一条消息时列会跳）", () => {
    // 首屏的输入框在 WelcomeView 自己的列里，写死过 52.5rem（840px）——
    // 不接档位就会「选窄档 → 首屏 840 → 第一条消息变 640」。
    const live = stripLineComments(welcomeView);
    expect(live).toMatch(/chatColumnMaxWidth\(/);
    expect(live).toMatch(/\$\{chatColumnClass\} w-full shrink-0/);
    expect(live).not.toMatch(/52\.5rem/);
  });
});

describe("消息区宽度设置面板", () => {
  it("用单选组写回 settings.chatWidth，并挡住空串", () => {
    expect(settingsGeneral).toMatch(/t\("general\.chatWidth"\)/);
    // Radix 再点当前档会回传 ""，必选项必须丢掉空值
    expect(settingsGeneral).toMatch(/isChatWidth\(next\)/);
    expect(settingsGeneral).toMatch(/updateSettings\(\{ chatWidth: next \}\)/);
    expect(settingsGeneral).toMatch(/chatWidthOptions/);
  });

  it("i18n：5 个键在两种语言里都齐", () => {
    for (const lang of ["zh", "en"]) {
      const dict = JSON.parse(
        read(`src/renderer/i18n/locales/${lang}.json`),
      ) as { general: Record<string, string> };
      for (const key of [
        "chatWidth",
        "chatWidthDesc",
        "chatWidthNarrow",
        "chatWidthStandard",
        "chatWidthWide",
      ]) {
        expect(dict.general[key], `${lang} 缺 ${key}`).toBeTruthy();
      }
    }
  });
});
