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

    expect(source).toContain('const session = await startSession(sessionTitle, contentBlocks, workingDir || undefined);');
    expect(source).toContain('if (session) {');
    expect(source).toContain('chatInputRef.current?.clear();');
  });

  it('surfaces working-directory picker failures to the global notice toast', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).not.toContain('setGlobalNotice');
    expect(source).not.toContain('changeWorkingDir');
    expect(source).toContain("const workingDir = useAppStore((state) => state.workingDir);");
  });
});
