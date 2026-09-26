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

  // 只守「接线存在」，不守逻辑对错 —— 过滤逻辑由 tests/welcome-quick-entries.test.ts
  // 对 visibleQuickEntries 做行为断言。不要用本用例冒充行为守门。
  it('wires the quick-entry chips to skill selection', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('visibleQuickEntries(');
    expect(source).toContain('insertSkillChip');
    expect(source).toContain('appendPromptExample');
  });
});
