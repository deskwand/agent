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
    expect(source).toContain('onClick={scrollToBottomByButton}');
    expect(source).toContain('behavior: "smooth"');
  });

  it('showScrollToBottom drives button visibility', () => {
    expect(source).toContain('const [showScrollToBottom, setShowScrollToBottom] = useState(false);');
    expect(source).toContain('? "opacity-100 scale-100 pointer-events-auto"');
    expect(source).toContain(': "opacity-0 scale-75 pointer-events-none"');
  });

  it('syncAutoFollowState keeps showScrollToBottom opposite to isAtBottom', () => {
    expect(source).toContain('setShowScrollToBottom(!isAtBottomRef.current)');
  });

  it('isAtBottomRef still guards streaming and new-message auto-follow (unrelated to button)', () => {
    // The follow guards remain, expressed through the isAtBottomRef
    // single-source state: own new messages force a bottom scroll, all
    // other content growth only pins while the user is at the bottom.
    expect(source).toContain('if (isOwnNewMessage) {');
    expect(source).toContain('} else if (isAtBottomRef.current) {');
  });
});
