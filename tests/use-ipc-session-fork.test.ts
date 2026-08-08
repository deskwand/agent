import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const useIPCPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');

describe('useIPC session fork', () => {
  it('forkSession 通过 invoke 发送 session.fork 并自动切换会话', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain('type: "session.fork"');
    expect(source).toContain('payload: { sessionId, messageId, titleSuffix }');
    expect(source).toContain('addSession(session)');
    expect(source).toContain('setActiveSession(session.id)');
    expect(source).toContain('id: `notice-session-fork-${Date.now()}`');
    expect(source).not.toContain('throw e;');
  });
});
