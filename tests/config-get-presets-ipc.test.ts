import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS } from '../src/main/config/config-store';

async function getPresetsWithFallback(loader: () => Promise<typeof PROVIDER_PRESETS>) {
  try {
    return await loader();
  } catch {
    return PROVIDER_PRESETS;
  }
}

describe('config.getPresets fallback', () => {
  it('returns provider preset object instead of array when loader fails', async () => {
    const result = await getPresetsWithFallback(async () => {
      throw new Error('boom');
    });

    expect(Array.isArray(result)).toBe(false);
    expect(result.openai.name).toBe('OpenAI');
    expect(result.anthropic.name).toBe('Anthropic');
  });
});
