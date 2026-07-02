import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const source = fs.readFileSync(chatViewPath, 'utf8');

describe('ChatView scroll-to-bottom button', () => {
  it('scrollToBottom does not have autoFollowRef guard — button onClick can work', () => {
    // The guard `if (!autoFollowRef.current) return;` was the root cause.
    // The button appears only when autoFollowRef is false, so the guard
    // made the onClick a no-op. Guard must be absent from scrollToBottom.
    expect(source).not.toMatch(/scrollToBottom[\s\S]*?if\s*\(\s*!autoFollowRef\.current\s*\)\s*return/);
  });

  it('button onClick invokes scrollToBottom with smooth behavior', () => {
    expect(source).toContain('onClick={() => scrollToBottom("smooth")}');
  });

  it('showScrollToBottom drives button visibility', () => {
    expect(source).toContain('const [showScrollToBottom, setShowScrollToBottom] = useState(false);');
    expect(source).toContain('{showScrollToBottom &&');
  });

  it('syncAutoFollowState keeps showScrollToBottom opposite to isAtBottom', () => {
    expect(source).toContain('setShowScrollToBottom(!isAtBottom)');
  });

  it('autoFollowRef still guards streaming and new-message auto-follow (unrelated to button)', () => {
    // These external guards remain and should not be touched
    expect(source).toContain("if (isStreamingTick && autoFollowRef.current");
    expect(source).toContain("if (autoFollowRef.current && !isStreamingTick && !isOwnNewMessage && hasNewMessage)");
  });
});
