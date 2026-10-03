import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import zh from "../src/renderer/i18n/locales/zh.json";
import en from "../src/renderer/i18n/locales/en.json";

const read = (rel: string) =>
  readFileSync(path.resolve(process.cwd(), rel), "utf8");

const panel = read("src/renderer/components/SettingsPanel.tsx");

const zhSettings = zh.settings as Record<string, unknown>;
const enSettings = en.settings as Record<string, unknown>;

describe("设置面板外壳", () => {
  it("把侧栏条目归到四个分组标题下", () => {
    for (const key of [
      "groupGeneral",
      "groupPersonal",
      "groupIntegrations",
      "groupOther",
    ]) {
      expect(panel).toContain(`t("settings.${key}")`);
      expect(typeof zhSettings[key], `zh.json 缺少 settings.${key}`).toBe(
        "string",
      );
      expect(typeof enSettings[key], `en.json 缺少 settings.${key}`).toBe(
        "string",
      );
    }
  });

  it("侧栏不再渲染描述，描述只留在右栏简介里", () => {
    // line-clamp-2 是侧栏描述那两行的写法；右栏简介不受影响。
    expect(panel).not.toContain("line-clamp-2");
    expect(panel).toContain("activeTabMeta?.description");
  });

  it("子代理页的简介不再借用默认模型这个字段名", () => {
    expect(panel).not.toContain("subagent.defaultModel");
    expect(panel).toContain('t("settings.subagentDesc")');
    expect(typeof zhSettings.subagentDesc).toBe("string");
    expect(typeof enSettings.subagentDesc).toBe("string");
  });

  it("删掉了侧栏说明这个零引用键", () => {
    expect(zhSettings.panelDesc).toBeUndefined();
    expect(enSettings.panelDesc).toBeUndefined();
  });

  it("分组名与条目名是同一个词", () => {
    // 分组「常规」下面唯一那一项也叫「常规」；en 的 General 本来就一致。
    expect(zhSettings.general).toBe("常规");
  });
});

const shared = read("src/renderer/components/settings/shared.tsx");

describe("设置行原语", () => {
  it("五个原语各只定义一次", () => {
    for (const name of [
      "SettingsSection",
      "SettingsCard",
      "SettingsRow",
      "SettingsSwitch",
      "SettingsSelect",
    ]) {
      const hits = shared.match(new RegExp(`export function ${name}\\b`, "g"));
      expect(
        hits?.length,
        `shared.tsx 里 ${name} 定义了 ${hits?.length} 次`,
      ).toBe(1);
    }
  });

  it("行的分隔线由行自己画，不要求调用方包一层", () => {
    expect(shared).toContain("first:border-t-0");
  });
});

const general = read("src/renderer/components/settings/SettingsGeneral.tsx");

describe("常规页的控件形态", () => {
  it("不再用并排的启用/停用按钮", () => {
    expect(general).not.toContain("flex-1 px-4 py-2.5 rounded-lg border");
    expect(general).not.toContain('t("common.enable")');
    expect(general).not.toContain('t("common.disable")');
  });

  it("布尔项用开关，枚举项用下拉，主题三选一内联在那一行", () => {
    expect(general).toContain("<SettingsSwitch");
    expect(general).toContain("<SettingsSelect");
    expect(general).toContain("aria-pressed={settings.theme === option.value}");
    expect(general).toContain('t("general.telemetry")');
    expect(general).toContain('t("general.autoSkillLearning")');
  });

  it("字号按钮的无障碍标签走 i18n", () => {
    expect(general).toContain('t("general.uiFontSizeDecrease")');
    expect(general).toContain('t("general.uiFontSizeIncrease")');
    expect(general).not.toContain('"decrease font size"');
  });
});

const capabilities = read(
  "src/renderer/components/settings/SettingsCapabilities.tsx",
);

describe("能力页复用设置外壳的开关", () => {
  it("设置目录里只有 shared.tsx 自带开关实现", () => {
    // 全目录扫，不手写名单：新加一个文件里自带 role="switch" 也会被判红。
    const dir = "src/renderer/components/settings";
    const files = readdirSync(path.resolve(process.cwd(), dir)).filter((f) =>
      /\.tsx?$/.test(f),
    );
    const owners = files
      .filter((f) => read(`${dir}/${f}`).includes('role="switch"'))
      .sort();
    expect(owners).toEqual(["shared.tsx"]);
    expect(capabilities).toContain("<SettingsSwitch");
    expect(capabilities).toContain("<SettingsCard");
  });

  it("删掉了被开关取代的状态文案，以及不再渲染的权限块标题", () => {
    const zhCaps = zhSettings.capabilities as Record<string, unknown>;
    const enCaps = enSettings.capabilities as Record<string, unknown>;
    expect(zhCaps.statusOn).toBeUndefined();
    expect(zhCaps.statusOff).toBeUndefined();
    expect(enCaps.statusOn).toBeUndefined();
    expect(enCaps.statusOff).toBeUndefined();
    const zhPerm = zhCaps.permission as Record<string, unknown>;
    const enPerm = enCaps.permission as Record<string, unknown>;
    expect(zhPerm.title).toBeUndefined();
    expect(enPerm.title).toBeUndefined();
  });
});

const personalization = read(
  "src/renderer/components/settings/SettingsPersonalization.tsx",
);
const agentsMd = read(
  "src/renderer/components/settings/SettingsGlobalAgentsMd.tsx",
);

describe("个性化页改卡片行", () => {
  it("记忆开关用外壳的开关，不再用点击式按钮", () => {
    expect(personalization).toContain("<SettingsSwitch");
    expect(personalization).toContain("<SettingsCard");
    expect(personalization).not.toContain("memory.enableAction");
    expect(personalization).not.toContain("memory.disableAction");
  });

  it("危险操作不再硬编码玫瑰色", () => {
    expect(personalization).not.toContain("rose-");
    expect(personalization).toContain("text-error");
  });

  it("AGENTS.md 编辑器挂到新的分组卡片上", () => {
    expect(agentsMd).toContain("<SettingsCard");
    expect(agentsMd).toContain("<SettingsSection");
  });
});
