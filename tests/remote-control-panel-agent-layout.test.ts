import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const remotePanelPath = path.resolve(process.cwd(), 'src/renderer/components/RemoteControlPanel.tsx');

describe('RemoteControlPanel layout', () => {
  it('delegates to the ChannelInstanceCatalog', () => {
    const source = fs.readFileSync(remotePanelPath, 'utf8');
    expect(source).toContain('ChannelInstanceCatalog');
    expect(source).toContain('max-w-4xl');
  });

  it('no longer references the legacy gateway UI', () => {
    const source = fs.readFileSync(remotePanelPath, 'utf8');
    expect(source).not.toContain('GatewayControlCard');
    expect(source).not.toContain('AdvancedConfigStep');
    expect(source).not.toContain('FeishuConfigStep');
  });
});
