import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
  summarizeSchedulePrompt,
} from '../src/shared/schedule/task-title';

describe('scheduled task title', () => {
  it('always prefixes with [定时任务]', () => {
    expect(buildScheduledTaskTitle('帮我整理今天的待办', 'zh')).toBe(
      '[定时任务] 帮我整理今天的待办'
    );
  });

  it('prefixes with [Scheduled] for the en locale', () => {
    expect(buildScheduledTaskTitle('today todos', 'en')).toBe(
      '[Scheduled] today todos'
    );
  });

  it('normalizes whitespace and line breaks', () => {
    expect(buildScheduledTaskTitle('  第一行\n\n第二行   第三行  ', 'zh')).toBe(
      '[定时任务] 第一行 第二行 第三行'
    );
  });

  it('strips duplicated schedule prefix', () => {
    expect(buildScheduledTaskTitle('[定时任务] 每日汇总', 'zh')).toBe(
      '[定时任务] 每日汇总'
    );
  });

  it('strips a prefix written in the other language', () => {
    expect(buildScheduledTaskTitle('[Scheduled] daily digest', 'zh')).toBe(
      '[定时任务] daily digest'
    );
    expect(buildScheduledTaskTitle('[定时任务] 每日汇总', 'en')).toBe(
      '[Scheduled] 每日汇总'
    );
  });

  it('truncates very long prompt summary', () => {
    const longPrompt = 'a'.repeat(70);
    expect(summarizeSchedulePrompt(longPrompt, 'zh')).toBe(`${'a'.repeat(45)}...`);
  });

  it('falls back for empty prompt', () => {
    expect(buildScheduledTaskTitle('   ', 'zh')).toBe('[定时任务] 未命名任务');
    expect(buildScheduledTaskTitle('   ', 'en')).toBe('[Scheduled] Untitled task');
  });

  it('builds fallback title from prompt summary', () => {
    expect(
      buildScheduledTaskFallbackTitle('请帮我查一下近一周内的 Agent 论文', 'zh')
    ).toBe('[定时任务] 请帮我查一下近一周内的 Agent 论文');
  });
});
