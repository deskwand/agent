import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const welcomeViewPath = path.resolve(process.cwd(), 'src/renderer/components/WelcomeView.tsx');

describe('WelcomeView submit guards', () => {
  it('disables the submit button when there is no text, image, or file to send', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain('disabled={isSubmitting}');
    expect(source).toContain('onSubmit={handleSubmit}');
  });

  it('only clears the composer after startSession returns a created session', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain('const session = await startSession(');
    expect(source).toContain('workingDir || undefined,');
    expect(source).toContain('if (session) {');
    expect(source).toContain('chatInputRef.current?.clear(NEW_SESSION_DRAFT_KEY);');
    // 欢迎页草稿的删除必须在同一个守卫里：会话没建成时删掉它会丢掉用户还没发出去的内容。
    expect(source).toContain('removeDraft(NEW_SESSION_DRAFT_KEY);');
  });

  it('keeps the working-directory picker out of the welcome view', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    // 工作目录选择器住在 Sidebar（那里调 changeWorkingDir），欢迎页不碰它。
    // 这里此前还有一条 not.toContain('setGlobalNotice') —— 它的用例名写的是「把
    // 选择器失败冒泡到全局提示」，断言却是反的，从 init 起就是一条名实不符的旧防线。
    // 首次进入的连接卡片确实需要在这里弹一条成功提示，所以改为正向断言：
    // 欢迎页的全局通知只服务于「连接成功」这一条。
    expect(source).not.toContain('changeWorkingDir');
    expect(source).toContain("const workingDir = useAppStore((state) => state.workingDir);");
    expect(source).toContain('messageKey: "connect.connected"');
  });
});
