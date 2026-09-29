import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const read = (p: string) =>
  fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

/**
 * Source-level assertions for the anonymous telemetry wiring. The hooks are
 * one-liners spread across large files, so a behavioural test would need the
 * whole app; these keep a removed or renamed call from silently killing a data
 * stream.
 */
describe('telemetry event wiring', () => {
  it('emits config_done through the injected hook', () => {
    expect(read('src/main/config/config-store.ts')).toContain(
      'if (!wasConfigured && stored.isConfigured) onConfiguredHook?.();',
    );
    expect(read('src/main/index.ts')).toContain('setOnConfiguredHook(');
  });

  it('emits session_start when a session is created', () => {
    expect(read('src/main/index.ts')).toContain(
      'void trackEvent("session_start");',
    );
  });

  it('emits reply_ok and error from the turn outcome', () => {
    const source = read('src/main/agent/agent-runner.ts');
    expect(source).toContain('void trackEvent("reply_ok");');
    expect(source).toContain('classifyTurnFailure(outcomeTracker)');
    expect(source).toContain('getTerminalErrorText(): string | undefined');
    // The thrown path records the text it already computed, otherwise every
    // thrown failure would bucket as `other`.
    expect(source).toContain('outcomeTracker.setTerminalError(errorText);');
  });

  it('emits feature_use for each v1 feature', () => {
    const source = read('src/main/index.ts');
    for (const feature of [
      'skill_install',
      'file_op',
      'schedule',
      'browser',
      'connector',
    ]) {
      expect(source).toContain(
        `void trackEvent("feature_use", { feature: "${feature}" });`,
      );
    }
  });

  it('reports update outcomes', () => {
    const source = read('src/main/updater.ts');
    for (const code of ['up_to_date', 'available', 'downloaded', 'failed']) {
      expect(source).toContain(
        `void trackEvent("update_result", { code: "${code}" });`,
      );
    }
  });

  it('buckets "no provider" as no_provider rather than auth_failed', async () => {
    const { TurnOutcomeTracker, classifyTurnFailure } = await import(
      '../src/main/agent/agent-runner'
    );
    const tracker = new TurnOutcomeTracker();
    // The real message from the model resolver contains "API key".
    tracker.setTerminalError('No API key configured for provider');

    expect(classifyTurnFailure(tracker)).toBe('no_provider');
  });
});
