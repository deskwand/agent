import { describe, expect, it } from 'vitest';
import {
  categorizeErrorText,
  toUserFacingErrorText,
} from '../src/main/agent/agent-runner-message-end';

describe('categorizeErrorText', () => {
  it.each([
    ['first_response_timeout', 'timeout'],
    ['empty_success_result', 'empty_result'],
    ['HTTP 400 Bad Request', 'bad_request'],
    ['401 Unauthorized', 'auth_failed'],
    ['403 Forbidden', 'auth_failed'],
    ['429 Too Many Requests', 'rate_limit'],
    ['503 Service Unavailable', 'upstream_error'],
    ['fetch failed', 'network'],
    ['socket terminated', 'network'],
    ['something nobody has seen before', 'other'],
  ])('maps %s -> %s', (raw, expected) => {
    expect(categorizeErrorText(raw)).toBe(expected);
  });

  it('prefers the specific markers over the broader patterns', () => {
    // "first_response_timeout" also contains "timeout", which would otherwise
    // fall into the network bucket; ordering is what keeps the bucket right.
    expect(categorizeErrorText('first_response_timeout')).toBe('timeout');
    expect(categorizeErrorText('empty_success_result')).toBe('empty_result');
  });

  it('returns the raw text unchanged when nothing matches', () => {
    expect(toUserFacingErrorText('totally unknown')).toBe('totally unknown');
  });

  it('documents that api-key text has no dedicated bucket yet', () => {
    // The taxonomy mirrors the branches of toUserFacingErrorText, which carries
    // no api-key pattern, so credential errors land in `other`. Pinned on
    // purpose: the decision is visible here rather than accidental, and adding
    // an auth bucket would change the user-facing string too (out of scope).
    expect(categorizeErrorText('No API key configured for provider')).toBe(
      'other',
    );
    expect(categorizeErrorText('Invalid API key')).toBe('other');
  });
});
