import { describe, it, expect } from 'vitest';
import { toErrorText } from '../src/main/agent/credits-error';
import { detectInsufficientCredits } from '../src/main/agent/credits-error';

describe('402 detection chain', () => {
  it('pi-ai folded error text survives toErrorText and matches', () => {
    // 模拟 pi-ai formatProviderError 折叠后的 APIError.message
    const folded = '402: {"error":{"code":"INSUFFICIENT_BALANCE","message":"Insufficient credits"}}';
    const err = new Error(folded);
    expect(detectInsufficientCredits(toErrorText(err))).toBe(true);
  });
  it('unrelated errors do not match', () => {
    expect(detectInsufficientCredits(toErrorText(new Error('ECONNREFUSED')))).toBe(false);
  });
});
