import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AgentRunner } from '../src/main/agent/agent-runner';
import { SUDO_RETRY_TEXT } from '../src/main/agent/sudo-command';
import type { ToolDefinition } from '../src/main/agent/agent-runner';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner.ts');
const agentRunnerContent = readFileSync(agentRunnerPath, 'utf8');

interface WrapperUnderTest {
  wrapBashToolForSudo(
    tools: ToolDefinition[],
    sessionId: string,
    effectiveCwd: string,
  ): ToolDefinition[];
}

interface FakeBashTool extends ToolDefinition {
  calls: { command: string }[];
}

function makeFakeBashTool(): FakeBashTool {
  const tool = {
    name: 'bash',
    calls: [] as { command: string }[],
    execute: async (
      _toolCallId: string,
      params: { command: string },
    ): Promise<{ content: { type: 'text'; text: string }[] }> => {
      tool.calls.push({ command: params.command });
      return { content: [{ type: 'text' as const, text: 'ran' }] };
    },
  };
  return tool as unknown as FakeBashTool;
}

function makeRunner(requestSudoPassword: (sessionId: string, toolUseId: string, command: string) => Promise<string | null>) {
  const runner = Object.create(AgentRunner.prototype) as AgentRunner;
  (runner as unknown as { requestSudoPassword: typeof requestSudoPassword }).requestSudoPassword =
    requestSudoPassword;
  return runner as unknown as WrapperUnderTest;
}

describe('sudo password wrapper', () => {
  it('no longer rewrites sudo with a whole-string regex', () => {
    expect(agentRunnerContent).not.toContain('/\\bsudo\\b(?!\\s+-S)/g');
    expect(agentRunnerContent).not.toContain('private static isSudoCommand');
  });

  it('delegates the decision to planSudoCommand', () => {
    expect(agentRunnerContent).toContain('from "./sudo-command"');
    expect(agentRunnerContent).toContain('const plan = planSudoCommand(command);');
  });

  it('refuses a sudo invocation it cannot inject into, without running it', async () => {
    const asked: string[] = [];
    const runner = makeRunner(async (_sessionId, _toolUseId, command) => {
      asked.push(command);
      return 'secret';
    });
    const tool = makeFakeBashTool();
    const [wrapped] = runner.wrapBashToolForSudo([tool], 'session-1', '/tmp');

    const command = 'cd /tmp && sudo id';
    const result = (await wrapped.execute(
      'call-1',
      { command },
      undefined,
      undefined,
      undefined,
    )) as { content: { type: string; text: string }[] };

    expect(result.content[0].text).toBe(SUDO_RETRY_TEXT);
    expect(tool.calls).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('runs commands without an injectable sudo invocation untouched', async () => {
    const runner = makeRunner(async () => 'secret');
    const tool = makeFakeBashTool();
    const [wrapped] = runner.wrapBashToolForSudo([tool], 'session-1', '/tmp');

    const command = 'ls -la /tmp';
    const result = (await wrapped.execute(
      'call-2',
      { command },
      undefined,
      undefined,
      undefined,
    )) as { content: { type: string; text: string }[] };

    expect(result.content[0].text).toBe('ran');
    expect(tool.calls).toEqual([{ command }]);
  });
});
