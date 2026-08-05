import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');

function readChatView() {
  return fs.readFileSync(chatViewPath, 'utf8');
}

describe('ChatView Agent-style layout', () => {
  it('uses a narrower conversation column shared by messages and composer', () => {
    const source = readChatView();
    expect(source).toContain('max-w-[920px]');
  });
});
