import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const welcomeViewPath = path.resolve(process.cwd(), 'src/renderer/components/WelcomeView.tsx');

describe('WelcomeView Agent-style layout', () => {
  it('uses a narrower editorial landing column with DeskWand eyebrow', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('max-w-[840px]');
    expect(source).toContain('t("welcome.title")');
  });

  it('renders the connect cards only after config is loaded and nothing is configured', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('appConfig !== null && !isConfigured');
    expect(source).toContain('<ConnectCards');
    expect(source).toContain('setShowLoginModal(true)');
    expect(source).toContain('setSettingsTab("api");');
    expect(source).toContain('setShowSettings(true);');
  });

  it('announces a finished connection from the view, not from the cards', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('messageKey: "connect.connected"');
    expect(source).toContain('setGlobalNotice');
  });

  it('converges the first-run screen on the connect cards only', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    // 胶囊整行隐藏
    expect(source).toContain('{visibleEntries.length > 0 && !showConnectCards && (');
    // 能力行
    expect(source).toContain('t("connect.capabilitySummary")');
    // 输入区禁用 + 降级观感
    expect(source).toContain('disabled={isSubmitting || showConnectCards}');
    expect(source).toContain('${showConnectCards ? " cursor-not-allowed" : ""}');
    // placeholder 与底栏 —— 这两条必须写成短串：prettier 会把这两个 JSX 属性折成
    // 多行（`placeholder={` 与 `bottomSlot={` 后面都是换行），拿整行表达式去断言
    // 永远不会命中。已用 prettier 实测过。
    expect(source).toContain('t("connect.startPlaceholder")');
    expect(source).toContain('bottomSlot={');
    expect(source).toContain('showConnectCards ? undefined :');
  });

  // 只守「接线存在」，不守逻辑对错 —— 过滤逻辑由 tests/welcome-quick-entries.test.ts
  // 对 visibleQuickEntries 做行为断言。不要用本用例冒充行为守门。
  it('wires the quick-entry chips to skill selection', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('visibleQuickEntries(');
    expect(source).toContain('insertSkillChip');
    expect(source).toContain('appendPromptExample');
  });

  it('renders the chip icon from the entry data, not from the entry kind', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    // 只守接线存在。图标的穷尽性由 tsc 守：QUICK_ENTRY_ICONS 标注为
    // Record<WelcomeQuickEntryIcon, LucideIcon>，数据表里加一个图标名而这里没跟上
    // 就编译不过。「5 个图标互不相同」由 tests/welcome-quick-entries.test.ts 对
    // 数据表做行为断言。不要用本用例冒充行为守门。
    expect(source).toContain('QUICK_ENTRY_ICONS[icon]');
    expect(source).toContain('icon={entry.icon}');
    // 还要断言旧分支真没了：只查「读了 entry.icon」的话，半回退写法
    // `entry.kind === "skill" ? <Sparkles/> : <QuickEntryIcon icon={entry.icon}/>`
    // 照样能过，而技能 chip 的图标会静默变回清一色星形。
    expect(source).not.toContain('entry.kind === "skill" ? (');
  });
});
