import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('scheduled task session title wiring', () => {
  it('routes schedule title generation through SessionManager flow', () => {
    const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');
    const content = readFileSync(indexPath, 'utf8');
    expect(content).toContain('async function resolveScheduledTaskTitle(');
    expect(content).toContain('sessionManager.generateScheduledTaskTitle');
    expect(content).toContain('ipcMain.handle(');
    expect(content).toContain('"schedule.create"');
    expect(content).toContain('"schedule.update"');
  });
});
