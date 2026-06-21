import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner.ts');
const agentRunnerContent = readFileSync(agentRunnerPath, 'utf8');

describe('AgentRunner internal browser stale page recovery', () => {
  it('detects retryable detached-frame style errors', () => {
    expect(agentRunnerContent).toContain('private _isRetryableBrowserPageError(error: unknown): boolean');
    expect(agentRunnerContent).toContain('text.includes("detached frame")');
    expect(agentRunnerContent).toContain('text.includes("execution context was destroyed")');
    expect(agentRunnerContent).toContain('text.includes("cannot find context")');
    expect(agentRunnerContent).toContain('text.includes("target closed")');
    expect(agentRunnerContent).toContain('text.includes("session closed")');
  });

  it('resets cached browser state before retrying', () => {
    expect(agentRunnerContent).toContain('private _resetBrowserState(reason: string): void');
    expect(agentRunnerContent).toContain('this._browserPage = null;');
    expect(agentRunnerContent).toContain('this._browser.close();');
    expect(agentRunnerContent).toContain('this._browser = null;');
  });

  it('wraps internal browser tool actions in a one-time retry helper', () => {
    expect(agentRunnerContent).toContain('private async _withBrowserPage<T>(');
    expect(agentRunnerContent).toContain('hit stale browser state; retrying once');
    expect(agentRunnerContent).toContain('this._resetBrowserState(`${operation} retry`)');
    expect(agentRunnerContent).toContain('const withPage = <T,>(');
  });

  it('checks cached pages for actual usability, not just closed state', () => {
    expect(agentRunnerContent).toContain('private async _isBrowserPageUsable(page: Page): Promise<boolean>');
    expect(agentRunnerContent).toContain('await page.title();');
    expect(agentRunnerContent).toContain('(await this._isBrowserPageUsable(this._browserPage))');
  });

  it('routes internal browser tools through the retry wrapper', () => {
    expect(agentRunnerContent).toContain('return withPage("internal_browser_navigate", async (page) => {');
    expect(agentRunnerContent).toContain('return withPage("internal_browser_screenshot", async (page) => {');
    expect(agentRunnerContent).toContain('return withPage("internal_browser_click", async (page) => {');
    expect(agentRunnerContent).toContain('return withPage("internal_browser_fill", async (page) => {');
    expect(agentRunnerContent).toContain('return withPage("internal_browser_wait_for", async (page) => {');
    expect(agentRunnerContent).toContain('return withPage("internal_browser_get_state", async (page) => {');
  });

  it('has snapshot ref map for @eN references', () => {
    expect(agentRunnerContent).toContain('private _snapshotRefMap:');
    expect(agentRunnerContent).toContain('self._snapshotRefMap = refMap;');
  });

  it('resolves locators via unified _resolveLocator', () => {
    expect(agentRunnerContent).toContain('private _resolveLocator(page: Page, selector: string): Locator');
    expect(agentRunnerContent).toContain('const refMatch = /^@e(\\d+)\$/.exec(selector);');
  });

  it('invalidates snapshot refs on navigation', () => {
    expect(agentRunnerContent).toContain('private _invalidateSnapshotRefs(): void');
    expect(agentRunnerContent).toContain('self._invalidateSnapshotRefs()');
  });
});
