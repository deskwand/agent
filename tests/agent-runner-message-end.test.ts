import { describe, expect, it } from 'vitest';

import {
  resolveMessageEndPayload,
  toUserFacingErrorText,
  getErrorSuffix,
} from '../src/main/agent/agent-runner-message-end';

// ── resolveMessageEndPayload (default locale: en) ──────────────────

describe('resolveMessageEndPayload', () => {
  it('falls back to accumulated streamed text when message_end content is empty', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: 'streamed fallback',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.errorText).toBeUndefined();
    expect(result.shouldEmitMessage).toBe(true);
    expect(result.effectiveContent).toEqual([
      { type: 'text', text: 'streamed fallback' },
    ]);
  });

  it('surfaces user-facing error text when message_end stops with error', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'first_response_timeout',
      },
      streamedText: 'partial text',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe(
      'Model response timed out. Please retry or check the model/gateway load.',
    );
  });

  it('surfaces empty_success_result when message_end has no content and no streamed fallback', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: '',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe(
      'Model returned empty result. Possible compatibility issue. Please retry or switch protocol.',
    );
  });
});

// ── toUserFacingErrorText (default locale: en) ─────────────────────

describe('toUserFacingErrorText (en)', () => {
  it('maps 400 / bad request to configuration hint', () => {
    const result = toUserFacingErrorText('HTTP 400: bad request - ROLE_UNSPECIFIED');
    expect(result).toContain('Request rejected (400)');
    expect(result).toContain('Original error:');
    expect(result).toContain('ROLE_UNSPECIFIED');
  });

  it('maps invalid request to configuration hint', () => {
    const result = toUserFacingErrorText('invalid request: unsupported parameter "store"');
    expect(result).toContain('Request rejected (400)');
    expect(result).toContain('Original error:');
  });

  it('maps 401 to authentication hint', () => {
    const result = toUserFacingErrorText('Error 401: Unauthorized');
    expect(result).toContain('Authentication failed');
    expect(result).toContain('API key');
    expect(result).toContain('Original error:');
  });

  it('maps 429 / rate limit to throttle hint', () => {
    const result = toUserFacingErrorText('429 Too Many Requests - rate limit exceeded');
    expect(result).toContain('Rate limited (429)');
    expect(result).toContain('Original error:');
  });

  it('passes through unknown errors unchanged', () => {
    const raw = 'some obscure upstream error';
    expect(toUserFacingErrorText(raw)).toBe(raw);
  });

  it('maps first_response_timeout correctly', () => {
    expect(toUserFacingErrorText('first_response_timeout')).toBe(
      'Model response timed out. Please retry or check the model/gateway load.',
    );
  });

  it('maps 5xx server errors to upstream service hint', () => {
    const result = toUserFacingErrorText('HTTP 502: Bad Gateway');
    expect(result).toContain('Upstream service error');
    expect(result).toContain('Original error:');
    expect(result).toContain('502');
  });

  it('maps "server error" to upstream service hint', () => {
    const result = toUserFacingErrorText('internal server error');
    expect(result).toContain('Upstream service error');
  });

  it('maps "overloaded" to upstream service hint', () => {
    const result = toUserFacingErrorText('overloaded_error');
    expect(result).toContain('Upstream service error');
  });

  it('maps "terminated" to network connection hint', () => {
    const result = toUserFacingErrorText('terminated');
    expect(result).toContain('Network interrupted');
  });

  it('maps "connection error" to network connection hint', () => {
    const result = toUserFacingErrorText('connection error: ECONNRESET');
    expect(result).toContain('Network interrupted');
  });

  it('maps "fetch failed" to network connection hint', () => {
    const result = toUserFacingErrorText('fetch failed');
    expect(result).toContain('Network interrupted');
  });

  it('maps "other side closed" to network connection hint', () => {
    const result = toUserFacingErrorText('other side closed');
    expect(result).toContain('Network interrupted');
  });

  it('maps "too many requests" without status code to throttle hint', () => {
    const result = toUserFacingErrorText('too many requests');
    expect(result).toContain('Rate limited (429)');
    expect(result).toContain('Original error:');
  });

  it('maps "retry delay exceeded" to network connection hint', () => {
    const result = toUserFacingErrorText('retry delay exceeded');
    expect(result).toContain('Network interrupted');
  });
});

// ── toUserFacingErrorText (zh locale) ──────────────────────────────

describe('toUserFacingErrorText (zh)', () => {
  const zh = 'zh';

  it('maps 400 / bad request to Chinese configuration hint', () => {
    const result = toUserFacingErrorText('HTTP 400: bad request', zh);
    expect(result).toContain('请求被拒绝（400）');
    expect(result).toContain('原始错误:');
  });

  it('maps first_response_timeout to Chinese', () => {
    expect(toUserFacingErrorText('first_response_timeout', zh)).toBe(
      '模型响应超时，请稍后重试或检查模型/网关负载。',
    );
  });

  it('maps empty_success_result to Chinese', () => {
    expect(toUserFacingErrorText('empty_success_result', zh)).toBe(
      '模型返回空结果，可能是兼容性问题，请重试或切换协议。',
    );
  });

  it('maps 401 to Chinese authentication hint', () => {
    const result = toUserFacingErrorText('Error 401: Unauthorized', zh);
    expect(result).toContain('认证失败');
    expect(result).toContain('API Key');
  });

  it('maps 429 to Chinese throttle hint', () => {
    const result = toUserFacingErrorText('429 Too Many Requests', zh);
    expect(result).toContain('请求被限流（429）');
    expect(result).toContain('原始错误:');
  });

  it('maps 5xx to Chinese upstream service hint', () => {
    const result = toUserFacingErrorText('HTTP 503: Service Unavailable', zh);
    expect(result).toContain('上游服务异常');
    expect(result).toContain('原始错误:');
  });

  it('maps network errors to Chinese', () => {
    expect(toUserFacingErrorText('terminated', zh)).toContain('网络连接中断');
    expect(toUserFacingErrorText('fetch failed', zh)).toContain('网络连接中断');
  });
});

// ── getErrorSuffix ─────────────────────────────────────────────────

describe('getErrorSuffix', () => {
  it('returns config retry suffix for 4xx errors (en)', () => {
    const suffix = getErrorSuffix('HTTP 400: bad request');
    expect(suffix).toContain('check your configuration');
  });

  it('returns auto retry suffix for non-4xx errors (en)', () => {
    const suffix = getErrorSuffix('connection error');
    expect(suffix).toContain('Retrying automatically');
  });

  it('returns config retry suffix for 4xx errors (zh)', () => {
    const suffix = getErrorSuffix('HTTP 400: bad request', 'zh');
    expect(suffix).toContain('请检查配置后重试');
  });

  it('returns auto retry suffix for non-4xx errors (zh)', () => {
    const suffix = getErrorSuffix('connection error', 'zh');
    expect(suffix).toContain('Agent 正在自动重试');
  });
});
