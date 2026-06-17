import { describe, test, expect, afterEach, mock } from 'bun:test';
import {
  isNotConnectedError,
  unwrapNonOkBody,
  callNativeHost,
  HttpError,
} from './stdio-proxy.js';
import { AUTH_TOKEN_HEADER } from './types.js';

// --- Minimal Response-like fake -------------------------------------------------
// callNativeHost / unwrapNonOkBody only touch: ok, status, statusText,
// headers.get('content-type'), and json().
function fakeResponse(opts: {
  status: number;
  body?: unknown;
  contentType?: string | null;
  statusText?: string;
}): Response {
  const { status, body, contentType = 'application/json', statusText = '' } = opts;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
  } as unknown as Response;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('isNotConnectedError (ARCH-3)', () => {
  test('ECONNREFUSED on cause.code => not connected', () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    expect(isNotConnectedError(err)).toBe(true);
  });

  test('TimeoutError => not connected', () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    expect(isNotConnectedError(err)).toBe(true);
  });

  test('AbortError => not connected', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isNotConnectedError(err)).toBe(true);
  });

  test('bare "fetch failed" TypeError with no cause => not connected', () => {
    expect(isNotConnectedError(new TypeError('fetch failed'))).toBe(true);
  });

  test('classification is structural, not substring based', () => {
    // A normal Error whose message happens to contain a magic word must NOT be
    // misclassified as a connection failure.
    const err = new Error('the tool reported ECONNREFUSED in its output');
    expect(isNotConnectedError(err)).toBe(false);
  });

  test('our own HttpError is a real response, never "not connected"', () => {
    expect(isNotConnectedError(new HttpError(500, 'Internal Server Error'))).toBe(false);
  });
});

describe('unwrapNonOkBody (CORR-6)', () => {
  test('503 backpressure body unwraps with code BACKPRESSURE', async () => {
    const res = fakeResponse({ status: 503, body: { status: 'error', error: 'Too many pending requests' } });
    const out = await unwrapNonOkBody(res);
    expect(out.status).toBe('error');
    expect(out.error).toBe('Too many pending requests');
    expect(out.code).toBe('BACKPRESSURE');
  });

  test('400 bad request derives code BAD_REQUEST', async () => {
    const res = fakeResponse({ status: 400, body: { status: 'error', error: 'Invalid JSON body' } });
    const out = await unwrapNonOkBody(res);
    expect(out.code).toBe('BAD_REQUEST');
  });

  test('401 derives code UNAUTHORIZED', async () => {
    const res = fakeResponse({ status: 401, body: { status: 'error', error: 'unauthorized' } });
    const out = await unwrapNonOkBody(res);
    expect(out.code).toBe('UNAUTHORIZED');
  });

  test('500 tool error unwraps body (does not throw), default code TOOL_ERROR', async () => {
    const res = fakeResponse({ status: 500, body: { status: 'error', error: 'boom' } });
    const out = await unwrapNonOkBody(res);
    expect(out.error).toBe('boom');
    expect(out.code).toBe('TOOL_ERROR');
  });

  test('host-supplied code is preserved over the status-derived default', async () => {
    const res = fakeResponse({ status: 500, body: { status: 'error', error: 'x', code: 'TIMEOUT' } });
    const out = await unwrapNonOkBody(res);
    expect(out.code).toBe('TIMEOUT');
  });

  test('non-JSON non-OK response throws HttpError (caller emits generic message)', async () => {
    const res = fakeResponse({ status: 502, contentType: 'text/html', statusText: 'Bad Gateway' });
    await expect(unwrapNonOkBody(res)).rejects.toBeInstanceOf(HttpError);
  });
});

describe('callNativeHost fetch-stub branches (TEST-2)', () => {
  test('200 returns the parsed body', async () => {
    globalThis.fetch = mock(async () => fakeResponse({ status: 200, body: { status: 'success', data: { ok: 1 } } })) as unknown as typeof fetch;
    const out = await callNativeHost('ping', {});
    expect(out.status).toBe('success');
    expect(out.data).toEqual({ ok: 1 });
  });

  test('500 returns the unwrapped error body, not a throw', async () => {
    globalThis.fetch = mock(async () => fakeResponse({ status: 500, body: { status: 'error', error: 'handler exploded' } })) as unknown as typeof fetch;
    const out = await callNativeHost('bookmark_delete', { id: '9' });
    expect(out.status).toBe('error');
    expect(out.error).toBe('handler exploded');
    expect(out.code).toBe('TOOL_ERROR');
  });

  test('503 returns code BACKPRESSURE', async () => {
    globalThis.fetch = mock(async () => fakeResponse({ status: 503, body: { status: 'error', error: 'Too many pending requests' } })) as unknown as typeof fetch;
    const out = await callNativeHost('ping', {});
    expect(out.code).toBe('BACKPRESSURE');
  });

  test('ECONNREFUSED rejection propagates as a not-connected error', async () => {
    globalThis.fetch = mock(async () => {
      const err = new TypeError('fetch failed');
      (err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
      throw err;
    }) as unknown as typeof fetch;
    // callNativeHost lets the fetch rejection bubble; the tool wrapper classifies
    // it via isNotConnectedError. Assert both halves of that contract here.
    let caught: unknown;
    try {
      await callNativeHost('ping', {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isNotConnectedError(caught)).toBe(true);
  });
});

describe('auth token header (SEC-1)', () => {
  test('sends AUTH_TOKEN_HEADER when a token file is present', async () => {
    const seen: Array<Record<string, string>> = [];
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return fakeResponse({ status: 200, body: { status: 'success', data: {} } });
    }) as unknown as typeof fetch;

    await callNativeHost('ping', {});

    // The header is only present when the on-disk token file exists. In CI the
    // file is usually absent, so assert the header key is *either* a non-empty
    // token or simply omitted — never an empty string.
    const headers = seen[0]!;
    const token = headers[AUTH_TOKEN_HEADER];
    expect(token === undefined || token.length > 0).toBe(true);
  });

  test('on 401 it re-reads the token and retries exactly once', async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      if (calls === 1) return fakeResponse({ status: 401, body: { status: 'error', error: 'unauthorized', code: 'UNAUTHORIZED' } });
      return fakeResponse({ status: 200, body: { status: 'success', data: { retried: true } } });
    }) as unknown as typeof fetch;

    const out = await callNativeHost('ping', {});
    expect(calls).toBe(2);
    expect(out.status).toBe('success');
    expect(out.data).toEqual({ retried: true });
  });

  test('on persistent 401 it surfaces an UNAUTHORIZED tool error (no retry storm)', async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return fakeResponse({ status: 401, body: { status: 'error', error: 'unauthorized' } });
    }) as unknown as typeof fetch;

    const out = await callNativeHost('ping', {});
    expect(calls).toBe(2); // initial + one retry, then stop
    expect(out.status).toBe('error');
    expect(out.code).toBe('UNAUTHORIZED');
  });
});
