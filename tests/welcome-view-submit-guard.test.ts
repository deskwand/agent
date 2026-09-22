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

  it('surfaces working-directory picker failures to the global notice toast', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).not.toContain('setGlobalNotice');
    expect(source).not.toContain('changeWorkingDir');
    expect(source).toContain("const workingDir = useAppStore((state) => state.workingDir);");
  });
});
