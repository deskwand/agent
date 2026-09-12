import { describe, it, expect } from 'vitest';
import { createTitleFlowHarness } from './support/session-title-harness';

describe('session title flow', () => {
  it('updates title after first user message when generator succeeds', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: '简短标题' });
    await harness.runFirstMessage('帮我做一个PPT');
    expect(harness.updatedTitle).toBe('简短标题');
  });

  it('does not update when generator fails', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: null });
    await harness.runFirstMessage('帮我做一个PPT');
    expect(harness.updatedTitle).toBe(null);
    expect(harness.hasAttempted).toBe(false);
  });

  it('does not override manual title changes', async () => {
    const harness = createTitleFlowHarness({
      generatedTitle: '简短标题',
      latestTitle: '手动标题',
    });
    await harness.runFirstMessage('帮我做一个PPT');
    expect(harness.updatedTitle).toBe(null);
    expect(harness.hasAttempted).toBe(false);
  });

  it('does not mark attempt when updateTitle returns false (session deleted during generation)', async () => {
    const harness = createTitleFlowHarness({
      generatedTitle: '简短标题',
      updateTitleResult: false,
    });
    await harness.runFirstMessage('帮我做一个PPT');
    // updatedTitle is null because updateTitle returned false
    expect(harness.updatedTitle).toBe(null);
    // hasAttempted must be false so next session start can retry
    expect(harness.hasAttempted).toBe(false);
  });

  it('names a session whose initial title came from an attachment name', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: '季度总结' });
    await harness.runFirstMessage('', '季度总结-最终版.pptx');
    expect(harness.updatedTitle).toBe('季度总结');
    expect(harness.hasAttempted).toBe(true);
  });

  it('skips the API call when there is neither prompt text nor an attachment name', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: '不应被使用' });
    await harness.runFirstMessage('', null);
    expect(harness.generateCallCount).toBe(0);
    expect(harness.updatedTitle).toBe(null);
    expect(harness.hasAttempted).toBe(false);
  });
});
